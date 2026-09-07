// 單篇貼文頁（網址 /p/123，由 vercel.json 轉進來）。
//
// 這頁存在的理由有兩個，而且兩個都要求「內容真的印在 HTML 裡」：
//   1. 分享到 IG／Threads／LINE 時的連結預覽（OG 標籤）
//   2. 讓 Google 索引得到貼文內容——港討的賣點就是「找得到以前的討論」，
//      但主站是單頁應用、網址用 #post/123，搜尋引擎看不到那些內容。
//
// 這頁以前是「印一組 OG 標籤然後立刻轉址回主站」。對搜尋引擎來說那等於
// 一個沒有內容的轉址頁：Google 會把它併到首頁，全站幾百篇貼文只會被當成
// 同一個網址，等於完全沒被索引。
//
// 做法：回傳的就是主站本身（index.html），只是換掉標題那些標籤，並且把
// 這篇貼文預先渲染進去。爬蟲不跑 JS 也讀得到完整內容；真人這邊 app.js
// 一開機就把預渲染換成正常的站內詳情頁，可以直接按讚留言、往下滑，
// 跟從站內點進去完全一樣，不用多按一次「開啟討論」。
// 兩者拿到的是同一份 HTML、同一份內容，不是給爬蟲看另一套。

import { fetchPost, fetchComments, fetchBoardLabel, excerpt } from "../lib/post-data.js";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 保留段落，其餘一律當純文字（貼文內容是使用者輸入，不能直接塞 HTML）
function paragraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const tpe = new Date(d.getTime() + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${tpe.getUTCFullYear()}/${p(tpe.getUTCMonth() + 1)}/${p(tpe.getUTCDate())} ${p(tpe.getUTCHours())}:${p(tpe.getUTCMinutes())}`;
}

function shell({ title, description, canonical, image, body, extraHead = "" }) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/HKHS.png">
<link rel="stylesheet" href="/style.css">
<meta property="og:type" content="article">
<meta property="og:site_name" content="港討 HKHS">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
${extraHead}
</head>
<body>
<div id="app">${body}</div>
<script>
  // 深淺色跟主站共用同一個設定
  if (localStorage.getItem("kgsh-theme") === "dark" ||
      (!localStorage.getItem("kgsh-theme") && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.dataset.theme = "dark";
  }
</script>
</body>
</html>`;
}

// 把主站的 index.html 拿來，換掉會影響預覽與搜尋結果的標籤，
// 再把預先渲染好的貼文插進去。抓不到（部署中、網路異常）就回傳 null，
// 呼叫端會退回獨立頁面，至少連結預覽和內容不會壞掉。
async function renderIntoApp(origin, { headTags, article }) {
  let html;
  try {
    const r = await fetch(`${origin}/index.html`);
    if (!r.ok) return null;
    html = await r.text();
  } catch {
    return null;
  }
  if (!html.includes('<div id="app">')) return null;   // 版型變了就別亂改

  // 拿掉原本的標題／描述／社群預覽標籤，換成這篇貼文的
  html = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="description"[^>]*>\s*/i, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/i, "")
    .replace(/<meta\s+property="og:[^>]*>\s*/gi, "")
    .replace(/<meta\s+name="twitter:[^>]*>\s*/gi, "")
    .replace("</head>", `${headTags}\n</head>`);

  // 預渲染放在 #app 前面，並先把 #app 藏起來：JS 還沒跑完的時候
  // （或者根本沒有 JS）看到的就是這篇貼文，而不是空白的骨架。
  return html.replace(
    '<div id="app">',
    `<style id="prerender-style">#app{display:none}</style>\n` +
    `<div id="prerender">${article}</div>\n<div id="app">`
  );
}

export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const { origin } = new URL(req.url, `${proto}://${req.headers.host}`);
  const id = req.query.id;
  const post = await fetchPost(id);

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  // 貼文不存在、已刪除或被隱藏 → 回 404，Google 才會把它從索引移除。
  // 以前這裡回 200 再轉址到首頁，等於告訴搜尋引擎「這頁還在」。
  if (!post) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send(shell({
      title: "找不到這篇貼文 — 港討 HKHS",
      description: "這篇貼文已被刪除或隱藏。",
      canonical: `${origin}/`,
      image: `${origin}/cover.png`,
      extraHead: '<meta name="robots" content="noindex">',
      body: `<main class="feed">
        <div class="feed-empty">
          <span class="emoji">🌊</span>
          <strong>找不到這篇貼文</strong>
          <p>它可能已經被刪除或隱藏了</p>
          <p style="margin-top:16px"><a class="seo-back" href="/">回到港討</a></p>
        </div>
      </main>`,
    }));
  }

  const [board, comments] = await Promise.all([
    fetchBoardLabel(post.board),
    fetchComments(post.id),
  ]);

  const headline = post.title || excerpt(post.body, 28);
  const title = `${headline} | 港討 ${board[0]}${board[1]}`;
  const description = excerpt(post.body, 100);
  const canonical = `${origin}/p/${post.id}`;

  // 讓 Google 知道這是一則討論串，而不是普通網頁
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline,
    articleBody: post.body,
    datePublished: post.created_at,
    url: canonical,
    author: { "@type": "Person", name: post.anon_name || "匿名" },
    isPartOf: { "@type": "WebSite", name: "港討 HKHS", url: `${origin}/` },
    interactionStatistic: [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: post.likes || 0 },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: comments.length },
    ],
    comment: comments.map((c) => ({
      "@type": "Comment",
      text: c.body,
      datePublished: c.created_at,
      author: { "@type": "Person", name: c.anon_name || "匿名" },
    })),
  };

  const commentsHtml = comments.length
    ? comments.map((c) => `<article class="seo-comment">
        <div class="seo-meta">${esc(c.anon_emoji || "🐢")} ${esc(c.anon_name || "匿名")} · <time datetime="${esc(c.created_at)}">${esc(formatDate(c.created_at))}</time></div>
        ${paragraphs(c.body)}
      </article>`).join("\n")
    : `<p class="dash-empty-hint">還沒有人留言</p>`;

  const image = `${origin}/api/og?id=${post.id}&format=card`;
  const headTags = `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="港討 HKHS">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`;

  const article = `
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="/" style="text-decoration:none;color:inherit">
            <img class="brand-logo" src="/HKHS.png" alt="港討">
            <div class="brand-text">
              <h1>港討</h1>
              <span>小港高中匿名版</span>
            </div>
          </a>
        </div>
      </header>

      <main class="feed">
        <article class="post-card" style="cursor:auto">
          <div class="post-head">
            <div class="avatar" style="background:var(--primary-soft)">${esc(post.anon_emoji || "🐢")}</div>
            <div class="post-meta">
              <div class="post-author">${esc(post.anon_name || "匿名")}</div>
              <div class="post-sub"><time datetime="${esc(post.created_at)}">${esc(formatDate(post.created_at))}</time></div>
            </div>
            <span class="board-tag">${esc(board[0])} ${esc(board[1])}</span>
          </div>
          ${post.title ? `<h1 class="post-title">${esc(post.title)}</h1>` : ""}
          <div class="seo-body">${paragraphs(post.body)}</div>
          <div class="post-foot">
            <span class="stat-btn">❤️ ${post.likes || 0}</span>
            <span class="stat-btn">💬 ${comments.length}</span>
          </div>
        </article>

        <h2 class="feed-section-title">留言（${comments.length}）</h2>
        ${commentsHtml}

        <p style="text-align:center;margin:20px 0">
          <a class="seo-cta" href="/#post/${post.id}">在港討開啟這篇討論 →</a>
        </p>
      </main>`;

  // 貼文刪除／隱藏後要盡快從搜尋結果消失，但也不能每次都重新產生（爬蟲會很頻繁），
  // 所以讓 CDN 快取一分鐘就好
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=60");

  const full = await renderIntoApp(origin, { headTags, article });
  if (full) return res.status(200).send(full);

  // 退路：抓不到主站就給獨立頁面。內容一樣完整，只是要多按一次才能互動。
  return res.status(200).send(shell({
    title, description, canonical, image,
    extraHead: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
    body: article + `<p style="text-align:center;margin-top:8px"><a class="seo-back" href="/">回到港討首頁</a></p>`,
  }));
}
