import { fetchPost, fetchBoardLabel, excerpt } from "../lib/post-data.js";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const { origin } = new URL(req.url, `${proto}://${req.headers.host}`);
  const id = req.query.id;
  const post = await fetchPost(id);

  const fallbackTitle = "港討 HKHS — 小港高中匿名討論區";
  const fallbackDesc = "專屬小港高中學生的匿名討論區，發文即時、留言即時、貼文可搜尋。";
  const appUrl = post ? `${origin}/#post/${id}` : `${origin}/`;

  let title = fallbackTitle;
  let description = fallbackDesc;
  let image = `${origin}/cover.png`;

  if (post) {
    const board = await fetchBoardLabel(post.board);
    const headline = post.title || excerpt(post.body, 28);
    title = `${headline} | 港討 ${board[0]}${board[1]}`;
    description = excerpt(post.body, 100);
    image = `${origin}/api/og?id=${id}&format=card`;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // 個資／版務考量：不快取，貼文被刪除或隱藏後，預覽要立刻反映
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="港討 HKHS">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(appUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head>
<body>
<p>正在前往港討⋯⋯若沒有自動跳轉，<a href="${esc(appUrl)}">點我查看貼文</a></p>
</body>
</html>`);
}
