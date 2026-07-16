/* ============================================================
   港討 資料庫設定（版主做一次即可）

   1. 到 https://supabase.com 用信箱註冊，建立一個免費專案
      （區域選 Northeast Asia (Tokyo) 最快）
   2. 左側選單 SQL Editor → New query → 貼上 schema.sql 的
      全部內容 → Run（建表、規則、預設看板一次完成）
   3. 左側 Authentication → Users → Add user → 建立版主的
      信箱＋密碼（這就是之後 admin.html 的登入帳號）
   4. 左側 Authentication → Sign In / Providers → Email →
      把「Allow new users to sign up」關閉！！
      （不關的話任何人都能註冊成版主）
   5. 取得兩個值（2025 改版後的新位置）：
      - Project URL：左下角 ⚙️ Project Settings → Data API，
        或專案首頁上方的「Connect」按鈕都看得到
        （長得像 https://xxxx.supabase.co）→ 貼到下面的 url
      - 金鑰：⚙️ Project Settings → API Keys →
        「Publishable and secret API keys」分頁 →
        複製 Publishable key（sb_publishable_ 開頭）→ 貼到下面的 anonKey
        ※ 2025 年中以前建立的舊專案沒有這分頁，
          改到「Legacy API Keys」分頁複製 anon public 即可
      （這兩個都是設計成公開的值，放前端是正常用法；
        千萬別把 secret key／service_role key 放進來）

   兩個欄位留空 = 展示模式（假資料、不會真的儲存）
   ============================================================ */
window.KGSH_CONFIG = {
  url: "https://svyasthydutzsjmipihn.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2eWFzdGh5ZHV0enNqbWlwaWhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzA3ODYsImV4cCI6MjA5OTcwNjc4Nn0.6pmTsxnzpQPcUSbDT3FC09CMWTP6L3VNE3zmbYQyNo4",
};
