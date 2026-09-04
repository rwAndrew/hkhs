// 把新貼文自動發佈到 Threads。兩種觸發方式：
//   1. 貼文一發出來，資料庫 trigger 立刻帶著 post_id 打過來 → 幾秒內就上架
//   2. pg_cron 定時空手呼叫 → 補救網，撿走 trigger 沒送到或當下發佈失敗的貼文
// 架構跟 ig-publish.js 幾乎一樣（同一套 Meta 帳號體系、同樣的容器→輪詢→發佈模式），
// 差異只在 API 端點是 graph.threads.net，欄位命名和發文字數上限不同。

import { fetchPost, fetchCommentCount, fetchBoardLabel, excerpt } from "../lib/post-data.js";

const GRAPH = "https://graph.threads.net/v1.0";
const SITE = "https://hkhs.vercel.app";
const MAX_ATTEMPTS = 5;
// 補救網的門檻：只撿「發出來超過 3 分鐘還沒上架」的貼文。
// 這個等待時間同時也避免了跟 trigger 撞在一起重複發佈——trigger 那一輪最久
// 也只跑約 50 秒，早就寫完紀錄了，定時任務才會看到這篇。
const PUBLISH_DELAY_MS = 3 * 60e3;
const PER_RUN_LIMIT = 1;      // 跟 ig-publish 一樣：等處理完成最多要 45 秒，一輪只處理 1 篇避免逾時
const TEXT_LIMIT = 480;       // Threads 上限 500 字，留一點餘裕

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function sbGet(path) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`supabase GET ${path}: ${r.status}`);
  return r.json();
}

async function sbWrite(path, method, body) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`supabase ${method} ${path}: ${r.status} ${await r.text()}`);
}

async function graph(path, params) {
  const body = new URLSearchParams(params);
  const r = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  return r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Threads 容器狀態欄位叫 status（不是 IG 的 status_code），值有
// IN_PROGRESS / FINISHED / ERROR / EXPIRED，一樣要等 FINISHED 才能發佈
async function waitUntilFinished(creationId, token) {
  const deadline = Date.now() + 45e3;
  while (Date.now() < deadline) {
    const r = await fetch(`${GRAPH}/${creationId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    if (r.status === "FINISHED") return;
    if (r.status === "ERROR" || r.status === "EXPIRED") throw new Error("media processing failed: " + JSON.stringify(r));
    await sleep(2500);
  }
  throw new Error("media not ready after 45s, will retry next run");
}

function buildCaption(p) {
  const body = (p.body || "").replace(/\s+/g, " ").trim();
  const tail = `\n\n💬 完整討論與留言 → ${SITE.replace("https://", "")}/p/${p.id}\n\n#港討 #小港高中`;
  const budget = TEXT_LIMIT - tail.length - (p.title ? p.title.length + 2 : 0);
  const text = p.title ? `${p.title}\n\n${excerpt(body, Math.max(budget, 0))}` : excerpt(body, Math.max(TEXT_LIMIT - tail.length, 0));
  return `${text}${tail}`;
}

export default async function handler(req, res) {
  if (req.headers["x-cron-secret"] !== process.env.IG_CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY 還沒設定（Vercel 環境變數）" });
  }

  // ---- Threads 設定與 token 續期 ----
  let cfgRows;
  try {
    cfgRows = await sbGet("threads_config?id=eq.1");
  } catch (e) {
    // 最常見情況：threads-setup.sql 還沒執行，資料表根本不存在
    return res.json({ ok: false, reason: "讀不到 threads_config，threads-setup.sql 執行過了嗎？", detail: String(e.message).slice(0, 300) });
  }
  const cfg = cfgRows[0];
  if (!cfg || !cfg.access_token) {
    return res.json({ ok: false, reason: "threads_config 還沒填入 access_token，見 README 的 Threads 串接步驟" });
  }
  let token = cfg.access_token;

  const tokenAge = Date.now() - (Date.parse(cfg.refreshed_at) || 0);
  if (tokenAge > 30 * 24 * 3600e3) {
    const r = await fetch(`${GRAPH}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    if (r.access_token) {
      token = r.access_token;
      await sbWrite("threads_config?id=eq.1", "PATCH", { access_token: token, refreshed_at: new Date().toISOString() });
    }
  }

  let userId = cfg.threads_user_id;
  if (!userId) {
    const me = await fetch(`${GRAPH}/me?fields=id,username&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    userId = me.id;
    if (!userId) return res.json({ ok: false, reason: "token 無法取得 Threads 帳號資訊", detail: me });
    await sbWrite("threads_config?id=eq.1", "PATCH", { threads_user_id: String(userId) });
  }

  // ---- 找出待發佈的貼文（跟 IG 各自獨立紀錄，同一篇會分別發到 IG 和 Threads） ----
  // trigger 會帶 post_id 進來，指名處理剛發出來的那一篇，不受上面的等待時間限制
  // 只收整數，避免帶進查詢字串的值被拿來拼接出別的查詢條件
  const only = Number.isInteger(Number(req.body?.post_id)) ? Number(req.body.post_id) : null;
  const cutoff = new Date(Date.now() - PUBLISH_DELAY_MS).toISOString();
  const [posts, done] = await Promise.all([
    only
      ? sbGet(`posts?id=eq.${only}&hidden=eq.false&select=id,title,body,board,created_at`)
      : sbGet(`posts?hidden=eq.false&created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.asc&select=id,title,body,board,created_at&limit=50`),
    only
      ? sbGet(`threads_published?post_id=eq.${only}&select=post_id,status,attempts`)
      : sbGet("threads_published?select=post_id,status,attempts"),
  ]);
  const doneMap = new Map(done.map((d) => [d.post_id, d]));
  const queue = posts
    .filter((p) => {
      const d = doneMap.get(p.id);
      return !d || (d.status === "failed" && d.attempts < MAX_ATTEMPTS);
    })
    .slice(0, PER_RUN_LIMIT);

  const results = [];
  for (const p of queue) {
    const prev = doneMap.get(p.id);
    const attempts = (prev?.attempts || 0) + 1;
    try {
      const pngUrl = `${SITE}/api/og?id=${p.id}&format=post`;
      const jpgUrl = `https://images.weserv.nl/?url=${encodeURIComponent(pngUrl)}&output=jpg&q=88`;

      const create = await graph(userId + "/threads", {
        media_type: "IMAGE",
        image_url: jpgUrl,
        text: buildCaption(p),
        access_token: token,
      });
      if (!create.id) throw new Error("container create failed: " + JSON.stringify(create));

      await waitUntilFinished(create.id, token);

      const pub = await graph(userId + "/threads_publish", {
        creation_id: create.id,
        access_token: token,
      });
      if (!pub.id) throw new Error("publish failed: " + JSON.stringify(pub));

      await sbWrite("threads_published", "POST", {
        post_id: p.id, threads_id: String(pub.id), status: "published", attempts,
      });
      results.push({ post: p.id, ok: true, threads_id: pub.id });
    } catch (e) {
      await sbWrite("threads_published", "POST", {
        post_id: p.id, status: "failed", attempts, last_error: String(e.message).slice(0, 500),
      }).catch(() => {});
      results.push({ post: p.id, ok: false, error: String(e.message).slice(0, 300) });
    }
  }

  res.json({ ok: true, checked: posts.length, queued: queue.length, results });
}
