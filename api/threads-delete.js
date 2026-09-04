// 由 Supabase 的 trigger 呼叫（貼文被刪除，或被隱藏時即時觸發，不用等排程）：
// 如果這篇貼文有真的發過 Threads，就把 Threads 上那篇也刪掉。

const GRAPH = "https://graph.threads.net/v1.0";

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

export default async function handler(req, res) {
  if (req.headers["x-cron-secret"] !== process.env.IG_CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY 還沒設定" });
  }

  const postId = req.body?.post_id;
  if (!postId) return res.status(400).json({ error: "missing post_id" });

  let cfgRows, rowRows;
  try {
    [cfgRows, rowRows] = await Promise.all([
      sbGet("threads_config?id=eq.1"),
      sbGet(`threads_published?post_id=eq.${postId}`),
    ]);
  } catch (e) {
    return res.json({ ok: false, reason: "讀取資料庫失敗（threads-delete-setup.sql 執行過了嗎？）", detail: String(e.message).slice(0, 300) });
  }

  const cfg = cfgRows[0];
  const row = rowRows[0];

  // 這篇根本沒真的發過 Threads（backfill 略過的、或還在排程等待的），或已經刪過了，
  // 什麼都不用做——這是正常情況，不是錯誤
  if (!row || row.status !== "published" || !row.threads_id) {
    return res.json({ ok: true, skipped: true, reason: "沒有對應的已發布 Threads 貼文" });
  }
  if (!cfg || !cfg.access_token) {
    return res.json({ ok: false, reason: "threads_config 沒有 token" });
  }

  try {
    const r = await fetch(
      `${GRAPH}/${row.threads_id}?access_token=${encodeURIComponent(cfg.access_token)}`,
      { method: "DELETE" }
    ).then((x) => x.json());
    if (r.success !== true) throw new Error("delete failed: " + JSON.stringify(r));

    await sbWrite(`threads_published?post_id=eq.${postId}`, "PATCH", { status: "deleted" });
    return res.json({ ok: true, deleted: row.threads_id });
  } catch (e) {
    await sbWrite(`threads_published?post_id=eq.${postId}`, "PATCH", {
      last_error: "同步刪除失敗：" + String(e.message).slice(0, 400),
    }).catch(() => {});
    return res.json({ ok: false, reason: "刪除失敗", detail: String(e.message).slice(0, 300) });
  }
}
