-- ============================================================
-- IG 自動發佈設定（在 Supabase SQL Editor 執行一次）
-- 執行前：把最下面的 YOUR_SECRET 換成版主拿到的密鑰
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- IG 帳號設定（token 只存這裡，前端完全讀不到）
create table if not exists ig_config (
  id           int primary key default 1,
  access_token text,
  ig_user_id   text,
  refreshed_at timestamptz default now()
);

-- 發佈紀錄：每篇貼文發過就不再發；失敗的會重試（最多 5 次）
create table if not exists ig_published (
  post_id      bigint primary key references posts(id) on delete cascade,
  ig_media_id  text,
  status       text not null default 'published',
  attempts     int  not null default 0,
  last_error   text,
  published_at timestamptz default now()
);

-- 開 RLS 但不建任何 policy：只有伺服器端（service role）能碰這兩張表
alter table ig_config    enable row level security;
alter table ig_published enable row level security;

-- 先建一列空設定，之後把 token 填進來即可
insert into ig_config (id) values (1) on conflict do nothing;

-- 每 5 分鐘呼叫一次發佈端點（YOUR_SECRET 要換掉！）
select cron.schedule(
  'ig-auto-publish',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://hkhs.vercel.app/api/ig-publish',
    headers := '{"x-cron-secret": "YOUR_SECRET"}'::jsonb
  )
  $$
);

-- ============================================================
-- 拿到 Meta 的長效 token 之後，執行這行把它填進去（換掉引號內容）：
--
--   update ig_config set access_token = '貼上你的長效token', refreshed_at = now() where id = 1;
--
-- 想暫停自動發佈：  select cron.unschedule('ig-auto-publish');
-- ============================================================
