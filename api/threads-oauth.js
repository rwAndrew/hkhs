// Threads 授權回呼端點。
//
// 為什麼需要這支：Meta 後台「用戶權杖產生器」那顆按鈕只會依照「當初授權時同意過的
// 權限」重新核發 token，事後在後台加的新權限（例如 threads_delete）它不會納入。
// 權限是寫在「授權網址」的 scope 參數裡的，所以要重新走一次完整 OAuth 授權流程。
//
// 流程：/api/threads-oauth            → 導向 Threads 授權頁（帶上完整 scope）
//       /api/threads-oauth?code=xxx   → 換短期 token → 換 60 天長期 token → 寫進資料庫

const SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_delete",
  "threads_manage_replies",
  "threads_manage_insights",
  "threads_read_replies",
].join(",");

// 只接受發布到港討自己的帳號，避免有人拿這個端點把系統指向別的 Threads 帳號
const EXPECTED_USER_ID = "28681321328118471";

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function page(title, body) {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>body{font-family:system-ui,"Noto Sans TC",sans-serif;max-width:520px;margin:60px auto;padding:0 24px;line-height:1.7;color:#1F2A33}
code{background:#F0F3F6;padding:2px 6px;border-radius:6px;font-size:13px}
.ok{color:#0E7E82}.bad{color:#E5484D}</style></head><body>${body}</body></html>`;
}

export default async function handler(req, res) {
  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const redirectUri = `${proto}://${req.headers.host}/api/threads-oauth`;

  if (!appId || !appSecret) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(page("設定不完整",
      `<h2 class="bad">還沒設定 THREADS_APP_ID / THREADS_APP_SECRET</h2>
       <p>要先在 Vercel 專案的環境變數加上這兩個值（在 Meta 後台的
       「Threads 應用程式編號」與「Threads 應用程式密鑰」）。</p>`));
  }

  const { code, error, state } = req.query;

  // 第一階段：使用者還沒授權 → 導去 Threads 的授權頁
  if (!code && !error) {
    if (state !== process.env.IG_CRON_SECRET) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(401).send(page("需要密鑰",
        `<h2 class="bad">網址需要帶上密鑰</h2>
         <p>請用版主專用的授權連結（網址後面要有 <code>?state=…</code>），避免任何人都能重新綁定帳號。</p>`));
    }
    const authUrl = `https://threads.net/oauth/authorize?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&response_type=code&state=${encodeURIComponent(state)}`;
    return res.redirect(302, authUrl);
  }

  if (error) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(page("授權被取消",
      `<h2 class="bad">授權沒有完成</h2><p>Threads 回傳：<code>${String(error).slice(0, 200)}</code></p>`));
  }

  try {
    // 第二階段：拿 code 換短期 token
    const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: String(code),
      }),
    }).then((r) => r.json());
    if (!shortRes.access_token) throw new Error("換短期 token 失敗：" + JSON.stringify(shortRes));

    // 第三階段：短期換 60 天長期 token
    const longRes = await fetch(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&access_token=${encodeURIComponent(shortRes.access_token)}`
    ).then((r) => r.json());
    if (!longRes.access_token) throw new Error("換長期 token 失敗：" + JSON.stringify(longRes));

    // 確認這組 token 真的是港討自己的帳號，而且權限有拿到
    const dbg = await fetch(
      `https://graph.threads.net/v1.0/debug_token?input_token=${encodeURIComponent(longRes.access_token)}` +
      `&access_token=${encodeURIComponent(longRes.access_token)}`
    ).then((r) => r.json());
    const info = dbg.data || {};
    if (String(info.user_id) !== EXPECTED_USER_ID) {
      throw new Error(`授權的帳號不是港討（拿到 user_id ${info.user_id}）`);
    }

    // 寫進資料庫
    const w = await fetch(`${process.env.SUPABASE_URL}/rest/v1/threads_config?id=eq.1`, {
      method: "PATCH",
      headers: sbHeaders(),
      body: JSON.stringify({
        access_token: longRes.access_token,
        threads_user_id: String(info.user_id),
        refreshed_at: new Date().toISOString(),
      }),
    });
    if (!w.ok) throw new Error("寫入資料庫失敗：" + (await w.text()).slice(0, 200));

    const scopes = info.scopes || [];
    const hasDelete = scopes.includes("threads_delete");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(page("授權完成",
      `<h2 class="ok">✅ 授權完成，token 已存入</h2>
       <p>拿到的權限：<br><code>${scopes.join("</code> <code>") || "（無）"}</code></p>
       <p>同步刪除功能：<strong class="${hasDelete ? "ok" : "bad"}">${hasDelete ? "可以用了" : "還是沒拿到 threads_delete，請確認後台權限清單"}</strong></p>
       <p>可以關掉這頁了。</p>`));
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(page("授權失敗",
      `<h2 class="bad">授權過程出錯</h2><p><code>${String(e.message).slice(0, 400)}</code></p>`));
  }
}
