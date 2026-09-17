// 發文入口：先審查，通過才寫進資料庫。
//
// 以前瀏覽器是直接呼叫資料庫的 create_post 發文。改走這裡之後，資料庫那邊
// 已經收回匿名者的呼叫權限（moderation-setup.sql），否則按 F12 就能繞過審查。
//
// 版主發文不審查：帶著登入 token 進來，就用版主身分直接呼叫資料庫。

import { moderate } from "../lib/moderation.js";

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

  const { board, title = "", body, emoji, name, device } = req.body || {};
  if (typeof body !== "string" || !body.trim()) return res.status(400).json({ error: "EMPTY" });
  if (typeof title !== "string" || typeof board !== "string") return res.status(400).json({ error: "BAD_INPUT" });

  const mod = await isMod(req.headers.authorization);

  // ---- 審查（版主跳過）----
  // 緊急開關：在 Vercel 設 MOD_DISABLED=1 就暫停審查、全部放行，
  // 用在審查端點本身出問題、導致沒人能發文的時候
  let result = { verdict: "allow" };
  if (!mod && process.env.MOD_DISABLED !== "1") {
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
    p_emoji: String(emoji || "🐢"), p_name: String(name || "匿名"), p_device: device,
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
