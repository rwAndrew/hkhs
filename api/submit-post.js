// 發文入口：先審查，通過才寫進資料庫。
//
// 以前瀏覽器是直接呼叫資料庫的 create_post 發文。改走這裡之後，資料庫那邊
// 已經收回匿名者的呼叫權限（moderation-setup.sql），否則按 F12 就能繞過審查。
//
// 版主以「版主」身分發文時不審查；版主用匿名身分發文時照常審查。

import { createHmac } from "node:crypto";
import { moderate } from "../lib/moderation.js";

// 匿名身分只能是站上這幾組。以前身分是前端送什麼就存什麼，改請求內容就能
// 用「版主」以外的任何字串冒充（例如夾零寬字元的「版主​」），或塞進幾 KB 的名字。
const ANON = new Map([
  ["匿名海豚", "🐬"], ["匿名鯨魚", "🐳"], ["匿名螃蟹", "🦀"], ["匿名章魚", "🐙"],
  ["匿名海龜", "🐢"], ["匿名海豹", "🦭"], ["匿名熱帶魚", "🐠"], ["匿名船長", "⚓"],
  ["匿名鯊魚", "🦈"], ["匿名海星", "🌟"], ["匿名魷魚", "🦑"], ["匿名貝殼", "🐚"],
]);

// 同一個來源短時間內的發文上限。學校 Wi-Fi 全校共用一個對外 IP，所以門檻
// 不能設成「一分鐘一篇」那種——那會讓全班同時發文的人互相卡住。
// 這裡擋的是「單一來源灌爆」：10 分鐘內超過 30 篇才擋。
const IP_WINDOW_MS = 10 * 60e3;
const IP_MAX_POSTS = 30;

// IP 不直接存，存的是加了密鑰的雜湊；資料庫外洩也還原不出 IP
function ipKey(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (!ip) return null;
  return "ip:" + createHmac("sha256", process.env.IG_CRON_SECRET || "").update(ip).digest("hex").slice(0, 40);
}

// 回傳 true 代表超過上限。表格不存在（security-setup.sql 還沒跑）就當沒有限制。
async function ipOverLimit(req) {
  const key = ipKey(req);
  if (!key) return false;
  const base = `${SB()}/rest/v1/rate_limits`;
  const now = Date.now();
  const rows = await fetch(`${base}?key=eq.${encodeURIComponent(key)}&select=count,window_start`, { headers: serviceHeaders() })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!Array.isArray(rows)) return false;
  const row = rows[0];
  const fresh = row && now - Date.parse(row.window_start) < IP_WINDOW_MS;
  if (fresh && row.count >= IP_MAX_POSTS) return true;
  await fetch(base, {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(fresh
      ? { key, count: row.count + 1, window_start: row.window_start }
      : { key, count: 1, window_start: new Date(now).toISOString() }),
  }).catch(() => {});
  return false;
}

const SB = () => process.env.SUPABASE_URL;

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function isMod(auth) {
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const r = await fetch(`${SB()}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth },
  });
  return r.ok;
}

async function log(entry) {
  await fetch(`${SB()}/rest/v1/moderation_log`, {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(entry),
  }).catch(() => {});   // 紀錄寫不進去不影響發文
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const { board, title = "", body, name, device } = req.body || {};
  if (typeof body !== "string" || !body.trim()) return res.status(400).json({ error: "EMPTY" });
  if (typeof title !== "string" || typeof board !== "string") return res.status(400).json({ error: "BAD_INPUT" });

  const mod = await isMod(req.headers.authorization);

  // 「版主」這個發文身分只有版主能用，其他人改請求內容冒用一律拒絕；
  // 其餘身分必須是站上的匿名海洋生物之一，emoji 也以伺服器這邊的對照表為準
  const asModIdentity = name === "版主";
  if (asModIdentity && !mod) return res.status(403).json({ error: "NOTICE_MOD_ONLY" });
  if (!asModIdentity && !ANON.has(name)) return res.status(400).json({ error: "BAD_INPUT" });
  const safeEmoji = asModIdentity ? "📣" : ANON.get(name);
  if (typeof device !== "string" || !/^[0-9a-f-]{36}$/i.test(device)) return res.status(400).json({ error: "BAD_INPUT" });

  if (!mod && await ipOverLimit(req)) return res.status(429).json({ error: "COOLDOWN" });

  // ---- 審查 ----
  // 只有「以版主身分發文」才跳過審查（公告可能需要提到人名，例如表揚同學）。
  // 版主用匿名身分發文時，外觀跟一般同學完全一樣，就跟一般同學一樣審查——
  // 以前是「有登入就跳過」，結果版主用匿名身分發的班級座號也直接通過了。
  // 緊急開關：在 Vercel 設 MOD_DISABLED=1 就暫停審查、全部放行，
  // 用在審查端點本身出問題、導致沒人能發文的時候
  let result = { verdict: "allow" };
  if (!(mod && asModIdentity) && process.env.MOD_DISABLED !== "1") {
    result = await moderate([title, body].filter(Boolean).join("\n"));
    if (result.verdict === "block") {
      await log({
        verdict: "block", matched: result.matched, reason: result.reason,
        model: result.model, excerpt: [title, body].filter(Boolean).join(" ").slice(0, 300),
      });
      return res.status(422).json({ blocked: true, matched: result.matched, reason: result.reason });
    }
  }

  // ---- 寫入 ----
  // 審查結果為「不確定」或「審查服務全掛」時照常發佈，但狀態不是 ok，
  // IG／Threads 的發佈程式只撿 ok 的，所以這些不會被同步出去。
  const modStatus = result.verdict === "allow" ? "ok" : result.verdict;   // review | unreviewed
  const rpcHeaders = mod
    ? { apikey: process.env.SUPABASE_ANON_KEY, Authorization: req.headers.authorization, "Content-Type": "application/json" }
    : serviceHeaders();

  const args = {
    p_board: board, p_title: title, p_body: body,
    p_emoji: safeEmoji, p_name: name, p_device: device,
  };
  const callRpc = (payload) => fetch(`${SB()}/rest/v1/rpc/create_post`, {
    method: "POST", headers: rpcHeaders, body: JSON.stringify(payload),
  });
  let r = await callRpc({ ...args, p_mod_status: modStatus });
  let data = await r.json().catch(() => null);
  // 相容：moderation-setup.sql 還沒執行時，資料庫的 create_post 沒有 p_mod_status
  // 這個參數（PGRST202 找不到函式）。改用舊參數發文，網站不會因為部署順序而停擺。
  if (!r.ok && data?.code === "PGRST202") {
    r = await callRpc(args);
    data = await r.json().catch(() => null);
  }
  if (!r.ok) {
    // 資料庫的錯誤代碼（COOLDOWN、TOO_LONG、NOTICE_MOD_ONLY…）原樣傳回，前端有對應的中文訊息
    return res.status(400).json({ error: data?.message || "資料庫寫入失敗" });
  }
  const post = Array.isArray(data) ? data[0] : data;

  if (modStatus !== "ok") {
    await log({
      verdict: modStatus, matched: result.matched || "", reason: result.reason || "",
      model: result.model || "", post_id: post?.id,
      excerpt: [title, body].filter(Boolean).join(" ").slice(0, 300),
      detail: (result.failures || []).join("\n").slice(0, 1000) || null,
    });
  }

  return res.status(200).json({ post, moderation: modStatus });
}
