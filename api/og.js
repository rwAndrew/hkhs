export const config = { runtime: "edge" };

import { ImageResponse } from "@vercel/og";
import { fetchPost, fetchCommentCount, fetchBoardLabel, excerpt } from "../lib/post-data.js";

// 不用 JSX，直接手動組出 satori 看得懂的元素樹（純 .js，不用額外的建置設定）
// Satori 規定 <div> 只要有子節點就得明確宣告 display:flex/none（多字元 emoji 內部也會被
// 拆成好幾個節點，單一子節點也可能中招），乾脆每個 div 都強制補上，不留模糊地帶
function h(type, props, ...children) {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  const style = type === "div" && !props?.style?.display
    ? { display: "flex", ...props?.style }
    : props?.style;
  return { type, props: { ...props, style, children: flat.length <= 1 ? flat[0] ?? null : flat } };
}

const BRAND_GRADIENT = "linear-gradient(160deg,#14A3A8 0%,#0E7E82 65%,#0B6367 100%)";

// 用舊版 Safari 的 UA 跟 Google Fonts 要字型，會拿到 Satori 看得懂的 ttf
// （不指定 UA 的話 Google 只給 woff2，Satori 畫中文會變空白方塊）
async function loadFont(text) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@500;700&text=${encodeURIComponent(text)}`;
  const css = await (
    await fetch(cssUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.57.2 (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2",
      },
    })
  ).text();
  const match = css.match(/src: url\(([^)]+)\)/);
  if (!match) throw new Error("font fetch failed");
  const fontRes = await fetch(match[1]);
  return fontRes.arrayBuffer();
}

// `vercel dev` 本機模擬的 Edge 環境給的是一般物件，正式環境給的是 Headers 實例，兩邊都要能讀
function getHeader(req, name) {
  if (req.headers && typeof req.headers.get === "function") return req.headers.get(name);
  return req.headers ? req.headers[name] ?? req.headers[name.toLowerCase()] : null;
}

export default async function handler(req) {
  // 本機 `vercel dev` 模擬的 Edge 環境有時只給相對路徑的 req.url（正式環境是完整網址），
  // 用 host header 當 fallback base 讓兩邊都能正常解析
  const host = getHeader(req, "host") || "localhost";
  const proto = getHeader(req, "x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const url = new URL(req.url, `${proto}://${host}`);
  const searchParams = url.searchParams;
  const origin = `${proto}://${url.host}`;
  const id = searchParams.get("id");
  const format = searchParams.get("format") === "story" ? "story" : "card";
  const debug = searchParams.get("debug") === "1";
  const size = format === "story" ? { width: 1080, height: 1920 } : { width: 1200, height: 630 };
  const logoUrl = `${origin}/HKHS.png`;
  const trace = [];
  const mark = (...a) => trace.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" "));

  mark("fetching post", id);
  const post = await fetchPost(id);
  mark("post?", !!post);
  if (!post) {
    if (debug) return Response.json({ trace, note: "post not found, would render placeholder" });
    return renderImage(placeholder(logoUrl), size, null);
  }

  const [board, comments] = await Promise.all([
    fetchBoardLabel(post.board),
    fetchCommentCount(post.id),
  ]);
  mark("board/comments", board, comments);

  const title = post.title || excerpt(post.body, 28);
  const body = excerpt(post.body, format === "story" ? 70 : 90);
  const sampleText =
    title + body + post.anon_name + board.join("") +
    "港討看看大家在討論什麼小港高中匿名討論區hkhs.vercel.app0123456789";

  let fontData = null;
  try { fontData = await loadFont(sampleText); mark("font bytes", fontData.byteLength); }
  catch (e) { mark("font error", e.message); }

  const tree =
    format === "story"
      ? storyLayout({ post, board, comments, title, body, logoUrl })
      : cardLayout({ post, board, comments, title, body, logoUrl });

  mark("tree built");
  if (debug) return Response.json({ trace, tree });

  try {
    return renderImage(tree, size, fontData);
  } catch (e) {
    return new Response("render error: " + (e && e.message) + "\n" + (e && e.stack), { status: 500 });
  }
}

function renderImage(tree, size, fontData) {
  return new ImageResponse(tree, {
    ...size,
    fonts: fontData ? [{ name: "Noto Sans TC", data: fontData, weight: 500, style: "normal" }] : [],
  });
}

function placeholder(logoUrl) {
  return h(
    "div",
    { style: {
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 24, background: BRAND_GRADIENT,
    } },
    h("img", { src: logoUrl, width: 96, height: 96, style: { borderRadius: 32 } }),
    h("div", { style: { fontSize: 40, color: "#fff", display: "flex" } }, "港討")
  );
}

function statRow(likes, comments, fontSize, gap) {
  return h(
    "div",
    { style: { display: "flex", gap, color: "#94A3B8", fontSize } },
    h("div", { style: { display: "flex", gap: 6 } }, h("span", {}, "❤️"), h("span", {}, String(likes))),
    h("div", { style: { display: "flex", gap: 6 } }, h("span", {}, "💬"), h("span", {}, String(comments)))
  );
}

function boardTag(board, style) {
  return h(
    "div",
    { style: { display: "flex", gap: 6, whiteSpace: "nowrap", ...style } },
    h("span", {}, board[0]),
    h("span", {}, board[1])
  );
}

function cardLayout({ post, board, comments, title, body, logoUrl }) {
  return h(
    "div",
    { style: {
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      padding: 56, background: BRAND_GRADIENT, fontFamily: "Noto Sans TC",
    } },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 16 } },
      h("img", { src: logoUrl, width: 52, height: 52, style: { borderRadius: 16 } }),
      h("div", { style: { fontSize: 28, color: "#fff", display: "flex" } }, "港討")
    ),
    h(
      "div",
      { style: {
        flex: 1, marginTop: 36, background: "#fff", borderRadius: 32, padding: 48,
        display: "flex", flexDirection: "column", boxShadow: "0 24px 48px rgba(4,20,22,0.3)",
      } },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 14 } },
        h(
          "div",
          { style: {
            width: 56, height: 56, borderRadius: 18, background: "#E0F5F5",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30,
          } },
          post.anon_emoji
        ),
        h("div", { style: { fontSize: 24, color: "#1F2A33", display: "flex" } }, post.anon_name),
        boardTag(board, { marginLeft: "auto", fontSize: 20, color: "#0E7E82", background: "#E0F5F5", padding: "8px 20px", borderRadius: 999 })
      ),
      h("div", { style: { fontSize: 36, fontWeight: 700, color: "#1F2A33", marginTop: 24, display: "flex" } }, title),
      h("div", { style: { fontSize: 26, color: "#64748B", marginTop: 12, lineHeight: 1.5, display: "flex" } }, body),
      h("div", { style: { marginTop: "auto" } }, statRow(post.likes, comments, 22, 28))
    )
  );
}

function storyLayout({ post, board, comments, title, body, logoUrl }) {
  return h(
    "div",
    { style: {
      width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative",
      background: BRAND_GRADIENT, fontFamily: "Noto Sans TC",
    } },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 34, padding: "216px 84px 0" } },
      h("img", { src: logoUrl, width: 110, height: 110, style: { borderRadius: 34 } }),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        h("div", { style: { fontSize: 52, color: "#fff", display: "flex" } }, "港討"),
        h("div", { style: { fontSize: 32, color: "rgba(255,255,255,0.78)", display: "flex" } }, "小港高中匿名討論區")
      )
    ),
    h(
      "div",
      { style: {
        display: "flex", flexDirection: "column", margin: "160px 80px 0", padding: 56,
        background: "#fff", borderRadius: 56, boxShadow: "0 56px 110px rgba(4,20,22,0.32)",
        transform: "rotate(-2deg)",
      } },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 26 } },
        h(
          "div",
          { style: {
            width: 88, height: 88, borderRadius: 28, background: "#E0F5F5",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44,
          } },
          post.anon_emoji
        ),
        h("div", { style: { fontSize: 36, color: "#1F2A33", display: "flex", flex: 1 } }, post.anon_name),
        boardTag(board, { fontSize: 30, color: "#0E7E82", background: "#E0F5F5", padding: "12px 26px", borderRadius: 999 })
      ),
      h("div", { style: { fontSize: 46, fontWeight: 700, color: "#1F2A33", marginTop: 32, display: "flex" } }, title),
      h("div", { style: { fontSize: 36, color: "#64748B", marginTop: 18, lineHeight: 1.55, display: "flex" } }, body),
      h("div", { style: { marginTop: 36 } }, statRow(post.likes, comments, 32, 44))
    ),
    h(
      "div",
      { style: {
        position: "absolute", bottom: 209, left: 0, right: 0, display: "flex",
        flexDirection: "column", alignItems: "center", gap: 28,
      } },
      h("div", { style: { fontSize: 32, color: "rgba(255,255,255,0.85)", display: "flex" } }, "看看大家在討論什麼"),
      h(
        "div",
        { style: {
          background: "rgba(255,255,255,0.96)", color: "#0E7E82", fontSize: 34,
          padding: "22px 56px", borderRadius: 999, display: "flex",
        } },
        "hkhs.vercel.app"
      )
    )
  );
}
