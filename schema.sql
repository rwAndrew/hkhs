-- ============================================================
-- 港討 HKHS 資料庫結構（Supabase / Postgres）
-- 在 Supabase 的 SQL Editor 貼上全部內容執行一次即可。
--
-- 設計原則：所有「規則」都做在資料庫端，前端擋不住的這裡擋：
--   * 匿名者不能直接寫入任何表，只能呼叫下面的函式
--   * 檢舉滿 3 個不同裝置 → 自動隱藏（不經人手）
--   * 發文 60 秒／留言 15 秒冷卻（伺服器端計時）
--   * 公告看板只有登入的版主能發
--   * 版主（登入者）才能置頂、隱藏／恢復、刪除、編輯看板與關於
-- ============================================================

-- ---------- 資料表 ----------

create table boards (
  id    text primary key,
  name  text not null,
  emoji text not null default '📋',
  color text not null default '#E8F0FE',
  descr text not null default '',
  sort  int  not null default 100
);

create table about_sections (
  id    int  primary key,
  emoji text not null,
  title text not null,
  body  text not null
);

create table posts (
  id           bigint generated always as identity primary key,
  board        text        not null,
  anon_emoji   text        not null,
  anon_name    text        not null,
  title        text        not null default '',
  body         text        not null,
  likes        int         not null default 0,
  pinned       boolean     not null default false,
  hidden       boolean     not null default false,
  report_count int         not null default 0,
  created_at   timestamptz not null default now()
);
create index posts_created_idx on posts (created_at desc);
create index posts_board_idx   on posts (board);

create table comments (
  id           bigint generated always as identity primary key,
  post_id      bigint      not null references posts(id) on delete cascade,
  anon_emoji   text        not null,
  anon_name    text        not null,
  body         text        not null,
  hidden       boolean     not null default false,
  report_count int         not null default 0,
  created_at   timestamptz not null default now()
);
create index comments_post_idx on comments (post_id);

-- 檢舉紀錄：同一裝置對同一目標只算一次
create table reports (
  target_type text        not null check (target_type in ('post','comment')),
  target_id   bigint      not null,
  device_id   uuid        not null,
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, device_id)
);

-- 按讚紀錄：同一裝置對同一貼文只能讚一次
create table likes (
  post_id   bigint not null references posts(id) on delete cascade,
  device_id uuid   not null,
  primary key (post_id, device_id)
);

-- 冷卻計時：只記「這台裝置上次發文／留言的時間」，跟內容無關聯，
-- 不會洩漏匿名者身分
create table activity (
  device_id uuid        not null,
  kind      text        not null,
  last_at   timestamptz not null default now(),
  primary key (device_id, kind)
);

-- ---------- 權限（Row Level Security） ----------
-- 匿名者：只能「讀」看板、關於、未隱藏的貼文與留言。
-- 寫入一律走下面的函式；reports / likes / activity 完全不開放直接存取。
-- 版主（authenticated）：貼文、留言、看板、關於全權限。

alter table boards         enable row level security;
alter table about_sections enable row level security;
alter table posts          enable row level security;
alter table comments       enable row level security;
alter table reports        enable row level security;
alter table likes          enable row level security;
alter table activity       enable row level security;

create policy "boards 公開讀取"  on boards         for select using (true);
create policy "about 公開讀取"   on about_sections for select using (true);
create policy "posts 讀取"      on posts    for select using (not hidden or auth.role() = 'authenticated');
create policy "comments 讀取"   on comments for select using (not hidden or auth.role() = 'authenticated');

create policy "版主管理 posts"    on posts          for all to authenticated using (true) with check (true);
create policy "版主管理 comments" on comments       for all to authenticated using (true) with check (true);
create policy "版主管理 boards"   on boards         for all to authenticated using (true) with check (true);
create policy "版主管理 about"    on about_sections for all to authenticated using (true) with check (true);

-- ---------- 寫入函式（匿名者唯一的寫入管道） ----------

-- 發文：長度上限、看板存在、公告限版主、60 秒冷卻
create or replace function create_post(
  p_board text, p_title text, p_body text,
  p_emoji text, p_name text, p_device uuid
) returns setof posts
language plpgsql security definer set search_path = public as $$
declare v_last timestamptz;
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'EMPTY'; end if;
  if length(coalesce(p_title,'')) > 40 or length(p_body) > 2000 then raise exception 'TOO_LONG'; end if;
  if not exists (select 1 from boards where id = p_board) then raise exception 'NO_BOARD'; end if;
  if p_board = 'notice' and auth.role() <> 'authenticated' then raise exception 'NOTICE_MOD_ONLY'; end if;

  if auth.role() <> 'authenticated' then
    select last_at into v_last from activity where device_id = p_device and kind = 'post';
    if v_last is not null and now() - v_last < interval '60 seconds' then raise exception 'COOLDOWN'; end if;
  end if;
  insert into activity (device_id, kind, last_at) values (p_device, 'post', now())
    on conflict (device_id, kind) do update set last_at = now();

  return query
    insert into posts (board, title, body, anon_emoji, anon_name)
    values (p_board, coalesce(p_title,''), p_body, p_emoji, p_name)
    returning *;
end $$;

-- 留言：長度上限、貼文存在且未隱藏、15 秒冷卻
create or replace function add_comment(
  p_post bigint, p_body text, p_emoji text, p_name text, p_device uuid
) returns setof comments
language plpgsql security definer set search_path = public as $$
declare v_last timestamptz;
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'EMPTY'; end if;
  if length(p_body) > 300 then raise exception 'TOO_LONG'; end if;
  if not exists (select 1 from posts where id = p_post and not hidden) then raise exception 'NO_POST'; end if;

  if auth.role() <> 'authenticated' then
    select last_at into v_last from activity where device_id = p_device and kind = 'comment';
    if v_last is not null and now() - v_last < interval '15 seconds' then raise exception 'COOLDOWN'; end if;
  end if;
  insert into activity (device_id, kind, last_at) values (p_device, 'comment', now())
    on conflict (device_id, kind) do update set last_at = now();

  return query
    insert into comments (post_id, body, anon_emoji, anon_name)
    values (p_post, p_body, p_emoji, p_name)
    returning *;
end $$;

-- 按讚／收回讚（每裝置一次）
create or replace function toggle_like(p_post bigint, p_device uuid)
returns table (likes int, liked boolean)
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.likes l where l.post_id = p_post and l.device_id = p_device) then
    delete from public.likes l where l.post_id = p_post and l.device_id = p_device;
    update posts p set likes = greatest(p.likes - 1, 0) where p.id = p_post;
    return query select p.likes, false from posts p where p.id = p_post;
  else
    insert into public.likes (post_id, device_id) values (p_post, p_device);
    update posts p set likes = p.likes + 1 where p.id = p_post;
    return query select p.likes, true from posts p where p.id = p_post;
  end if;
end $$;

-- 檢舉（每裝置一次）：滿 3 個不同裝置 → 自動隱藏
create or replace function report_target(p_type text, p_id bigint, p_device uuid)
returns table (report_count int, hidden boolean)
language plpgsql security definer set search_path = public as $$
declare v_new boolean;
begin
  insert into reports (target_type, target_id, device_id)
  values (p_type, p_id, p_device)
  on conflict do nothing;
  v_new := found;

  if p_type = 'post' then
    if v_new then
      update posts p set report_count = p.report_count + 1 where p.id = p_id;
      update posts p set hidden = true where p.id = p_id and p.report_count >= 3;
    end if;
    return query select p.report_count, p.hidden from posts p where p.id = p_id;
  else
    if v_new then
      update comments c set report_count = c.report_count + 1 where c.id = p_id;
      update comments c set hidden = true where c.id = p_id and c.report_count >= 3;
    end if;
    return query select c.report_count, c.hidden from comments c where c.id = p_id;
  end if;
end $$;

-- ---------- 預設資料 ----------

insert into boards (id, name, emoji, color, descr, sort) values
  ('chat',   '閒聊', '💬', '#E8F0FE', '什麼都能聊',           1),
  ('study',  '課業', '📚', '#FFF4E0', '考試、讀書、升學',      2),
  ('club',   '社團', '🎸', '#F3E8FF', '社團活動與招生',        3),
  ('love',   '感情', '💘', '#FFE8EE', '戀愛煩惱、告白牆',      4),
  ('food',   '美食', '🍱', '#E8F8E8', '小港週邊美食情報',      5),
  ('trade',  '二手', '🏷️', '#FFF0E6', '課本、制服、雜物轉賣',  6),
  ('notice', '公告', '📣', '#FFEFEF', '版務與活動公告',        7);

insert into about_sections (id, emoji, title, body) values
  (1, '🌊', '關於港討', '「港討」是專屬小港高中學生的匿名討論區。不用再私訊 IG 等版主截圖，發文即時、留言即時、貼文可搜尋。'),
  (2, '📜', '版規', E'1. 禁止洩漏他人個資（姓名、班級座號、照片）\n2. 禁止霸凌、人身攻擊、歧視言論\n3. 禁止商業廣告與詐騙訊息\n4. 違規貼文累積檢舉會自動隱藏，版主可人工恢復'),
  (3, '🔒', '匿名機制', '每篇貼文與留言都會隨機分配一個海洋生物身分，不會顯示你的任何個人資訊。');

insert into posts (board, title, body, anon_emoji, anon_name, pinned) values
  ('notice', '🎉 港討匿名版正式上線！',
   E'以前大家投稿都要私訊 IG 等版主截圖上傳，想找舊貼文根本大海撈針。現在有了「港討」，發文即時、留言即時，最重要的是——終於可以搜尋了！\n\n請遵守版規、友善發言，祝大家使用愉快 🌊',
   '📣', '版主', true);
