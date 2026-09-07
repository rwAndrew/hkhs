// 網站地圖（網址 /sitemap.xml，由 vercel.json 轉進來）。
//
// 主站是單頁應用，貼文網址是 #post/123 這種雜湊路由，搜尋引擎不會把它們當成
// 不同的網址。真正能被索引的是 /p/123 這種伺服器渲染的頁面，所以這裡把每篇
// 還看得到的貼文都列出來，讓 Google 知道有這些頁面可以收。

import { fetchAllPostIds } from "../lib/post-data.js";

export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const origin = `${proto}://${req.headers.host}`;
  const posts = await fetchAllPostIds();

  const urls = [
    `<url><loc>${origin}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    ...posts.map((p) =>
      `<url><loc>${origin}/p/${p.id}</loc>` +
      (p.created_at ? `<lastmod>${new Date(p.created_at).toISOString().slice(0, 10)}</lastmod>` : "") +
      `<changefreq>daily</changefreq><priority>0.8</priority></url>`
    ),
  ];

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1800, stale-while-revalidate=1800");
  res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`
  );
}
