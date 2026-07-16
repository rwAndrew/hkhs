/* ============================================================
   港討 HKHS — 前端原型（假資料版）
   之後串接資料庫時，把 POSTS 改為 API 讀取即可
   ============================================================ */

// ---------- 看板 ----------
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

const DEFAULT_BOARDS = [
  { id: "all",    name: "全部",   emoji: "🌊", color: "#E0F5F5", desc: "所有貼文" },
  { id: "chat",   name: "閒聊",   emoji: "💬", color: "#E8F0FE", desc: "什麼都能聊" },
  { id: "study",  name: "課業",   emoji: "📚", color: "#FFF4E0", desc: "考試、讀書、升學" },
  { id: "club",   name: "社團",   emoji: "🎸", color: "#F3E8FF", desc: "社團活動與招生" },
  { id: "love",   name: "感情",   emoji: "💘", color: "#FFE8EE", desc: "戀愛煩惱、告白牆" },
  { id: "food",   name: "美食",   emoji: "🍱", color: "#E8F8E8", desc: "小港週邊美食情報" },
  { id: "trade",  name: "二手",   emoji: "🏷️", color: "#FFF0E6", desc: "課本、制服、雜物轉賣" },
  { id: "notice", name: "公告",   emoji: "📣", color: "#FFEFEF", desc: "版務與活動公告" },
];

let BOARDS = loadJSON("kgsh-boards") || DEFAULT_BOARDS.map((b) => ({ ...b }));
function saveBoards() {
  if (DB.ready) return;   // 資料庫模式：看板存 DB，不用 localStorage
  localStorage.setItem("kgsh-boards", JSON.stringify(BOARDS));
}

// ---------- 關於頁內容（版主可編輯） ----------
const DEFAULT_ABOUT = [
  { emoji: "🌊", title: "關於港討", text: "「港討」是專屬小港高中學生的匿名討論區。不用再私訊 IG 等版主截圖，發文即時、留言即時、貼文可搜尋。" },
  { emoji: "📜", title: "版規", text: "1. 禁止洩漏他人個資（姓名、班級座號、照片）\n2. 禁止霸凌、人身攻擊、歧視言論\n3. 禁止商業廣告與詐騙訊息\n4. 違規貼文將由版主移除，情節重大者停權" },
  { emoji: "🔒", title: "匿名機制", text: "每篇貼文與留言都會隨機分配一個海洋生物身分，不會顯示你的任何個人資訊。" },
];

let ABOUT = loadJSON("kgsh-about") || DEFAULT_ABOUT.map((s, i) => ({ ...s, id: i + 1 }));
function saveAbout() {
  if (DB.ready) return;
  localStorage.setItem("kgsh-about", JSON.stringify(ABOUT));
}

// ---------- 匿名身分 ----------
const ANON = [
  ["🐬", "匿名海豚"], ["🐳", "匿名鯨魚"], ["🦀", "匿名螃蟹"], ["🐙", "匿名章魚"],
  ["🐢", "匿名海龜"], ["🦭", "匿名海豹"], ["🐠", "匿名熱帶魚"], ["⚓", "匿名船長"],
  ["🦈", "匿名鯊魚"], ["🌟", "匿名海星"], ["🦑", "匿名魷魚"], ["🐚", "匿名貝殼"],
];

const AVATAR_BG = ["#E0F5F5", "#E8F0FE", "#FFF4E0", "#F3E8FF", "#FFE8EE", "#E8F8E8", "#FFF0E6"];

// ---------- 假資料 ----------
const now = Date.now();
const H = 3600e3, M = 60e3;

let POSTS = [
  {
    id: 1, board: "notice", anon: ["📣", "版主"], time: now - 2 * H, likes: 87, liked: false, pinned: true,
    title: "🎉 港討匿名版正式上線！",
    text: "以前大家投稿都要私訊 IG 等版主截圖上傳，想找舊貼文根本大海撈針。現在有了「港討」，發文即時、留言即時，最重要的是——終於可以搜尋了！\n\n版規：\n1. 禁止洩漏他人個資（姓名、班級座號、照片）\n2. 禁止霸凌、人身攻擊\n3. 禁止商業廣告\n\n祝大家使用愉快 🌊",
    comments: [
      { anon: ["🐬", "匿名海豚"], text: "終於不用等版主上線了 QQ 推推", time: now - 1.8 * H },
      { anon: ["🦀", "匿名螃蟹"], text: "搜尋功能真的太重要，以前想找二手課本的貼文都找不到", time: now - 1.5 * H },
    ],
  },
  {
    id: 2, board: "study", anon: ["🐢", "匿名海龜"], time: now - 3 * H, likes: 42, liked: false,
    title: "段考數學大家都讀哪本講義？",
    text: "下週就要段考了，數學的三角函數還是一團亂…想問大家補習班或自己讀的講義推薦哪本？還是有學長姐可以分享筆記 🙏",
    comments: [
      { anon: ["🐠", "匿名熱帶魚"], text: "推對面書局那本黃色的，例題很多", time: now - 2.5 * H },
      { anon: ["⚓", "匿名船長"], text: "學測複習全套借你，私我（開玩笑，這裡是匿名版XD）", time: now - 2 * H },
      { anon: ["🦭", "匿名海豹"], text: "三角函數先把單位圓搞懂，公式用背的會死", time: now - 1 * H },
    ],
  },
  {
    id: 3, board: "food", anon: ["🦑", "匿名魷魚"], time: now - 5 * H, likes: 65, liked: false,
    title: "放學後的鹹酥雞攤是不是換老闆了",
    text: "今天買了一份總覺得味道不太一樣，九層塔給超多但雞肉好像變小塊了…有人也有發現嗎？還是只有我嘴挑 😂",
    comments: [
      { anon: ["🐳", "匿名鯨魚"], text: "真的！我上禮拜就發現了，甜不辣倒是變好吃", time: now - 4 * H },
    ],
  },
  {
    id: 4, board: "love", anon: ["🐚", "匿名貝殼"], time: now - 8 * H, likes: 128, liked: false,
    title: "",
    text: "給每天在圖書館三樓靠窗座位讀書的那位同學：你認真的側臉真的很好看。來自一個一直不敢跟你講話的人。",
    comments: [
      { anon: ["🌟", "匿名海星"], text: "戀愛了戀愛了！！衝一波啦", time: now - 7 * H },
      { anon: ["🐙", "匿名章魚"], text: "圖書館三樓+1，我明天要去看是誰（不是", time: now - 6 * H },
      { anon: ["🦈", "匿名鯊魚"], text: "樓主加油，高中不告白畢業會後悔", time: now - 5 * H },
      { anon: ["🐬", "匿名海豚"], text: "蹲後續！", time: now - 3 * H },
    ],
  },
  {
    id: 5, board: "club", anon: ["🎸", "匿名吉他手"], time: now - 12 * H, likes: 33, liked: false,
    title: "吉他社成發倒數兩週！",
    text: "這學期成果發表 12/20（五）放學在活動中心舉行，這次有樂團表演還有抽獎🎁 歡迎大家來捧場！順便偷偷招生：想學吉他的高一同學下學期歡迎加入～",
    comments: [
      { anon: ["🐢", "匿名海龜"], text: "去年成發超讚，今年一定到", time: now - 10 * H },
    ],
  },
  {
    id: 6, board: "trade", anon: ["🦀", "匿名螃蟹"], time: now - 20 * H, likes: 12, liked: false,
    title: "出售：高一下全套課本＋段考複習卷",
    text: "升高二用不到了，課本九成新（我沒在看的意思😅），複習卷有寫過但有詳解。全套 200 帶走，可在校門口面交。留言我再想辦法聯絡～",
    comments: [
      { anon: ["🐠", "匿名熱帶魚"], text: "求化學課本單賣！", time: now - 18 * H },
      { anon: ["🦭", "匿名海豹"], text: "沒在看還九成新，太誠實了吧哈哈", time: now - 15 * H },
    ],
  },
  {
    id: 7, board: "chat", anon: ["🐳", "匿名鯨魚"], time: now - 26 * H, likes: 54, liked: false,
    title: "早自習到底該不該廢除",
    text: "每天七點半到校真的好痛苦，尤其冬天…聽說有學校已經改成八點到校了，大家覺得早自習有存在的必要嗎？來投票：留言 +1 廢除 / -1 保留",
    comments: [
      { anon: ["⚓", "匿名船長"], text: "+1 睡飽比較重要", time: now - 25 * H },
      { anon: ["🌟", "匿名海星"], text: "+1 早自習都在補作業根本沒在自習", time: now - 24 * H },
      { anon: ["🐙", "匿名章魚"], text: "-1 我需要早自習抱佛腳", time: now - 22 * H },
      { anon: ["🦈", "匿名鯊魚"], text: "+1111", time: now - 20 * H },
      { anon: ["🐚", "匿名貝殼"], text: "班聯會可以提案嗎？認真", time: now - 12 * H },
    ],
  },
  {
    id: 8, board: "study", anon: ["🌟", "匿名海星"], time: now - 30 * H, likes: 29, liked: false,
    title: "學測英文單字書選擇障礙",
    text: "4000 單、7000 單、字根字首…到底要買哪本啊？書局站了半小時還是空手而歸。想聽聽考過的學長姐建議 🙏",
    comments: [
      { anon: ["🦑", "匿名魷魚"], text: "哪本都行，重點是要背完（痛", time: now - 28 * H },
    ],
  },
];

// ---------- 社群自治機制 ----------
const REPORT_LIMIT = 3;              // 檢舉達此數量自動隱藏
const POST_COOLDOWN = 60e3;          // 發文冷卻 60 秒
const COMMENT_COOLDOWN = 15e3;       // 留言冷卻 15 秒
const PAGE_SIZE = 20;                // 每頁貼文數

const LIKED = new Set(loadJSON("kgsh-likes") || []);
function saveLiked() { localStorage.setItem("kgsh-likes", JSON.stringify([...LIKED])); }

// 展示模式假資料的欄位補齊（資料庫模式會整個換成 DB 資料）
POSTS.forEach((p) => {
  p.reports = 0; p.hidden = false; p.liked = LIKED.has(p.id);
  p.comments.forEach((c, i) => { c.reports = 0; c.hidden = false; c.id = p.id + "-" + i; });
});

let MY_REPORTS = new Set(loadJSON("kgsh-reports") || []);
function saveReports() { localStorage.setItem("kgsh-reports", JSON.stringify([...MY_REPORTS])); }

function cooldownLeft(key, cd) {
  const t = +localStorage.getItem(key) || 0;
  return Math.max(0, cd - (Date.now() - t));
}

// 熱門分數：隨時間衰減（類 Hacker News），舊文不會永遠霸榜
function hotScore(p) {
  const hours = (Date.now() - p.time) / H;
  return (p.likes + p.comments.length * 2 + 1) / Math.pow(hours + 2, 1.5);
}

// 資料庫錯誤 → 使用者看得懂的訊息
function dbErrMsg(e) {
  const m = (e && e.message) || "";
  if (m.includes("COOLDOWN")) return "太頻繁囉，請稍後再試";
  if (m.includes("NOTICE_MOD_ONLY")) return "公告看板僅限版主發文";
  if (m.includes("TOO_LONG")) return "內容超過長度上限";
  if (m.includes("NO_POST")) return "這篇貼文已無法留言";
  if (m.includes("NO_BOARD")) return "看板不存在，請重新整理";
  return "連線失敗，請稍後再試";
}

// ---------- 狀態 ----------
let IS_MOD = false;   // init() 判定：資料庫模式看登入狀態、展示模式看 localStorage

let state = {
  tab: "home",          // home | hot | boards | about
  board: "all",
  search: "",
  composeBoard: "chat",
  composeAnon: randAnon(),
  composeAsMod: false,
  openPostId: null,
  commentAnon: randAnon(),
  aboutEdit: null,      // 正在編輯的關於段落 index
  editBoardId: null,    // 正在編輯的看板 id（null = 新增）
  visibleCount: PAGE_SIZE,
};

// ---------- 工具 ----------
const $ = (id) => document.getElementById(id);

function randAnon() { return ANON[Math.floor(Math.random() * ANON.length)]; }

function avatarBg(seed) { return AVATAR_BG[seed.charCodeAt(0) % AVATAR_BG.length]; }

function timeAgo(t) {
  const d = Date.now() - t;
  if (d < M) return "剛剛";
  if (d < H) return Math.floor(d / M) + " 分鐘前";
  if (d < 24 * H) return Math.floor(d / H) + " 小時前";
  return Math.floor(d / (24 * H)) + " 天前";
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function highlight(text, kw) {
  const safe = esc(text);
  if (!kw) return safe;
  const pattern = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp("(" + pattern + ")", "gi"), "<mark>$1</mark>");
}

function boardOf(id) { return BOARDS.find((b) => b.id === id) || BOARDS[1]; }

function modDeleteBtn(attr) {
  if (!IS_MOD) return "";
  return `<button class="mod-delete" ${attr} aria-label="刪除">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
  </button>`;
}

function modPinBtn(p) {
  if (!IS_MOD) return "";
  return `<button class="mod-pin ${p.pinned ? "pinned" : ""}" data-pin="${p.id}" aria-label="置頂">📌</button>`;
}

function reportBtn(p) {
  if (IS_MOD) return "";
  const done = MY_REPORTS.has("p" + p.id);
  return `<button class="stat-btn report-btn ${done ? "reported" : ""}" data-report="${p.id}" aria-label="檢舉">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="${done ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
  </button>`;
}

function modRestoreBtn(p) {
  if (!IS_MOD || !p.hidden) return "";
  return `<button class="mod-restore" data-restore="${p.id}">恢復顯示</button>`;
}

function authorHTML(name) {
  const isMod = name === "版主";
  return `<div class="post-author${isMod ? " is-mod" : ""}">${esc(name)}${isMod ? " ⚓" : ""}</div>`;
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

// ---------- 渲染：看板 chips ----------
function renderChips() {
  $("chips").innerHTML = BOARDS.map(
    (b) => `<button class="chip ${state.board === b.id ? "active" : ""}" data-board="${b.id}">
      <span>${b.emoji}</span>${esc(b.name)}</button>`
  ).join("");
}

// ---------- 渲染：貼文卡片 ----------
function postCard(p, kw) {
  const b = boardOf(p.board);
  return `
  <article class="post-card${p.hidden ? " is-hidden" : ""}" data-post="${p.id}">
    <div class="post-head">
      <div class="avatar" style="background:${avatarBg(p.anon[1])}">${p.anon[0]}</div>
      <div class="post-meta">
        ${authorHTML(p.anon[1])}
        <div class="post-sub">${p.hidden ? `<span class="hidden-tag">⚠️ 已自動隱藏</span>` : ""}${p.pinned ? `<span class="pin-tag">📌 置頂</span>` : ""}${timeAgo(p.time)}</div>
      </div>
      <span class="board-tag">${b.emoji} ${esc(b.name)}</span>
    </div>
    ${p.title ? `<h2 class="post-title">${highlight(p.title, kw)}</h2>` : ""}
    <p class="post-text">${highlight(p.text, kw)}</p>
    <div class="post-foot">
      <button class="stat-btn like-btn ${p.liked ? "liked" : ""}" data-like="${p.id}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="${p.liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
        ${p.likes}
      </button>
      <button class="stat-btn">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
        ${p.comments.length}
      </button>
      ${reportBtn(p)}
      ${modRestoreBtn(p)}
      ${modPinBtn(p)}
      ${modDeleteBtn(`data-del-post="${p.id}"`)}
    </div>
  </article>`;
}

// ---------- 渲染：主畫面 ----------
function renderFeed() {
  const feed = $("feed");
  const kw = state.search.trim();

  if (state.tab === "boards") {
    feed.innerHTML = `<div class="board-grid">` + BOARDS.slice(1).map((b, i) =>
      `<div class="board-card" data-board-card="${b.id}" style="animation-delay:${i * 40}ms">
        ${IS_MOD ? `<button class="board-edit-btn" data-board-edit="${b.id}" aria-label="編輯看板">✎</button>` : ""}
        <div class="board-emoji" style="background:${b.color}">${b.emoji}</div>
        <h3>${esc(b.name)}版</h3><p>${esc(b.desc)}</p>
      </div>`).join("")
      + (IS_MOD ? `<div class="board-card board-add" data-board-add>＋ 新增看板</div>` : "")
      + `</div>`;
    return;
  }

  if (state.tab === "about") {
    feed.innerHTML = ABOUT.map((s, i) => {
      if (state.aboutEdit === i) {
        return `<div class="about-card">
          <h2>${s.emoji} ${esc(s.title)}</h2>
          <textarea class="about-ta" id="about-ta">${esc(s.text)}</textarea>
          <div class="about-actions">
            <button class="text-btn" data-about-cancel>取消</button>
            <button class="pill-btn small" data-about-save="${i}">儲存</button>
          </div>
        </div>`;
      }
      return `<div class="about-card" style="animation-delay:${i * 60}ms">
        ${IS_MOD ? `<button class="about-edit-btn" data-about-edit="${i}" aria-label="編輯">✎</button>` : ""}
        <h2>${s.emoji} ${esc(s.title)}</h2>
        <p class="about-text">${esc(s.text)}</p>
      </div>`;
    }).join("");
    return;
  }

  // home / hot
  let list = POSTS.filter((p) => state.board === "all" || p.board === state.board);
  if (!IS_MOD) list = list.filter((p) => !p.hidden);
  if (kw) {
    const lower = kw.toLowerCase();
    list = list.filter((p) =>
      (p.title + p.text + p.comments.map((c) => c.text).join(" ")).toLowerCase().includes(lower)
    );
  }
  list = [...list].sort((a, b) =>
    state.tab === "hot"
      ? hotScore(b) - hotScore(a)
      : ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || b.time - a.time
  );

  if (!list.length) {
    feed.innerHTML = `<div class="feed-empty">
      <span class="emoji">🔍</span>
      <strong>找不到相關貼文</strong>
      <p>換個關鍵字，或成為第一個發文的人！</p>
    </div>`;
    return;
  }

  const label = kw
    ? `<p class="feed-section-title">「${esc(kw)}」的搜尋結果 · ${list.length} 篇</p>`
    : state.tab === "hot" ? `<p class="feed-section-title">🔥 本週熱門</p>` : "";

  const shown = list.slice(0, state.visibleCount);
  feed.innerHTML = label
    + shown.map((p) => postCard(p, kw)).join("")
    + (list.length > shown.length
        ? `<button class="load-more" data-load-more>載入更多（還有 ${list.length - shown.length} 篇）</button>`
        : "");
}

// ---------- 渲染：詳情頁 ----------
function renderDetail() {
  const p = POSTS.find((x) => x.id === state.openPostId);
  if (!p) return;
  const b = boardOf(p.board);
  $("detail-body").innerHTML = `
    <article class="detail-post">
      <div class="post-head">
        <div class="avatar" style="background:${avatarBg(p.anon[1])}">${p.anon[0]}</div>
        <div class="post-meta">
          ${authorHTML(p.anon[1])}
          <div class="post-sub">${p.hidden ? `<span class="hidden-tag">⚠️ 已自動隱藏</span>` : ""}${p.pinned ? `<span class="pin-tag">📌 置頂</span>` : ""}${timeAgo(p.time)}</div>
        </div>
        <span class="board-tag">${b.emoji} ${esc(b.name)}</span>
      </div>
      ${p.title ? `<h2 class="post-title">${esc(p.title)}</h2>` : ""}
      <p class="post-full-text">${esc(p.text)}</p>
      <div class="post-foot">
        <button class="stat-btn like-btn ${p.liked ? "liked" : ""}" data-like="${p.id}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="${p.liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          ${p.likes}
        </button>
        ${reportBtn(p)}
        ${modRestoreBtn(p)}
        ${modPinBtn(p)}
        ${modDeleteBtn(`data-del-post="${p.id}"`)}
      </div>
    </article>
    <p class="comment-count-label">留言 ${p.comments.length}</p>
    ${p.comments.map((c, i) => {
      if (c.hidden && !IS_MOD) {
        return `<div class="comment-item hidden-comment">🚫 B${i + 1} 留言已被多人檢舉，自動隱藏</div>`;
      }
      return `
      <div class="comment-item" style="animation-delay:${i * 30}ms">
        <div class="avatar" style="background:${avatarBg(c.anon[1])}">${c.anon[0]}</div>
        <div class="comment-body">
          <div class="comment-author">${esc(c.anon[1])}<span class="floor">B${i + 1}</span>${c.hidden ? ` <span class="hidden-tag">⚠️ 已自動隱藏</span>` : ""}</div>
          <div class="comment-text">${esc(c.text)}</div>
          <div class="comment-time">${timeAgo(c.time)}</div>
        </div>
        ${!IS_MOD && !c.hidden ? `<button class="comment-flag ${MY_REPORTS.has("c" + c.id) ? "reported" : ""}" data-report-comment="${p.id}-${i}" aria-label="檢舉留言">⚑</button>` : ""}
        ${IS_MOD && c.hidden ? `<button class="mod-restore comment-restore" data-restore-comment="${i}">恢復</button>` : ""}
        ${modDeleteBtn(`data-del-comment="${i}"`)}
      </div>`;
    }).join("")}
  `;
}

// ---------- 渲染：發文彈窗看板選擇 ----------
function renderComposeBoards() {
  $("compose-boards").innerHTML = BOARDS.slice(1)
    .filter((b) => IS_MOD || b.id !== "notice")   // 公告看板僅限版主發文
    .map(
      (b) => `<button class="chip ${state.composeBoard === b.id ? "active" : ""}" data-cboard="${b.id}">
        <span>${b.emoji}</span>${esc(b.name)}</button>`
    ).join("");
}

function renderIdentity() {
  const asMod = IS_MOD && state.composeAsMod;
  $("identity-avatar").textContent = asMod ? "📣" : state.composeAnon[0];
  $("identity-name").textContent = asMod ? "版主" : state.composeAnon[1];
  $("identity-sub").textContent = asMod ? "貼文將公開顯示版主身分" : "每篇貼文都會隨機分配身分";
  $("btn-shuffle").hidden = asMod;
  const toggle = $("btn-as-mod");
  toggle.hidden = !IS_MOD;
  toggle.classList.toggle("active", asMod);
}

// ---------- 事件 ----------

// 看板 chips / 貼文卡片 / 讚（事件委派）
document.addEventListener("click", async (e) => {
  const chip = e.target.closest("[data-board]");
  if (chip && chip.closest("#chips")) {
    state.board = chip.dataset.board;
    state.visibleCount = PAGE_SIZE;
    renderChips();
    renderFeed();
    return;
  }

  // 檢舉貼文（多人檢舉自動隱藏）
  const rep = e.target.closest("[data-report]");
  if (rep) {
    e.stopPropagation();
    const p = POSTS.find((x) => x.id === +rep.dataset.report);
    const key = "p" + p.id;
    if (MY_REPORTS.has(key)) { toast("你已經檢舉過這篇了"); return; }
    if (!confirm("確定要檢舉這篇貼文嗎？\n累積多人檢舉後會自動隱藏。")) return;
    MY_REPORTS.add(key);
    saveReports();
    if (DB.ready) {
      try {
        const r = await DB.report("post", p.id);   // 門檻由資料庫跨裝置計算
        p.reports = r.count;
        p.hidden = r.hidden;
      } catch (err) { toast(dbErrMsg(err)); return; }
    } else {
      p.reports++;
      if (p.reports >= REPORT_LIMIT) p.hidden = true;
    }
    if (p.hidden) {
      if (state.openPostId === p.id) location.hash = "";
      toast("已達檢舉門檻，貼文自動隱藏 🚫");
    } else {
      toast("已收到檢舉，謝謝你守護港討 🙏");
    }
    renderFeed();
    if (!$("detail-page").hidden && state.openPostId) renderDetail();
    return;
  }

  // 檢舉留言
  const repC = e.target.closest("[data-report-comment]");
  if (repC) {
    e.stopPropagation();
    const [pid, idx] = repC.dataset.reportComment.split("-");
    const c = POSTS.find((x) => x.id === +pid).comments[+idx];
    const key = "c" + c.id;
    if (MY_REPORTS.has(key)) { toast("你已經檢舉過這則留言了"); return; }
    if (!confirm("確定要檢舉這則留言嗎？")) return;
    MY_REPORTS.add(key);
    saveReports();
    if (DB.ready) {
      try {
        const r = await DB.report("comment", c.id);
        c.reports = r.count;
        c.hidden = r.hidden;
      } catch (err) { toast(dbErrMsg(err)); return; }
    } else {
      c.reports++;
      if (c.reports >= REPORT_LIMIT) c.hidden = true;
    }
    toast(c.hidden ? "留言已自動隱藏 🚫" : "已收到檢舉 🙏");
    renderDetail();
    return;
  }

  // 版主：恢復被隱藏的留言
  const restoreC = e.target.closest("[data-restore-comment]");
  if (restoreC) {
    e.stopPropagation();
    const c = POSTS.find((x) => x.id === state.openPostId).comments[+restoreC.dataset.restoreComment];
    c.hidden = false;
    c.reports = 0;
    DB.updateComment(c.id, { hidden: false, report_count: 0 }).catch(() => toast("同步失敗，請重試"));
    renderDetail();
    toast("留言已恢復顯示 ✓");
    return;
  }

  // 版主：恢復被隱藏的貼文
  const restoreBtn = e.target.closest("[data-restore]");
  if (restoreBtn) {
    e.stopPropagation();
    const p = POSTS.find((x) => x.id === +restoreBtn.dataset.restore);
    p.hidden = false;
    p.reports = 0;
    DB.updatePost(p.id, { hidden: false, report_count: 0 }).catch(() => toast("同步失敗，請重試"));
    renderFeed();
    if (!$("detail-page").hidden) renderDetail();
    toast("已恢復顯示 ✓");
    return;
  }

  // 載入更多（資料庫模式：本地看完了就再抓一批舊文）
  if (e.target.closest("[data-load-more]")) {
    state.visibleCount += PAGE_SIZE;
    if (DB.ready && DB.hasMore && state.visibleCount >= POSTS.length) {
      try {
        const more = await DB.loadPosts(POSTS.length);
        POSTS.push(...more);
      } catch { toast("載入失敗，請稍後再試"); }
    }
    renderFeed();
    return;
  }

  // 版主：置頂
  const pinBtn = e.target.closest("[data-pin]");
  if (pinBtn) {
    e.stopPropagation();
    const p = POSTS.find((x) => x.id === +pinBtn.dataset.pin);
    p.pinned = !p.pinned;
    DB.updatePost(p.id, { pinned: p.pinned }).catch(() => toast("同步失敗，請重試"));
    renderFeed();
    if (!$("detail-page").hidden) renderDetail();
    toast(p.pinned ? "已置頂 📌" : "已取消置頂");
    return;
  }

  // 版主：編輯／新增看板
  const boardEdit = e.target.closest("[data-board-edit]");
  if (boardEdit) {
    e.stopPropagation();
    openBoardSheet(boardEdit.dataset.boardEdit);
    return;
  }
  if (e.target.closest("[data-board-add]")) {
    openBoardSheet(null);
    return;
  }

  // 版主：編輯關於頁
  const aboutEdit = e.target.closest("[data-about-edit]");
  if (aboutEdit) {
    state.aboutEdit = +aboutEdit.dataset.aboutEdit;
    renderFeed();
    return;
  }
  const aboutSave = e.target.closest("[data-about-save]");
  if (aboutSave) {
    const text = $("about-ta").value.trim();
    if (!text) { toast("內容不能空白喔"); return; }
    ABOUT[+aboutSave.dataset.aboutSave].text = text;
    saveAbout();
    DB.saveAboutSection(ABOUT[+aboutSave.dataset.aboutSave]).catch(() => toast("同步失敗，請重試"));
    state.aboutEdit = null;
    renderFeed();
    toast("已更新 ✓");
    return;
  }
  if (e.target.closest("[data-about-cancel]")) {
    state.aboutEdit = null;
    renderFeed();
    return;
  }

  const boardCard = e.target.closest("[data-board-card]");
  if (boardCard) {
    state.board = boardCard.dataset.boardCard;
    state.tab = "home";
    state.visibleCount = PAGE_SIZE;
    syncTabbar();
    renderChips();
    renderFeed();
    window.scrollTo({ top: 0 });
    return;
  }

  const delPost = e.target.closest("[data-del-post]");
  if (delPost) {
    e.stopPropagation();
    if (!confirm("確定要刪除這篇貼文嗎？")) return;
    DB.deletePost(+delPost.dataset.delPost).catch(() => toast("同步失敗，請重試"));
    POSTS = POSTS.filter((p) => p.id !== +delPost.dataset.delPost);
    if (state.openPostId === +delPost.dataset.delPost) location.hash = "";
    renderFeed();
    toast("貼文已刪除");
    return;
  }

  const delComment = e.target.closest("[data-del-comment]");
  if (delComment) {
    e.stopPropagation();
    if (!confirm("確定要刪除這則留言嗎？")) return;
    const p = POSTS.find((x) => x.id === state.openPostId);
    const c = p.comments[+delComment.dataset.delComment];
    DB.deleteComment(c.id).catch(() => toast("同步失敗，請重試"));
    p.comments.splice(+delComment.dataset.delComment, 1);
    renderDetail();
    renderFeed();
    toast("留言已刪除");
    return;
  }

  const likeBtn = e.target.closest("[data-like]");
  if (likeBtn) {
    e.stopPropagation();
    const p = POSTS.find((x) => x.id === +likeBtn.dataset.like);
    p.liked = !p.liked;
    p.likes += p.liked ? 1 : -1;
    if (p.liked) LIKED.add(p.id); else LIKED.delete(p.id);
    saveLiked();
    DB.toggleLike(p.id).catch(() => {});   // 資料庫端每裝置去重
    renderFeed();
    if (!$("detail-page").hidden) renderDetail();
    return;
  }

  const card = e.target.closest("[data-post]");
  if (card) {
    location.hash = "post/" + card.dataset.post;   // 每篇貼文有專屬網址，可直接分享
    return;
  }

  const cboard = e.target.closest("[data-cboard]");
  if (cboard) {
    state.composeBoard = cboard.dataset.cboard;
    renderComposeBoards();
  }
});

// 底部導覽
function syncTabbar() {
  document.querySelectorAll(".tab[data-tab]").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === state.tab)
  );
}
document.querySelectorAll(".tab[data-tab]").forEach((t) =>
  t.addEventListener("click", () => {
    state.tab = t.dataset.tab;
    state.aboutEdit = null;
    state.visibleCount = PAGE_SIZE;
    syncTabbar();
    renderFeed();
    window.scrollTo({ top: 0 });
  })
);

// 搜尋（資料庫模式：本地先即時顯示，停頓 0.35 秒後查全站資料庫再補上）
let searchTimer;
function mergePosts(extra) {
  extra.forEach((np) => {
    const i = POSTS.findIndex((p) => p.id === np.id);
    if (i >= 0) POSTS[i] = np; else POSTS.push(np);
  });
}
$("search-input").addEventListener("input", (e) => {
  state.search = e.target.value;
  state.visibleCount = PAGE_SIZE;
  e.target.closest(".search-bar").classList.toggle("has-text", !!e.target.value);
  renderFeed();
  const kw = state.search.trim();
  if (DB.ready && kw) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const extra = await DB.searchPosts(kw);
        if (state.search.trim() !== kw) return;   // 使用者已改關鍵字
        mergePosts(extra);
        renderFeed();
      } catch { /* 離線時仍有本地結果 */ }
    }, 350);
  }
});
$("search-clear").addEventListener("click", () => {
  $("search-input").value = "";
  state.search = "";
  document.querySelector(".search-bar").classList.remove("has-text");
  renderFeed();
});

// 詳情頁：hash 路由（#post/123 可直接分享、支援返回鍵）
function syncFromHash() {
  const m = location.hash.match(/^#post\/(\d+)$/);
  if (m) {
    const p = POSTS.find((x) => x.id === +m[1]);
    if (p && (IS_MOD || !p.hidden)) {
      state.openPostId = p.id;
      state.commentAnon = randAnon();
      renderDetail();
      $("detail-page").hidden = false;
      return;
    }
  }
  $("detail-page").hidden = true;
  state.openPostId = null;
}
window.addEventListener("hashchange", syncFromHash);

$("btn-back").addEventListener("click", () => {
  if (location.hash) location.hash = "";
  else { $("detail-page").hidden = true; state.openPostId = null; }
});

// 分享貼文連結：手機優先用原生分享面板，其次複製到剪貼簿
$("btn-share").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#post/" + state.openPostId;
  if (navigator.share) {
    try { await navigator.share({ title: "港討貼文", url }); return; } catch { /* 取消或不支援，改用複製 */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("貼文連結已複製 🔗");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("貼文連結已複製 🔗");
  }
});

// 留言
$("btn-send").addEventListener("click", sendComment);
$("comment-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendComment(); });

async function sendComment() {
  const input = $("comment-input");
  const text = input.value.trim();
  if (!text) return;
  if (!IS_MOD) {
    const left = cooldownLeft("kgsh-last-comment", COMMENT_COOLDOWN);
    if (left) { toast(`留言太快囉，${Math.ceil(left / 1000)} 秒後再試`); return; }
  }
  const p = POSTS.find((x) => x.id === state.openPostId);
  let c;
  if (DB.ready) {
    try { c = await DB.addComment(p.id, text, state.commentAnon); }
    catch (err) { toast(dbErrMsg(err)); return; }
  } else {
    c = { id: p.id + "-" + p.comments.length, anon: state.commentAnon, text, time: Date.now(), reports: 0, hidden: false };
  }
  p.comments.push(c);
  localStorage.setItem("kgsh-last-comment", Date.now());
  input.value = "";
  renderDetail();
  renderFeed();
  $("detail-body").scrollTo({ top: $("detail-body").scrollHeight, behavior: "smooth" });
  toast("留言成功 🎉");
}

// 發文彈窗
function openCompose() {
  state.composeAnon = randAnon();
  const canUse = (id) => BOARDS.some((b) => b.id === id) && (IS_MOD || id !== "notice");
  if (!canUse(state.composeBoard)) {
    state.composeBoard = BOARDS.slice(1).find((b) => canUse(b.id)).id;
  }
  renderIdentity();
  renderComposeBoards();
  $("compose-backdrop").hidden = false;
  $("compose-sheet").hidden = false;
}
function closeCompose() {
  $("compose-backdrop").hidden = true;
  $("compose-sheet").hidden = true;
}

$("btn-compose").addEventListener("click", openCompose);
$("btn-compose-cancel").addEventListener("click", closeCompose);
$("compose-backdrop").addEventListener("click", closeCompose);
$("btn-shuffle").addEventListener("click", () => {
  state.composeAnon = randAnon();
  renderIdentity();
});

$("btn-as-mod").addEventListener("click", () => {
  state.composeAsMod = !state.composeAsMod;
  renderIdentity();
});

// 看板編輯彈窗（版主）
function openBoardSheet(id) {
  state.editBoardId = id;
  const b = id ? BOARDS.find((x) => x.id === id) : null;
  $("board-sheet-title").textContent = b ? "編輯看板" : "新增看板";
  $("board-emoji").value = b ? b.emoji : "";
  $("board-name").value = b ? b.name : "";
  $("board-desc").value = b ? b.desc : "";
  $("btn-board-delete").hidden = !b;
  $("board-backdrop").hidden = false;
  $("board-sheet").hidden = false;
}
function closeBoardSheet() {
  $("board-backdrop").hidden = true;
  $("board-sheet").hidden = true;
  state.editBoardId = null;
}

$("btn-board-cancel").addEventListener("click", closeBoardSheet);
$("board-backdrop").addEventListener("click", closeBoardSheet);

$("btn-board-save").addEventListener("click", () => {
  const name = $("board-name").value.trim();
  if (!name) { toast("看板名稱不能空白喔"); return; }
  const emoji = $("board-emoji").value.trim() || "📋";
  const desc = $("board-desc").value.trim();
  let board;
  if (state.editBoardId) {
    board = BOARDS.find((x) => x.id === state.editBoardId);
    Object.assign(board, { name, emoji, desc });
  } else {
    board = {
      id: "b" + Date.now(), name, emoji, desc,
      color: AVATAR_BG[BOARDS.length % AVATAR_BG.length],
    };
    BOARDS.push(board);
  }
  saveBoards();
  DB.upsertBoard(board, BOARDS.indexOf(board)).catch(() => toast("同步失敗，請重試"));
  renderChips();
  renderFeed();
  closeBoardSheet();
  toast("看板已儲存 ✓");
});

$("btn-board-delete").addEventListener("click", () => {
  if (BOARDS.length <= 2) { toast("至少要保留一個看板"); return; }
  if (!confirm("確定要刪除這個看板嗎？板內貼文會移到其他看板。")) return;
  const id = state.editBoardId;
  BOARDS = BOARDS.filter((x) => x.id !== id);
  POSTS.forEach((p) => { if (p.board === id) p.board = BOARDS[1].id; });
  if (state.board === id) state.board = "all";
  if (state.composeBoard === id) state.composeBoard = BOARDS[1].id;
  saveBoards();
  DB.deleteBoard(id, BOARDS[1].id).catch(() => toast("同步失敗，請重試"));
  renderChips();
  renderFeed();
  closeBoardSheet();
  toast("看板已刪除");
});

$("btn-compose-post").addEventListener("click", async () => {
  const title = $("compose-input-title").value.trim();
  const text = $("compose-textarea").value.trim();
  if (!text) { toast("內容不能空白喔"); return; }
  if (!IS_MOD && state.composeBoard === "notice") { toast("公告看板僅限版主發文"); return; }
  if (!IS_MOD) {
    const left = cooldownLeft("kgsh-last-post", POST_COOLDOWN);
    if (left) { toast(`發文冷卻中，${Math.ceil(left / 1000)} 秒後再試`); return; }
  }
  const anon = IS_MOD && state.composeAsMod ? ["📣", "版主"] : state.composeAnon;
  let post;
  if (DB.ready) {
    try { post = await DB.createPost({ board: state.composeBoard, title, text, anon }); }
    catch (err) { toast(dbErrMsg(err)); return; }
  } else {
    post = {
      id: Date.now(), board: state.composeBoard, anon,
      time: Date.now(), likes: 0, liked: false, title, text, comments: [],
      reports: 0, hidden: false,
    };
  }
  POSTS.unshift(post);
  localStorage.setItem("kgsh-last-post", Date.now());
  $("compose-input-title").value = "";
  $("compose-textarea").value = "";
  closeCompose();
  state.tab = "home";
  state.board = "all";
  syncTabbar();
  renderChips();
  renderFeed();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("發文成功 🌊");
});

// 深淺色切換
$("btn-theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark";
  root.dataset.theme = dark ? "" : "dark";
  localStorage.setItem("kgsh-theme", dark ? "light" : "dark");
});
if (localStorage.getItem("kgsh-theme") === "dark" ||
    (!localStorage.getItem("kgsh-theme") && matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.dataset.theme = "dark";
}

// ---------- 版主模式標示 ----------
function initModUI() {
  if (!IS_MOD) return;
  const badge = document.createElement("div");
  badge.className = "mod-badge";
  badge.innerHTML = `⚓ 版主模式 <button class="mod-logout" id="btn-mod-logout">登出</button>`;
  $("btn-theme").before(badge);
  badge.querySelector("#btn-mod-logout").addEventListener("click", async () => {
    if (DB.ready) await DB.signOut();
    localStorage.removeItem("kgsh-mod");
    location.reload();
  });
}

// ---------- 初始化 ----------
async function init() {
  if (DB.ready) {
    $("feed").innerHTML = `<div class="feed-empty"><span class="emoji">🌊</span><strong>載入中…</strong></div>`;
    try {
      IS_MOD = await DB.isMod();
      const [boards, about, posts] = await Promise.all([
        DB.loadBoards(), DB.loadAbout(), DB.loadPosts(0),
      ]);
      if (boards.length) BOARDS = [DEFAULT_BOARDS[0], ...boards];   // 「全部」是前端虛擬看板
      if (about.length) ABOUT = about;
      POSTS = posts;
    } catch (e) {
      console.error("港討：資料庫連線失敗", e);
      toast("資料庫連線失敗，目前為離線展示");
    }
  } else {
    IS_MOD = localStorage.getItem("kgsh-mod") === "1";   // 展示模式
  }
  initModUI();
  renderChips();
  renderFeed();
  syncFromHash();   // 支援直接開啟 #post/123 分享連結
}
init();
