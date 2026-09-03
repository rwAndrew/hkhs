-- ============================================================
-- Threads 自動發佈設定（在 Supabase SQL Editor 執行一次）
-- 前提：ig-setup.sql 已經執行過（pg_cron / pg_net 兩個 extension 已經開過）
-- 執行前：把最下面的 YOUR_SECRET 換成版主拿到的密鑰（跟 ig-setup.sql 同一把）
-- ============================================================

-- Threads 帳號設定（token 只存這裡，前端完全讀不到）
create table if not exists threads_config (
  id              int primary key default 1,
  access_token    text,
  threads_user_id text,
  refreshed_at    timestamptz default now()
);

-- 發佈紀錄：跟 ig_published 是分開兩張表，同一篇貼文會各自獨立追蹤
-- 有沒有發過 IG／Threads（兩邊互不影響，其中一邊失敗不會卡住另一邊）
create table if not exists threads_published (
  post_id      bigint primary key references posts(id) on delete cascade,
  threads_id   text,
  status       text not null default 'published',
  attempts     int  not null default 0,
  last_error   text,
  published_at timestamptz default now()
);

alter table threads_config    enable row level security;
alter table threads_published enable row level security;

insert into threads_config (id) values (1) on conflict do nothing;

-- 每 5 分鐘呼叫一次發佈端點，跟 ig-auto-publish 用同一把密鑰
select cron.schedule(
  'threads-auto-publish',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://hkhs.vercel.app/api/threads-publish',
    headers := '{"x-cron-secret": "YOUR_SECRET"}'::jsonb
  )
  $$
);

-- ============================================================
-- 拿到 Threads 的長效 token 之後，執行這行把它填進去（換掉引號內容）：
--
--   update threads_config set access_token = '貼上你的 Threads token', refreshed_at = now() where id = 1;
--
-- 想暫停自動發佈：  select cron.unschedule('threads-auto-publish');
-- ============================================================
