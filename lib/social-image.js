// 社群貼文圖：IG 和 Threads 都只收 JPEG，而 /api/og 產的是 PNG，
// 中間靠 images.weserv.nl 轉檔。

const SITE = "https://hkhs.vercel.app";

export function imageUrl(postId) {
  const png = `${SITE}/api/og?id=${postId}&format=post`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(png)}&output=jpg&q=88`;
}

// 發佈前先自己抓一次，把圖片暖進 weserv 的快取。
//
// 為什麼需要：/api/og 冷啟動產一張圖要 8 秒以上，Meta 去抓圖時 weserv 還在等我們，
// 超時後回給 Meta 的就不是圖片，Meta 就報 2207052「媒體無法取得」。先暖過之後
// Meta 抓到的是快取，一秒內就回來了。
//
// 拿不到也不擋著發佈——直接讓 Meta 去試，失敗了本來就會重試。
export async function warmImage(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok && (r.headers.get("content-type") || "").startsWith("image/")) {
        await r.arrayBuffer();   // 讀完才算真的抓到，weserv 才會存進快取
        return true;
      }
    } catch {
      // 網路層失敗，下一輪再試
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
