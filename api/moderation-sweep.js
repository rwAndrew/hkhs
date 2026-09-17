// 補審：發文當下審查服務全部掛掉的貼文（mod_status = unreviewed），由排程定期補審。
//   通過 → ok（之後會正常同步到社群）
//   擋下 → 隱藏
//   不確定 → review，留給版主在後台決定
// 審查服務還是全掛就先不動，下一輪再試。

import { secretMatches } from "../lib/secret.js";
import { moderate } from "../lib/moderation.js";

const PER_RUN = 8;
const RUN_BUDGET_MS = 40e3;

function h() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export default async function handler(req, res) {
  if (!secretMatches(req.headers["x-cron-secret"])) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const base = `${process.env.SUPABASE_URL}/rest/v1`;
  const posts = await fetch(
    `${base}/posts?mod_status=eq.unreviewed&hidden=eq.false&order=id.asc&limit=${PER_RUN}&select=id,title,body`,
    { headers: h() }
  ).then((r) => r.json());
  if (!Array.isArray(posts)) return res.json({ ok: false, detail: posts });

  const deadline = Date.now() + RUN_BUDGET_MS;
  const results = [];
  for (const p of posts) {
    if (Date.now() > deadline) break;
    const text = [p.title, p.body].filter(Boolean).join("\n");
    const r = await moderate(text);
    if (r.verdict === "unreviewed") {
      results.push({ id: p.id, still: "unreviewed" });
      break;   // 服務還是掛著，這輪先停，免得對每篇都白試一次
    }
    const patch = r.verdict === "block"
      ? { hidden: true, mod_status: "blocked" }
      : { mod_status: r.verdict === "allow" ? "ok" : "review" };
    await fetch(`${base}/posts?id=eq.${p.id}`, { method: "PATCH", headers: h(), body: JSON.stringify(patch) });
    if (r.verdict !== "allow") {
      await fetch(`${base}/moderation_log`, {
        method: "POST",
        headers: { ...h(), Prefer: "return=minimal" },
        body: JSON.stringify({
          verdict: r.verdict, matched: r.matched, reason: r.reason, model: r.model,
          post_id: p.id, excerpt: text.replace(/\s+/g, " ").slice(0, 300), detail: "補審",
        }),
      }).catch(() => {});
    }
    results.push({ id: p.id, verdict: r.verdict });
  }
  res.json({ ok: true, checked: posts.length, results });
}
