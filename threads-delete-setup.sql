-- ============================================================
-- Threads 同步刪除設定（在 Supabase SQL Editor 執行一次）
-- 前提：threads-setup.sql 已經執行過
-- 執行前：把最下面的 YOUR_SECRET 換成版主拿到的密鑰（跟另外兩個 .sql 同一把）
--
-- 另外別忘了：Meta 開發者後台那個 App 要多加一個 threads_delete 權限、
-- 重新走一次 Generate token 拿新的 token 蓋掉 threads_config 裡舊的那組
-- （少了這個權限，貼文被刪除時只會在 last_error 記錄失敗原因，不會出錯壞掉）
-- ============================================================

-- threads_published 原本設定貼文刪除時「連帶」把這筆紀錄也刪掉，但這樣就會
-- 弄丟 threads_id、沒辦法回頭去 Threads 那邊刪對應的貼文了。拿掉這個牽連關係，
-- 讓這張表變成純粹的歷史紀錄，貼文本體刪了它還在。
alter table threads_published drop constraint if exists threads_published_post_id_fkey;

create or replace function notify_threads_removal() returns trigger
language plpgsql security definer as $$
declare
  v_post_id bigint;
begin
  v_post_id := coalesce(old.id, new.id);
  -- 只在「真的被刪除」或「從沒隱藏變成隱藏」（檢舉自動隱藏／版主手動隱藏）時通知，
  -- 一般編輯不會誤觸發
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.hidden = true and old.hidden = false) then
    perform net.http_post(
      url     := 'https://hkhs.vercel.app/api/threads-delete',
      headers := '{"x-cron-secret": "YOUR_SECRET", "Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('post_id', v_post_id)
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists posts_threads_removal_trigger on posts;
create trigger posts_threads_removal_trigger
  after delete or update of hidden on posts
  for each row execute function notify_threads_removal();

-- ============================================================
-- 想暫停同步刪除（例如密鑰要換的時候）：
--   drop trigger if exists posts_threads_removal_trigger on posts;
-- ============================================================
