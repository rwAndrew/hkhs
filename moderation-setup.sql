-- ============================================================
-- 發文 AI 審查（在 Supabase SQL Editor 執行一次）
-- 執行前：把 YOUR_SECRET 換成版主的密鑰（跟其他 .sql 同一把）
--         ※ 執行完記得把檔案改回 YOUR_SECRET，這個 repo 是公開的
--
-- 做了四件事：
--   1. 貼文加上審查狀態欄位
--   2. 新增攔截紀錄表（30 天後自動清除）
--   3. 收回匿名者直接呼叫 create_post 的權限——發文必須經過審查端點，
--      否則任何人按 F12 就能繞過審查
--   4. 排程：每 10 分鐘補審一次「審查服務當時掛掉」的貼文
-- ============================================================

-- ---------- 1. 審查狀態 ----------
-- ok         通過審查（或 AI 審查上線前的舊貼文）
-- review     AI 無法判斷，等版主在後台決定；網站上照常顯示，但不同步社群
-- unreviewed 發文當下審查服務全部掛掉；網站上照常顯示，但不同步社群，排程會補審
-- blocked    補審後判定違規，已隱藏
alter table posts add column if not exists mod_status text not null default 'ok';
alter table posts drop constraint if exists posts_mod_status_check;
alter table posts add constraint posts_mod_status_check
  check (mod_status in ('ok', 'review', 'unreviewed', 'blocked'));
create index if not exists posts_mod_status_idx on posts (mod_status) where mod_status <> 'ok';

-- ---------- 2. 攔截紀錄 ----------
-- 被擋下的貼文不會寫進 posts，只在這裡留一段摘要，讓版主能檢查有沒有誤擋。
-- 內容可能含有人名，所以只有版主讀得到，30 天後自動刪除。
create table if not exists moderation_log (
  id         bigserial   primary key,
  created_at timestamptz not null default now(),
  verdict    text        not null,
  matched    text,
  reason     text,
  model      text,
  post_id    bigint,
  excerpt    text,
  detail     text
);
create index if not exists moderation_log_created_idx on moderation_log (created_at desc);
alter table moderation_log enable row level security;
drop policy if exists "版主讀取審查紀錄" on moderation_log;
create policy "版主讀取審查紀錄" on moderation_log for select to authenticated using (true);

-- ---------- 3. 發文函式：多一個審查狀態參數，並收回匿名者權限 ----------
drop function if exists create_post(text, text, text, text, text, uuid);

create or replace function create_post(
  p_board text, p_title text, p_body text,
  p_emoji text, p_name text, p_device uuid,
  p_mod_status text default 'ok'
) returns setof posts
language plpgsql security definer set search_path = public as $$
declare v_last timestamptz;
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'EMPTY'; end if;
  if length(coalesce(p_title,'')) > 40 or length(p_body) > 2000 then raise exception 'TOO_LONG'; end if;
  if not exists (select 1 from boards where id = p_board) then raise exception 'NO_BOARD'; end if;
  if p_board = 'notice' and auth.role() <> 'authenticated' then raise exception 'NOTICE_MOD_ONLY'; end if;
  if p_mod_status not in ('ok', 'review', 'unreviewed') then raise exception 'BAD_STATUS'; end if;

  if auth.role() <> 'authenticated' then
    select last_at into v_last from activity where device_id = p_device and kind = 'post';
    if v_last is not null and now() - v_last < interval '60 seconds' then raise exception 'COOLDOWN'; end if;
  end if;
  insert into activity (device_id, kind, last_at) values (p_device, 'post', now())
    on conflict (device_id, kind) do update set last_at = now();

  return query
    insert into posts (board, title, body, anon_emoji, anon_name, mod_status)
    values (p_board, coalesce(p_title,''), p_body, p_emoji, p_name, p_mod_status)
    returning *;
end $$;

-- 只有版主（authenticated）與伺服器（service_role）能呼叫。匿名者一律走審查端點。
revoke all on function create_post(text, text, text, text, text, uuid, text) from public;
revoke all on function create_post(text, text, text, text, text, uuid, text) from anon;
grant execute on function create_post(text, text, text, text, text, uuid, text) to authenticated, service_role;

-- ---------- 4. 排程 ----------
select cron.unschedule('moderation-sweep') where exists (select 1 from cron.job where jobname = 'moderation-sweep');
select cron.schedule(
  'moderation-sweep',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://hkhs.vercel.app/api/moderation-sweep',
    headers := '{"x-cron-secret": "YOUR_SECRET"}'::jsonb
  )
  $$
);

select cron.unschedule('moderation-log-purge') where exists (select 1 from cron.job where jobname = 'moderation-log-purge');
select cron.schedule(
  'moderation-log-purge',
  '17 3 * * *',
  $$ delete from moderation_log where created_at < now() - interval '30 days' $$
);

-- ============================================================
-- 驗證（執行完跑這段，應該看到 anon 沒有 EXECUTE 權限）：
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_name = 'create_post';
--
-- 緊急暫停審查（例如 AI 服務一直誤擋、需要先全部放行）：
--   到 Vercel 環境變數加上 MOD_DISABLED=1，重新部署即可，不用動資料庫
-- ============================================================
