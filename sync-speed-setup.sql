-- ============================================================
-- 加快社群同步速度（在 Supabase SQL Editor 執行一次）
-- 前提：ig-setup.sql 與 threads-setup.sql 都已經執行過
-- 執行前：把所有 YOUR_SECRET 換成版主的密鑰（跟其他 .sql 同一把）
--
-- 改了什麼：
--   Threads：貼文一發出來就立刻同步，不再等排程（幾秒內上架）
--   IG    ：排程從每 5 分鐘改成每分鐘，緩衝從 10 分鐘縮到 3 分鐘
--           （IG 沒辦法同步刪除，所以刻意保留一段檢舉反應時間）
-- ============================================================

-- 新貼文一寫進資料庫就立刻通知 Threads 發佈端點。
-- 端點收到 post_id 時會指名處理那一篇，不受「等待 N 分鐘」的限制。
create or replace function notify_new_post() returns trigger
language plpgsql security definer as $$
begin
  if new.hidden = false then
    perform net.http_post(
      url     := 'https://hkhs.vercel.app/api/threads-publish',
      headers := '{"x-cron-secret": "YOUR_SECRET", "Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('post_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists posts_sync_new_trigger on posts;
create trigger posts_sync_new_trigger
  after insert on posts
  for each row execute function notify_new_post();

-- 兩個排程改成每分鐘跑一次。
-- 對 Threads 來說它現在只是補救網：撿走 trigger 沒送到、或當下發佈失敗的貼文。
select cron.unschedule('ig-auto-publish');
select cron.schedule(
  'ig-auto-publish',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://hkhs.vercel.app/api/ig-publish',
    headers := '{"x-cron-secret": "YOUR_SECRET"}'::jsonb
  )
  $$
);

select cron.unschedule('threads-auto-publish');
select cron.schedule(
  'threads-auto-publish',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://hkhs.vercel.app/api/threads-publish',
    headers := '{"x-cron-secret": "YOUR_SECRET"}'::jsonb
  )
  $$
);

-- ============================================================
-- 想改回原本的節奏：
--   drop trigger if exists posts_sync_new_trigger on posts;
--   然後把上面兩個 cron.schedule 的 '* * * * *' 改成 '*/5 * * * *' 再執行一次
-- ============================================================
