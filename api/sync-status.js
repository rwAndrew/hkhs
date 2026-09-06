// 社群同步的狀態查詢（版主除錯用，要帶密鑰）。
//
// 貼文沒同步到 IG／Threads 時，用這支看最近幾篇各自卡在哪一步：
// 是根本沒有紀錄（trigger 沒送到、排程沒撿到）、還是發佈失敗（看 last_error）。
//
//   GET /api/sync-status?secret=…        最近 10 篇
//   GET /api/sync-status?secret=…&n=30   最近 30 篇
//   GET /api/sync-status?secret=…&probe=1  另外拿兩邊的 token 各打一次讀取 API，
//                                          用來分辨「整個 App 被擋」還是「只有發佈被擋」
//                                          （只回傳 Meta 的回應，不會吐出 token）

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function sbGet(path) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`supabase GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// 兩種身分都放行：命令列除錯用密鑰，管理後台用版主登入後的 token。
// 站上只會有版主一個帳號，所以「有效的登入」等同於「是版主」，跟 db.js 的 isMod 一致。
async function authorized(req) {
  if (req.query?.secret === process.env.IG_CRON_SECRET) return true;
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth },
  });
  return r.ok;
}

export default async function handler(req, res) {
  if (!(await authorized(req))) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const n = Math.min(Math.max(parseInt(req.query?.n, 10) || 10, 1), 50);

  // ?requeue=43 把某篇重試失敗次數用完的貼文放回佇列（例如 Meta 那邊解封之後）。
  // 只清掉失敗紀錄，已成功發佈的不動，所以不會造成重複發文。
  const requeue = Number.isInteger(Number(req.query?.requeue)) ? Number(req.query.requeue) : null;
  if (requeue !== null) {
    const del = async (table) => {
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/${table}?post_id=eq.${requeue}&status=eq.failed`,
        { method: "DELETE", headers: sbHeaders() }
      );
      return r.ok ? "已重置" : `失敗 ${r.status}`;
    };
    const cleared = {
      IG: await del("ig_published"),
      Threads: await del("threads_published"),
    };
    // 清完馬上重發一次，不用等下一輪排程。失敗也沒關係，排程還是會撿。
    const republish = async (endpoint) => {
      try {
        const r = await fetch(`https://hkhs.vercel.app/api/${endpoint}`, {
          method: "POST",
          headers: { "x-cron-secret": process.env.IG_CRON_SECRET, "Content-Type": "application/json" },
          body: JSON.stringify({ post_id: requeue }),
        }).then((x) => x.json());
        const hit = r.results?.[0];
        if (!hit) return "沒有需要重發的";
        return hit.ok ? "已重新發佈" : "重發失敗：" + String(hit.error).slice(0, 200);
      } catch (e) {
        return "重發沒跑完，排程會再試：" + String(e.message).slice(0, 150);
      }
    };
    const [ig, th] = await Promise.all([republish("ig-publish"), republish("threads-publish")]);
    return res.json({ requeue, cleared, IG: ig, Threads: th });
  }

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
      if (r.status === "publishing") return "發佈中";
      return `${r.status}（第 ${r.attempts} 次）${r.last_error ? " → " + r.last_error : ""}`;
    };

    let probe;
    if (req.query?.probe) {
      const [igCfg, thCfg] = await Promise.all([
        sbGet("ig_config?id=eq.1&select=access_token"),
        sbGet("threads_config?id=eq.1&select=access_token"),
      ]);
      const ping = async (url, token) => {
        if (!token) return "沒有 token";
        try {
          return await fetch(`${url}&access_token=${encodeURIComponent(token)}`).then((r) => r.json());
        } catch (e) {
          return String(e.message).slice(0, 200);
        }
      };
      probe = {
        IG: await ping("https://graph.instagram.com/me?fields=id,username", igCfg[0]?.access_token),
        Threads: await ping("https://graph.threads.net/v1.0/me?fields=id,username", thCfg[0]?.access_token),
      };
    }

    return res.json({
      now: new Date().toISOString(),
      probe,
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
