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
// IG 一輪只發 1 篇，且兩篇之間隔很久（見下方 MIN_GAP_MS）。
// Threads 額度寬鬆，那邊維持 3 篇。
const PER_RUN_LIMIT = 1;
const RUN_BUDGET_MS = 45e3;
// 兩篇 IG 貼文之間至少隔這麼久。
//
// IG 的 content_publishing_limit 回報上限 100 篇／天，但那個數字不可信：
// 2026/09/07 實測發到第 51 篇之後，接下來連續 33 次全部被擋
// （code 9 / subcode 2207042，"User is performing too many actions"），
// 而額度用量就停在 51 不再增加。8 分鐘、5 分鐘、1 分鐘的間隔都一樣被擋，
// 所以那不是「發太快」，是這個帳號一天大概就只能發 50 篇左右。
//
// 15 分鐘 = 發文時段 780 分鐘 ÷ 52 篇，貼合實測到的真實上限。
// 發更快沒有意義，只會製造一堆失敗紀錄。
const MIN_GAP_MS = 15 * 60e3;

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
    await sleep(5000);   // 查太密會撞到 API 呼叫次數限制，反而讀不到狀態
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
  // ?dry=1：試跑。只回報「這一輪會發哪幾篇」，不會真的發文，也不佔額度。
  // 用來在夜間或改完程式後驗證取件邏輯，不必等到發文時段才知道有沒有寫錯。
  const dry = req.query?.dry === "1";

  // 夜間不發文，晚上的貼文排隊等早上（額度留給上課時間）
  if (!dry && !withinPostingHours()) {
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
  // 先只撈編號，不撈內文——積壓大的時候視窗要開得夠寬才不會有貼文被擠出去
  // 永遠輪不到，但連內文一起撈幾百篇會太肥。挑出要發的那幾篇之後再撈完整內容。
  const [candidates, done] = await Promise.all([
    only
      ? sbGet(`posts?id=eq.${only}&hidden=eq.false&select=id`)
      : sbGet(`posts?hidden=eq.false&created_at=lt.${encodeURIComponent(cutoff)}&order=id.desc&select=id&limit=1000`),
    only
      ? sbGet(`ig_published?post_id=eq.${only}&select=post_id,status,attempts,published_at`)
      : sbGet("ig_published?select=post_id,status,attempts,published_at&order=post_id.desc&limit=1000"),
  ]);
  const doneMap = new Map(done.map((d) => [d.post_id, d]));
  // 從舊到新發，社群上的順序才跟站上一致
  const allPending = candidates
    .filter((c) => isPending(doneMap.get(c.id), MAX_ATTEMPTS))
    .map((c) => c.id)
    .sort((a, b) => a - b);
  const pendingIds = allPending.slice(0, PER_RUN_LIMIT);
  const queue = pendingIds.length
    ? (await sbGet(`posts?id=in.(${pendingIds.join(",")})&select=id,title,body,board,created_at`))
        .sort((a, b) => a.id - b.id)
    : [];

  // ---- 逐篇發佈 ----
  // IG 有發文速度節流，兩篇之間要隔開，不然會被擋而且越擋越久。
  // 即時觸發也一樣要等——IG 在有流量的情況下本來就不可能做到即時同步，
  // 硬發只會被節流擋掉，反而更慢。等間隔到了排程會接手發。
  // 看的是「上次動到 IG 的時間」，成功失敗都算。只看成功的話，被限流擋掉時
  // 每分鐘都會再試一次，反而讓限流一直續命。
  const lastAt = done
    .filter((d) => d.published_at)
    .reduce((max, d) => Math.max(max, Date.parse(d.published_at) || 0), 0);
  const waitMs = lastAt + MIN_GAP_MS - Date.now();
  if (waitMs > 0) {
    return res.json({ ok: true, checked: candidates.length, queued: 0, results: [],
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
    return res.json({ ok: true, checked: candidates.length, queued: 0, results: [],
      reason: "今天的發文額度已用完，等額度重置後會自動繼續" });
  }

  if (dry) {
    // 重試次數用完的貼文不會再被撿起來，等於被默默放棄了。沒人看顧的時候
    // 這種「安靜的失敗」最危險，所以試跑時一併點出來。
    const stuck = candidates.filter((c) => {
      const d = doneMap.get(c.id);
      return d && d.status === "failed" && d.attempts >= MAX_ATTEMPTS;
    }).map((c) => c.id);
    return res.json({ dry: true, checked: candidates.length, backlog: allPending.length,
      stuck: stuck.length, stuckIds: stuck.slice(0, 20),
      queued: queue.length, ids: queue.map((p) => p.id), remaining });
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

  res.json({ ok: true, checked: candidates.length, queued: queue.length, results });
}
