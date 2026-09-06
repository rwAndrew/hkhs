// 社群同步的狀態查詢（版主除錯用，要帶密鑰）。
//
// 貼文沒同步到 IG／Threads 時，用這支看最近幾篇各自卡在哪一步：
// 是根本沒有紀錄（trigger 沒送到、排程沒撿到）、還是發佈失敗（看 last_error）。
//
//   GET /api/sync-status?secret=…        最近 10 篇
//   GET /api/sync-status?secret=…&n=30   最近 30 篇

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function sbGet(path) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`supabase GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export default async function handler(req, res) {
  if (req.query?.secret !== process.env.IG_CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const n = Math.min(Math.max(parseInt(req.query?.n, 10) || 10, 1), 50);

  try {
    const posts = await sbGet(
      `posts?order=id.desc&limit=${n}&select=id,title,board,hidden,created_at`
    );
    const ids = posts.map((p) => p.id).join(",");
    const [ig, th] = await Promise.all([
      sbGet(`ig_published?post_id=in.(${ids})&select=post_id,status,attempts,ig_media_id,last_error,published_at`),
      sbGet(`threads_published?post_id=in.(${ids})&select=post_id,status,attempts,threads_id,last_error,published_at`),
    ]);
    const igMap = new Map(ig.map((r) => [r.post_id, r]));
    const thMap = new Map(th.map((r) => [r.post_id, r]));

    const brief = (r) => {
      if (!r) return "沒有紀錄（還沒輪到，或通知沒送到）";
      if (r.status === "published") return `已發佈 ${r.ig_media_id || r.threads_id || ""}`.trim();
      return `${r.status}（第 ${r.attempts} 次）${r.last_error ? " → " + r.last_error : ""}`;
    };

    return res.json({
      now: new Date().toISOString(),
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title || "(無標題)",
        board: p.board,
        hidden: p.hidden,
        建立於: p.created_at,
        IG: brief(igMap.get(p.id)),
        Threads: brief(thMap.get(p.id)),
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message).slice(0, 400) });
  }
}
