/* ============================================================
   港討 資料庫層（Supabase）
   config.js 沒填金鑰時 DB.ready = false，app.js 自動退回
   展示模式（假資料）。介面程式完全共用。
   ============================================================ */

const DB = (() => {
  const cfg = window.KGSH_CONFIG || {};
  const ready = !!(cfg.url && cfg.anonKey && window.supabase);
  if (cfg.url && !window.supabase) {
    console.warn("港討：supabase-js 載入失敗，退回展示模式");
  }
  const client = ready ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

  // 每台裝置一個隨機代號（按讚／檢舉去重、發文冷卻用）。
  // 純亂數，與任何個人資訊無關，不會洩漏匿名者身分。
  let deviceId = localStorage.getItem("kgsh-device");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("kgsh-device", deviceId);
  }

  function likedSet() {
    try { return new Set(JSON.parse(localStorage.getItem("kgsh-likes")) || []); }
    catch { return new Set(); }
  }

  // ---------- DB 列 → 前端物件 ----------
  function mapComment(c) {
    return {
      id: c.id, anon: [c.anon_emoji, c.anon_name], text: c.body,
      time: Date.parse(c.created_at), reports: c.report_count, hidden: c.hidden,
    };
  }
  function mapPost(row, liked) {
    return {
      id: row.id, board: row.board, anon: [row.anon_emoji, row.anon_name],
      title: row.title, text: row.body, time: Date.parse(row.created_at),
      likes: row.likes, liked: liked.has(row.id),
      pinned: row.pinned, hidden: row.hidden, reports: row.report_count,
      comments: (row.comments || [])
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map(mapComment),
    };
  }

  const FETCH_SIZE = 200;
  let hasMore = false;

  async function must(query) {
    const { error } = await query;
    if (error) throw error;
  }

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function loadPosts(offset = 0) {
    const { data, error } = await client
      .from("posts")
      .select("*, comments(*)")
      .order("created_at", { ascending: false })
      .range(offset, offset + FETCH_SIZE - 1);
    if (error) throw error;
    hasMore = data.length === FETCH_SIZE;
    const liked = likedSet();
    return data.map((r) => mapPost(r, liked));
  }

  // 全站搜尋：標題、內文、留言（中文用子字串比對即可，不需斷詞）
  async function searchPosts(kw) {
    const safe = kw.replace(/[%_,().]/g, " ").trim();
    if (!safe) return [];
    const [byText, byComment] = await Promise.all([
      client.from("posts").select("*, comments(*)")
        .or(`title.ilike.%${safe}%,body.ilike.%${safe}%`).limit(100),
      client.from("comments").select("post_id").ilike("body", `%${safe}%`).limit(100),
    ]);
    if (byText.error) throw byText.error;
    const found = byText.data || [];
    const ids = new Set(found.map((r) => r.id));
    const extraIds = [...new Set((byComment.data || []).map((c) => c.post_id))]
      .filter((id) => !ids.has(id));
    let extra = [];
    if (extraIds.length) {
      const res = await client.from("posts").select("*, comments(*)").in("id", extraIds);
      extra = res.data || [];
    }
    const liked = likedSet();
    return [...found, ...extra].map((r) => mapPost(r, liked));
  }

  return {
    ready,
    get hasMore() { return hasMore; },

    // ---------- 版主登入 ----------
    isMod: async () => ready && !!(await client.auth.getSession()).data.session,
    signIn: (email, password) => client.auth.signInWithPassword({ email, password }),
    signOut: () => client.auth.signOut(),

    // ---------- 讀取 ----------
    loadBoards: async () => {
      const { data, error } = await client.from("boards").select("*").order("sort");
      if (error) throw error;
      return data.map((b) => ({ id: b.id, name: b.name, emoji: b.emoji, color: b.color, desc: b.descr }));
    },
    loadAbout: async () => {
      const { data, error } = await client.from("about_sections").select("*").order("id");
      if (error) throw error;
      return data.map((s) => ({ id: s.id, emoji: s.emoji, title: s.title, text: s.body }));
    },
    loadPosts,
    searchPosts,

    // ---------- 匿名寫入（走資料庫函式，規則在伺服器端） ----------
    createPost: async ({ board, title, text, anon }) => {
      const rows = await rpc("create_post", {
        p_board: board, p_title: title, p_body: text,
        p_emoji: anon[0], p_name: anon[1], p_device: deviceId,
      });
      return mapPost({ ...rows[0], comments: [] }, likedSet());
    },
    addComment: async (postId, text, anon) => {
      const rows = await rpc("add_comment", {
        p_post: postId, p_body: text, p_emoji: anon[0], p_name: anon[1], p_device: deviceId,
      });
      return mapComment(rows[0]);
    },
    toggleLike: (postId) =>
      ready ? rpc("toggle_like", { p_post: postId, p_device: deviceId }) : Promise.resolve(),
    report: async (type, id) => {
      const rows = await rpc("report_target", { p_type: type, p_id: id, p_device: deviceId });
      return { count: rows[0].report_count, hidden: rows[0].hidden };
    },

    // ---------- 版主操作（需登入，RLS 驗證） ----------
    updatePost: (id, patch) =>
      ready ? must(client.from("posts").update(patch).eq("id", id)) : Promise.resolve(),
    deletePost: (id) =>
      ready ? must(client.from("posts").delete().eq("id", id)) : Promise.resolve(),
    updateComment: (id, patch) =>
      ready ? must(client.from("comments").update(patch).eq("id", id)) : Promise.resolve(),
    deleteComment: (id) =>
      ready ? must(client.from("comments").delete().eq("id", id)) : Promise.resolve(),
    upsertBoard: (b, sort) =>
      ready ? must(client.from("boards").upsert({
        id: b.id, name: b.name, emoji: b.emoji, color: b.color, descr: b.desc,
        ...(sort != null ? { sort } : {}),
      })) : Promise.resolve(),
    deleteBoard: async (id, moveTo) => {
      if (!ready) return;
      await must(client.from("posts").update({ board: moveTo }).eq("board", id));
      await must(client.from("boards").delete().eq("id", id));
    },
    saveAboutSection: (s) =>
      ready ? must(client.from("about_sections").upsert({
        id: s.id, emoji: s.emoji, title: s.title, body: s.text,
      })) : Promise.resolve(),
  };
})();
