// 把新貼文自動發佈到 Instagram。兩種觸發方式：
//   1. 貼文一發出來，資料庫 trigger 立刻帶著 post_id 打過來 → 幾秒內就上架
//   2. pg_cron 每分鐘空手呼叫 → 補救網，撿走 trigger 沒送到或當下發佈失敗的貼文
//
// 注意：IG 這條線沒有同步刪除（刪除要走 Facebook 登入那套，跟本站用的
// Instagram 登入不相容），發出去之後只能人工到 IG 上刪。版主選擇即時同步，
// 代表放棄「等檢舉反應」這道緩衝——違規貼文會先上 IG，事後要手動清掉。
//
// 流程：
//   1. 驗證密鑰（避免任何人都能觸發）
//   2. 讀取 ig_config 的 access token，超過 30 天自動續期（Meta token 壽命 60 天）
//   3. 找出未被隱藏、還沒發過 IG 的貼文
//   4. 用現成的 /api/og 產圖（經 weserv 轉成 IG 要求的 JPEG）→ 發佈
//   5. 成功／失敗都記錄在 ig_published，失敗的下輪重試（最多 5 次）

import { imageUrl, warmImage } from "../lib/social-image.js";
import { claim, isPending, isQuotaError, withinPostingHours, postingHoursText } from "../lib/publish-claim.js";

const GRAPH = "https://graph.instagram.com";
const SITE = "https://hkhs.vercel.app";
const MAX_ATTEMPTS = 5;
// 補救網的門檻：只撿「發出來超過 3 分鐘還沒上架」的貼文。
// 這個時間差也讓定時任務不會跟 trigger 撞在一起重複發佈——trigger 那一輪
// 最久也只跑約 50 秒，早就寫完紀錄了，定時任務才會看到這篇。
const PUBLISH_DELAY_MS = 3 * 60e3;
// IG 一輪只發 1 篇。一分鐘 3 篇會撞到 IG 的瞬時速率限制
//（"User is performing too many actions"），而且撞了也沒好處：
// IG 每天上限 100 篇，平均約 14 分鐘才輪到一篇，每分鐘 1 篇（一天 1440 篇的
// 處理能力）早就遠遠超過每日額度了。Threads 額度寬鬆，那邊維持 3 篇。
const PER_RUN_LIMIT = 1;
const RUN_BUDGET_MS = 45e3;
// 兩篇 IG 貼文之間至少隔這麼久。IG 除了每日 100 篇的總量，還有一套獨立的
// 「發太快」節流（code 9 / subcode 2207042，訊息是 User is performing too
// many actions），實測每分鐘 1 篇就會踩到。每 5 分鐘 1 篇 = 一天 288 篇的
// 處理能力，本來就遠超過每日 100 篇的上限，不會變成瓶頸。
const MIN_GAP_MS = 5 * 60e3;

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
  let last;
  while (Date.now() < deadline) {
    // status 欄位帶著 IG 對這個容器的說明（例如圖片抓不到的原因），
    // 只看 status_code 的話逾時錯誤裡什麼線索都沒有
    const r = await fetch(`${GRAPH}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    last = r;
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR") throw new Error("media processing failed: " + JSON.stringify(r));
    await sleep(2500);
  }
  throw new Error("media not ready after 45s: " + JSON.stringify(last));
}

function buildCaption(p) {
  const body = (p.body || "").replace(/\s+/g, " ").trim();
  const text = p.title ? `${p.title}\n\n${body.slice(0, 300)}` : body.slice(0, 300);
  return `${text}\n\n💬 完整討論與留言 → ${SITE.replace("https://", "")}/p/${p.id}\n\n#小港高中 #港討 #匿名討論區`;
}

export default async function handler(req, res) {
  if (req.headers["x-cron-secret"] !== process.env.IG_CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // 夜間不發文，晚上的貼文排隊等早上（額度留給上課時間）
  if (!withinPostingHours()) {
    return res.json({ ok: true, queued: 0, results: [],
      reason: `現在不在發文時段（${postingHoursText}），貼文會排隊等時段開始` });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY 還沒設定（Vercel 環境變數）" });
  }

  // ---- IG 設定與 token 續期 ----
  let cfgRows;
  try {
    cfgRows = await sbGet("ig_config?id=eq.1");
  } catch (e) {
    // 最常見情況：ig-setup.sql 還沒執行，資料表根本不存在
    return res.json({ ok: false, reason: "讀不到 ig_config，ig-setup.sql 執行過了嗎？", detail: String(e.message).slice(0, 300) });
  }
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
  // trigger 會帶 post_id 進來，指名處理剛發出來的那一篇，不受上面的等待時間限制。
  // 只收整數，避免帶進查詢字串的值被拿來拼接出別的查詢條件
  const only = Number.isInteger(Number(req.body?.post_id)) ? Number(req.body.post_id) : null;
  const cutoff = new Date(Date.now() - PUBLISH_DELAY_MS).toISOString();
  const [posts, done] = await Promise.all([
    only
      ? sbGet(`posts?id=eq.${only}&hidden=eq.false&select=id,title,body,board,created_at`)
      : sbGet(`posts?hidden=eq.false&created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.desc&select=id,title,body,board,created_at&limit=200`),
    only
      ? sbGet(`ig_published?post_id=eq.${only}&select=post_id,status,attempts,published_at`)
      : sbGet("ig_published?select=post_id,status,attempts,published_at&order=post_id.desc&limit=400"),
  ]);
  const doneMap = new Map(done.map((d) => [d.post_id, d]));
  // 取回來的是最新的 200 篇（不能取最舊的——貼文數超過上限之後，新貼文就永遠
  // 排不進來了），挑出還沒處理的，再從舊到新發，社群上的順序才跟站上一致。
  // 視窗開到 200 是為了撐住尖峰：全校一天的量加上社群那邊的每日額度限制，
  // 積壓有可能累積到上百篇。
  const queue = posts
    .filter((p) => isPending(doneMap.get(p.id), MAX_ATTEMPTS))
    .sort((a, b) => a.id - b.id)
    .slice(0, PER_RUN_LIMIT);

  // ---- 逐篇發佈 ----
  // IG 有發文速度節流，兩篇之間要隔開，不然會被擋而且越擋越久。
  // 即時觸發也一樣要等——IG 在有流量的情況下本來就不可能做到即時同步，
  // 硬發只會被節流擋掉，反而更慢。等間隔到了排程會接手發。
  const lastAt = done
    .filter((d) => d.status === "published" && d.published_at)
    .reduce((max, d) => Math.max(max, Date.parse(d.published_at) || 0), 0);
  const waitMs = lastAt + MIN_GAP_MS - Date.now();
  if (waitMs > 0) {
    return res.json({ ok: true, checked: posts.length, queued: 0, results: [],
      reason: `距離上一篇 IG 貼文還不到 ${Math.round(MIN_GAP_MS / 60e3)} 分鐘，還要等 ${Math.ceil(waitMs / 60e3)} 分鐘` });
  }

  // 先問清楚今天還能發幾篇。額度滿了就整輪收工——硬發只會換來一堆失敗紀錄，
  // 還會把重試次數燒光，隔天額度重置反而沒人補發。
  let remaining = Infinity;
  try {
    const q = await fetch(`https://graph.instagram.com/me/content_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(token)}`).then((x) => x.json());
    const row = q.data?.[0];
    if (row) remaining = (row.config?.quota_total ?? Infinity) - (row.quota_usage ?? 0);
  } catch {
    // 查不到就照常發，真的超額 Meta 會擋，下面有處理
  }
  if (remaining <= 0) {
    return res.json({ ok: true, checked: posts.length, queued: 0, results: [],
      reason: "今天的發文額度已用完，等額度重置後會自動繼續" });
  }

  const results = [];
  const deadline = Date.now() + RUN_BUDGET_MS;
  for (const p of queue) {
    if (Date.now() > deadline) break;   // 快逾時了，剩下的留給下一輪
    if (remaining <= 0) break;          // 這一輪把額度用完了
    const prev = doneMap.get(p.id);
    const attempts = (prev?.attempts || 0) + 1;
    // 搶不到代表另一輪（排程或即時觸發）正在發這一篇，跳過才不會重複發文
    if (!(await claim("ig_published", p.id, attempts))) {
      results.push({ post: p.id, skipped: "另一輪正在處理" });
      continue;
    }
    try {
      // post 格式是 3:4，比 IG 上限 4:5 更瘦長，IG 發佈時會置中裁掉多餘的上下
      //（api/og.js 的 postLayout 已經把版面留在安全範圍內）
      const jpgUrl = imageUrl(p.id);
      await warmImage(jpgUrl);

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
      remaining--;
      results.push({ post: p.id, ok: true, ig_media_id: pub.id });
    } catch (e) {
      // 額度不足不是這篇的錯，次數退回去，等額度重置後照樣會被撿起來重發
      const quota = isQuotaError(e.message);
      await sbWrite("ig_published", "POST", {
        post_id: p.id,
        status: "failed",
        attempts: quota ? attempts - 1 : attempts,
        last_error: String(e.message).slice(0, 500),
      }).catch(() => {});
      results.push({ post: p.id, ok: false, quota, error: String(e.message).slice(0, 300) });
      if (quota) { remaining = 0; break; }
    }
  }

  res.json({ ok: true, checked: posts.length, queued: queue.length, results });
}
