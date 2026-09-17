// 深淺色初始化（各頁共用）。獨立成檔案是為了讓 CSP 可以完全禁止內嵌腳本，
// 就算哪裡漏了跳脫被塞進 <script>，瀏覽器也不會執行。
if (localStorage.getItem("kgsh-theme") === "dark" ||
    (!localStorage.getItem("kgsh-theme") && matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.dataset.theme = "dark";
}
