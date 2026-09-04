// Meta 要求的兩個回呼端點（取消授權／資料刪除請求）。
//
// 這兩個欄位在 Threads 的設定表單裡是必填的，沒填整張表單存不起來。
// 港討只用自己的帳號發文、不存任何其他使用者的資料，所以這裡沒有東西要刪，
// 但還是照規格回應，避免哪天被抽查時端點是死的。
//
//   /api/threads-callback?type=deauthorize  取消授權
//   /api/threads-callback?type=delete       資料刪除請求

export default async function handler(req, res) {
  const type = req.query?.type === "delete" ? "delete" : "deauthorize";

  // GET 是人在瀏覽器打開看的（Meta 存表單時也可能戳一下），回個說明頁就好
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      `<!DOCTYPE html><meta charset="UTF-8"><title>港討</title>` +
      `<p style="font-family:system-ui;max-width:480px;margin:60px auto;line-height:1.7">` +
      `港討的 Threads ${type === "delete" ? "資料刪除請求" : "取消授權"}回呼端點。` +
      `本站只發布自己帳號的內容，不會保存任何 Threads 使用者的個人資料。</p>`
    );
  }

  if (type === "delete") {
    // 資料刪除請求的規格：要回傳一個可以查詢進度的網址跟一組確認碼
    const code = "hkhs-" + Date.now().toString(36);
    return res.status(200).json({
      url: `https://hkhs.vercel.app/api/threads-callback?type=delete&code=${code}`,
      confirmation_code: code,
    });
  }

  // 取消授權：Meta 只看有沒有回 200
  return res.status(200).json({ ok: true });
}
