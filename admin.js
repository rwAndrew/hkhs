// 資料庫模式：用 Supabase Auth（信箱＋密碼，建帳號見 config.js 說明）
// 展示模式（config.js 未填）：暫時性通行碼 kgsh-demo
const DEMO_PASS = "kgsh-demo";

const email = document.getElementById("admin-email");
const pass = document.getElementById("admin-pass");
const err = document.getElementById("admin-error");

if (DB.ready) {
  document.getElementById("admin-email-field").hidden = false;
} else {
  pass.placeholder = "版主通行碼";
}

async function login() {
  if (DB.ready) {
    const { error } = await DB.signIn(email.value.trim(), pass.value);
    if (error) { err.hidden = false; return; }
    location.href = "index.html";
  } else if (pass.value === DEMO_PASS) {
    localStorage.setItem("kgsh-mod", "1");
    location.href = "index.html";
  } else {
    err.hidden = false;
    pass.value = "";
  }
}

document.getElementById("btn-admin-login").addEventListener("click", login);
pass.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
pass.addEventListener("input", () => { err.hidden = true; });
