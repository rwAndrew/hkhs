// 發文 AI 審查：擋下會讓特定個人被點名傷害的內容。
//
// 審查標準（2026/09 版主定案，用 31 題測試題與 80 篇真實貼文驗證過）：
//   一律擋：完整姓名、班級座號／學號、聯絡方式或詢問特定人帳號、
//           名字（如永祥）加負面內容、可指認對象加性傾向／健康／家庭、
//           可指認對象加性相關描述
//   放行：綽號、班級、外貌描述加辱罵或指控（當事人可私訊版主處理）、
//         名字加正向內容、學校與老師教學的批評、公眾人物、網路梗、群體
//
// 全部使用免費額度，依序嘗試；某一層塞車、額度用完或逾時就換下一層。
// 全部失敗時回傳 unreviewed——貼文照常發佈，但不同步社群，之後由排程補審。

const PROMPT = `你是高中匿名論壇審查員。原則：言論盡量開放，只擋會讓特定個人被點名傷害的內容。

一律 block：
- 完整姓名（姓加名），不論正負面
- 用諧音、拆字、縮寫暗示完整姓名
- 任何聯絡方式，或詢問特定人的 IG／LINE
- 名字（如永祥、佳琪）加任何負面內容：辱罵、嘲笑、指控、傳聞
- 可認出是誰的人，加性傾向、健康、家庭狀況
- 可認出是誰的人，加性相關描述

allow：
- 綽號、班級、外貌描述加辱罵、嘲笑、外貌批評、指控、傳聞（當事人可私訊版主處理）
- 名字加正向或中性內容
- 稱讚、感謝、善意搭訕、尋人
- 批評學校或活動（粗話也可）、「姓氏／科目＋老師」評論教學、公眾人物、網路梗、群體

範例：
「中油班那個超智障」allow（沒有名字）
「毛毛身上好臭」allow（綽號）
「包腳在福利社摸女生的頭」allow（綽號）
「永祥人超好」allow（只有名字，加正向）
「陳冠宇人超好」block（完整姓名，稱讚也擋）
「好喜歡張碧晨的歌」allow（藝人是公眾人物）
「永祥超智障」block（名字加辱罵）
「某隻鼠的男友是gay」block（性傾向）
「學姐IG是什麼」block
「數學老師林美華考太難」block（完整姓名）

review 僅在真的無法判斷時用。
只輸出 JSON：{"d":"allow|block|review","m":"觸發字詞","r":"10字內理由"}`;

// 審查順序。可用環境變數 MOD_CHAIN 覆寫，格式「供應商:模型,供應商:模型」，
// 模型下架或要換的時候改 Vercel 的環境變數就好，不用改程式。
const DEFAULT_CHAIN = [
  "groq:qwen/qwen3.8-27b",
  "groq:openai/gpt-oss-120b",
  "openrouter:inclusionai/ling-3.0-flash-fin:free",
];

const PROVIDERS = {
  groq: { base: "https://api.groq.com/openai/v1", key: () => process.env.GROQ_API_KEY },
  openrouter: { base: "https://openrouter.ai/api/v1", key: () => process.env.OPENROUTER_API_KEY },
};

const PER_CALL_TIMEOUT_MS = 6000;

// 程式直接判斷、不送 AI 的：班級座號（年級 1-3＋兩位班級＋座號 01-50，
// 允許中間有「-」「_」「班」）與明寫的學號。格式固定，用程式抓比 AI 穩。
export function prefilter(text) {
  const seat = text.match(/(?<!\d)[1-3]\d{2}(?:[-_]|班)?(?:0[1-9]|[1-4]\d|50)(?:號)?(?!\d)/);
  if (seat) return { verdict: "block", matched: seat[0], reason: "班級座號", model: "prefilter" };
  const sid = text.match(/學號\s*[:：]?\s*\d{4,}/);
  if (sid) return { verdict: "block", matched: sid[0], reason: "學號", model: "prefilter" };
  return null;
}

async function askModel(provider, model, text) {
  const p = PROVIDERS[provider];
  const key = p?.key();
  if (!key) throw new Error(`${provider} 沒有設定金鑰`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        // Qwen 直接回答，300 就夠；其他模型會先思考，給小了會把 JSON 截斷
        max_tokens: model.startsWith("qwen/") ? 300 : 1500,
        messages: [{ role: "system", content: PROMPT }, { role: "user", content: text }],
      }),
    });
    const body = await res.json();
    if (!res.ok || body.error) {
      throw new Error(`${res.status} ${JSON.stringify(body.error || body).slice(0, 120)}`);
    }
    const raw = (body.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "");
    const all = raw.match(/\{[^{}]*\}/g);
    const parsed = all ? JSON.parse(all[all.length - 1]) : null;
    if (!parsed || !["allow", "block", "review"].includes(parsed.d)) {
      throw new Error("回應格式不正確：" + raw.slice(0, 80));
    }
    return { verdict: parsed.d, matched: String(parsed.m || "").slice(0, 60), reason: String(parsed.r || "").slice(0, 40) };
  } finally {
    clearTimeout(timer);
  }
}

// 回傳 { verdict: allow|block|review|unreviewed, matched, reason, model, failures }
export async function moderate(text) {
  const pre = prefilter(text);
  if (pre) return pre;

  const chain = (process.env.MOD_CHAIN ? process.env.MOD_CHAIN.split(",") : DEFAULT_CHAIN)
    .map((s) => s.trim())
    .filter(Boolean);

  const failures = [];
  for (const entry of chain) {
    const i = entry.indexOf(":");
    const provider = entry.slice(0, i);
    const model = entry.slice(i + 1);
    try {
      const r = await askModel(provider, model, text);
      return { ...r, model: entry, failures };
    } catch (e) {
      failures.push(`${entry} → ${String(e.message).slice(0, 100)}`);
    }
  }
  return { verdict: "unreviewed", matched: "", reason: "審查服務暫時無法使用", model: "", failures };
}
