-- ============================================================
-- 資安補強（在 Supabase SQL Editor 執行一次）
-- 不需要填密鑰。
--
-- 做了一件事：發文端點的來源速率限制用的表。
--   IP 不直接存，存的是加了伺服器密鑰的雜湊，資料庫外洩也還原不出 IP。
--   只有伺服器（service_role）讀寫得到，匿名者與版主都碰不到。
--   一小時以上沒動的紀錄每天清掉，不留長期足跡。
-- ============================================================

create table if not exists rate_limits (
  key          text        primary key,
  count        int         not null default 0,
  window_start timestamptz not null default now()
);
alter table rate_limits enable row level security;
-- 不建任何 policy：anon / authenticated 一律讀不到寫不到，只有 service_role 能用

select cron.unschedule('rate-limits-purge') where exists (select 1 from cron.job where jobname = 'rate-limits-purge');
select cron.schedule(
  'rate-limits-purge',
  '23 4 * * *',
  $$ delete from rate_limits where window_start < now() - interval '1 hour' $$
);
