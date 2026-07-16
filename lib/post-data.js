// 分享圖與連結預覽共用的資料存取層。
// 讀取 Vercel 環境變數 SUPABASE_URL / SUPABASE_ANON_KEY（跟 config.js 用同一組公開值即可）。

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const FALLBACK_BOARDS = {
  chat: ["💬", "閒聊"], study: ["📚", "課業"], club: ["🎸", "社團"],
  love: ["💘", "感情"], food: ["🍱", "美食"], trade: ["🏷️", "二手"], notice: ["📣", "公告"],
};

export async function fetchPost(id) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !id) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&hidden=eq.false&select=id,board,anon_emoji,anon_name,title,body,likes`,
    { headers: { apikey: SUPABASE_ANON_KEY } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

export async function fetchCommentCount(id) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !id) return 0;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/comments?post_id=eq.${encodeURIComponent(id)}&hidden=eq.false&select=id`,
    { headers: { apikey: SUPABASE_ANON_KEY, Prefer: "count=exact" } }
  );
  const range = res.headers.get("content-range"); // 格式："0-2/3"
  if (!range) return 0;
  return Number(range.split("/")[1]) || 0;
}

export async function fetchBoardLabel(boardId) {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/boards?id=eq.${encodeURIComponent(boardId)}&select=name,emoji`,
        { headers: { apikey: SUPABASE_ANON_KEY } }
      );
      const rows = res.ok ? await res.json() : [];
      if (rows[0]) return [rows[0].emoji, rows[0].name];
    } catch { /* 掉線就用內建對照表 */ }
  }
  return FALLBACK_BOARDS[boardId] || ["📋", boardId];
}

export function excerpt(text, max) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}
