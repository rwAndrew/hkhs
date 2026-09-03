// 每 5 分鐘由 Supabase pg_cron 呼叫：把新貼文自動發佈到 Instagram
//
// 流程：
//   1. 驗證密鑰（避免任何人都能觸發）
//   2. 讀取 ig_config 的 access token，超過 30 天自動續期（Meta token 壽命 60 天）
//   3. 找出「發佈滿 10 分鐘、未被隱藏、還沒發過 IG」的貼文
//      （等 10 分鐘是給檢舉機制反應時間，避免違規內容被轉發到 IG 上刪不掉）
//   4. 用現成的 /api/og 產圖（經 weserv 轉成 IG 要求的 JPEG）→ 發佈
//   5. 成功／失敗都記錄在 ig_published，失敗的下輪重試（最多 5 次）

const GRAPH = "https://graph.instagram.com";
const SITE = "https://hkhs.vercel.app";
const MAX_ATTEMPTS = 5;
const PUBLISH_DELAY_MS = 10 * 60e3;
const PER_RUN_LIMIT = 1;   // 每輪最多發 1 篇：等圖片處理完成最多要 45 秒，
                            // 配合 60 秒函式逾時上限，一輪處理多篇會有超時風險

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

// 輪詢圖片容器狀態，直到 IG 處理完成（FINISHED）才能發佈；ERROR 就直接放棄，
// 超過 45 秒還沒好也放棄（下一輪 cron 會重試，不會卡住整個函式逾時）
async function waitUntilFinished(creationId, token) {
  const deadline = Date.now() + 45e3;
  while (Date.now() < deadline) {
    const r = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR") throw new Error("media processing failed: " + JSON.stringify(r));
    await sleep(2500);
  }
  throw new Error("media not ready after 45s, will retry next run");
}

function buildCaption(p) {
  const body = (p.body || "").replace(/\s+/g, " ").trim();
  const text = p.title ? `${p.title}\n\n${body.slice(0, 300)}` : body.slice(0, 300);
  return `${text}\n\n💬 完整討論與留言 → ${SITE.replace("https://", "")}/p/${p.id}\n\n#港討 #小港高中 #匿名討論區`;
}

export default async function handler(req, res) {
  if (req.headers["x-cron-secret"] !== process.env.IG_CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY 還沒設定（Vercel 環境變數）" });
  }

  // ---- IG 設定與 token 續期 ----
  const cfgRows = await sbGet("ig_config?id=eq.1");
  const cfg = cfgRows[0];
  if (!cfg || !cfg.access_token) {
    return res.json({ ok: false, reason: "ig_config 還沒填入 access_token，見 README 的 IG 串接步驟" });
  }
  let token = cfg.access_token;

  const tokenAge = Date.now() - (Date.parse(cfg.refreshed_at) || 0);
  if (tokenAge > 30 * 24 * 3600e3) {
    const r = await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    if (r.access_token) {
      token = r.access_token;
      await sbWrite("ig_config?id=eq.1", "PATCH", { access_token: token, refreshed_at: new Date().toISOString() });
    }
  }

  let igUserId = cfg.ig_user_id;
  if (!igUserId) {
    const me = await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    igUserId = me.user_id || me.id;
    if (!igUserId) return res.json({ ok: false, reason: "token 無法取得 IG 帳號資訊", detail: me });
    await sbWrite("ig_config?id=eq.1", "PATCH", { ig_user_id: String(igUserId) });
  }

  // ---- 找出待發佈的貼文 ----
  const cutoff = new Date(Date.now() - PUBLISH_DELAY_MS).toISOString();
  const [posts, done] = await Promise.all([
    sbGet(`posts?hidden=eq.false&created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.asc&select=id,title,body,board,created_at&limit=50`),
    sbGet("ig_published?select=post_id,status,attempts"),
  ]);
  const doneMap = new Map(done.map((d) => [d.post_id, d]));
  const queue = posts
    .filter((p) => {
      const d = doneMap.get(p.id);
      return !d || (d.status === "failed" && d.attempts < MAX_ATTEMPTS);
    })
    .slice(0, PER_RUN_LIMIT);

  // ---- 逐篇發佈 ----
  const results = [];
  for (const p of queue) {
    const prev = doneMap.get(p.id);
    const attempts = (prev?.attempts || 0) + 1;
    try {
      // IG 只收 JPEG。post 格式是 3:4，比 IG 上限 4:5 更瘦長，IG 發佈時會置中
      // 裁掉多餘的上下（api/og.js 的 postLayout 已經把版面留在安全範圍內）
      const pngUrl = `${SITE}/api/og?id=${p.id}&format=post`;
      const jpgUrl = `https://images.weserv.nl/?url=${encodeURIComponent(pngUrl)}&output=jpg&q=88`;

      const create = await graph(`v21.0/${igUserId}/media`, {
        image_url: jpgUrl,
        caption: buildCaption(p),
        access_token: token,
      });
      if (!create.id) throw new Error("media create failed: " + JSON.stringify(create));

      // IG 建完圖片容器後要花幾秒在背景下載處理，太早發佈會報「Media ID is not
      // available」。輪詢容器狀態直到處理完成（FINISHED）再發佈，最多等 45 秒。
      await waitUntilFinished(create.id, token);

      const pub = await graph(`v21.0/${igUserId}/media_publish`, {
        creation_id: create.id,
        access_token: token,
      });
      if (!pub.id) throw new Error("media publish failed: " + JSON.stringify(pub));

      await sbWrite("ig_published", "POST", {
        post_id: p.id, ig_media_id: String(pub.id), status: "published", attempts,
      });
      results.push({ post: p.id, ok: true, ig_media_id: pub.id });
    } catch (e) {
      await sbWrite("ig_published", "POST", {
        post_id: p.id, status: "failed", attempts, last_error: String(e.message).slice(0, 500),
      }).catch(() => {});
      results.push({ post: p.id, ok: false, error: String(e.message).slice(0, 300) });
    }
  }

  res.json({ ok: true, checked: posts.length, queued: queue.length, results });
}
