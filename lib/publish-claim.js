// 發佈前的「搶佔」：確保同一篇貼文不會被兩輪同時發出去。
//
// 為什麼需要：即時發佈（trigger）跟定時排程是兩條獨立的路徑，「重新發佈」又會
// 清掉紀錄立刻重發。只靠時間差錯開擋不住——兩邊可能同時讀到「這篇還沒發過」，
// 然後各發一次，社群上就出現重複貼文。
//
// 做法：發之前先在紀錄表插入一列 status='publishing'。主鍵是 post_id，所以第二個
// 想搶同一篇的會撞到重複鍵而失敗，它就知道有人正在處理、直接跳過。
// 已經有紀錄的情況（重試失敗的貼文）改用帶條件的更新，同樣只有一個人會成功。

// 一輪發佈最多跑 50 秒左右。超過這個時間還停在 publishing，代表那一輪中途掛了
// （函式逾時、機器重啟），讓後面的人可以接手，不然這篇會永遠卡住。
const STALE_MS = 10 * 60e3;

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// 這一列現在還輪得到我們處理嗎？（用來過濾出待發佈清單，真正的把關在 claim）
export function isPending(row, maxAttempts) {
  if (!row) return true;
  if (row.status === "failed") return row.attempts < maxAttempts;
  if (row.status === "publishing") {
    return Date.now() - (Date.parse(row.published_at) || 0) > STALE_MS;
  }
  return false;   // published / deleted / 其他，都不該再發一次
}

// 搶下這一篇。回傳 true 才可以發，false 代表別人已經在處理了。
export async function claim(table, postId, attempts) {
  const base = `${process.env.SUPABASE_URL}/rest/v1/${table}`;
  const now = new Date().toISOString();

  // 情況一：還沒有紀錄 → 直接插入。重複鍵（409）代表別人比我們快一步。
  const ins = await fetch(base, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ post_id: postId, status: "publishing", attempts, published_at: now }),
  });
  if (ins.ok) return true;
  if (ins.status !== 409) {
    throw new Error(`claim ${table}: ${ins.status} ${(await ins.text()).slice(0, 200)}`);
  }

  // 情況二：已經有紀錄 → 只有「失敗過」或「卡住太久」的可以接手。
  // 條件寫在更新的篩選裡，所以同時有兩個人來搶，只有一個會真的改到那一列。
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const cond = `or=(status.eq.failed,and(status.eq.publishing,published_at.lt.${stale}))`;
  const upd = await fetch(`${base}?post_id=eq.${postId}&${cond}`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ status: "publishing", attempts, published_at: now }),
  });
  if (!upd.ok) throw new Error(`claim ${table}: ${upd.status} ${(await upd.text()).slice(0, 200)}`);
  return (await upd.json()).length > 0;
}
