-- ============================================================
-- 우리 가족 기록장 (family-dashboard) - Supabase 스키마
-- 항목 단위 테이블 + room_id(가족 공유 코드) 기반 구조
-- 실행: Supabase 대시보드 > SQL Editor
-- ============================================================

create table if not exists public.family_rooms (
  room_id text primary key check (room_id ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  app_name text not null default '우리 가족 기록장',
  app_logo text not null default '',
  city_name text not null default '대구 침산동',
  city_lat double precision not null default 35.8866,
  city_lon double precision not null default 128.5902,
  start_money bigint not null default 10000,
  alarm_enabled boolean not null default false,
  alarm_time text not null default '21:30',
  alarm_last_fired_date text,
  mission_index integer not null default 0,
  mission_done_date text,
  mission_total_count integer not null default 0,
  last_study_reset_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_members (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  name text not null,
  role text default '',
  avatar text default '',
  mascot text default '',
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, id)
);

create table if not exists public.family_todos (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  member_id text not null,
  title text not null,
  done boolean not null default false,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, id)
);

create table if not exists public.family_studies (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  title text not null,
  detail text default '',
  reward integer not null default 0,
  pinned boolean not null default false,
  done boolean not null default false,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, id)
);

create table if not exists public.family_study_logs (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  log_date text not null,
  count integer not null default 0,
  amount integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, log_date)
);

create table if not exists public.family_stamps (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  stamp_date text not null,
  stamped boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (room_id, stamp_date)
);

create table if not exists public.family_missions (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  emoji text default '',
  text text not null,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, id)
);

create table if not exists public.family_chat_messages (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  sender_id text not null,
  type text not null default 'text',
  text text,
  audio text,
  time_label text default '',
  hearts integer not null default 0,
  seq bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (room_id, id)
);

create table if not exists public.family_allowance_tx (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  tx_date text not null,
  type text not null default 'income',
  amount integer not null default 0,
  memo text default '',
  seq bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (room_id, id)
);

-- ------------------------------------------------------------
-- v2 확장 (2026-11-17): 학교 급식 · 가족 일정 · 성장 기록 · 학원 숙제
-- 기존 데이터 보존: add column if not exists / create table if not exists 만 사용
-- ------------------------------------------------------------

-- 급식: 학교 정보 (기본값 = 대구 경명여자중학교)
alter table public.family_rooms
  add column if not exists school_office_code text not null default 'D10',
  add column if not exists school_code        text not null default '7261037',
  add column if not exists school_name        text not null default '경명여자중학교';

-- 기존 방에 학교 정보가 비어 있으면 기본 학교로 채웁니다.
update public.family_rooms
   set school_office_code = 'D10',
       school_code        = '7261037',
       school_name        = '경명여자중학교'
 where coalesce(school_code, '') = '';

-- 가족 공유 일정 · D-Day
create table if not exists public.family_events (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  title text not null,
  event_date text not null,
  event_time text default '',
  member_id text default 'all',
  category text default '가족',
  memo text default '',
  is_dday boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, id)
);

-- 키 · 몸무게 · BMI 성장 기록
create table if not exists public.family_growth (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  member_id text not null,
  record_date text not null,
  height_cm double precision,
  weight_kg double precision,
  bmi double precision,
  memo text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, id)
);

-- 학원 · 학교 숙제 (수동 입력 + 초파가 DB로 직접 넣기)
create table if not exists public.family_homeworks (
  room_id text not null references public.family_rooms(room_id) on delete cascade,
  id text not null,
  member_id text not null default 'all',
  subject text default '',
  title text not null,
  due_date text default '',
  done boolean not null default false,
  source text default 'manual',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, id)
);

create index if not exists family_events_date_idx on public.family_events (room_id, event_date);
create index if not exists family_growth_member_idx on public.family_growth (room_id, member_id, record_date);
create index if not exists family_homeworks_order_idx on public.family_homeworks (room_id, done, position);

create index if not exists family_todos_member_idx on public.family_todos (room_id, member_id, position);
create index if not exists family_chat_seq_idx on public.family_chat_messages (room_id, seq);
create index if not exists family_tx_seq_idx on public.family_allowance_tx (room_id, seq);

create or replace function public.family_dashboard_touch()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end $fn$;

do $t$
declare t text;
begin
  foreach t in array array[
    'family_rooms','family_members','family_todos','family_studies',
    'family_study_logs','family_stamps','family_missions',
    'family_events','family_growth','family_homeworks'
  ] loop
    execute format('drop trigger if exists trg_%1$s_touch on public.%1$s', t);
    execute format('create trigger trg_%1$s_touch before update on public.%1$s for each row execute function public.family_dashboard_touch()', t);
  end loop;
end $t$;

alter table public.family_rooms         enable row level security;
alter table public.family_members       enable row level security;
alter table public.family_todos         enable row level security;
alter table public.family_studies       enable row level security;
alter table public.family_study_logs    enable row level security;
alter table public.family_stamps        enable row level security;
alter table public.family_missions      enable row level security;
alter table public.family_chat_messages enable row level security;
alter table public.family_allowance_tx  enable row level security;
alter table public.family_events        enable row level security;
alter table public.family_growth        enable row level security;
alter table public.family_homeworks     enable row level security;

do $p$
declare t text; cond text;
begin
  cond := $c$length(coalesce(current_setting('request.headers', true)::json->>'x-room-code', '')) = 0 or room_id = current_setting('request.headers', true)::json->>'x-room-code'$c$;
  foreach t in array array['family_rooms','family_members','family_todos','family_studies','family_study_logs','family_stamps','family_missions','family_chat_messages','family_allowance_tx','family_events','family_growth','family_homeworks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_room_access', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (%s) with check (%s)', t || '_room_access', t, cond, cond);
  end loop;
end $p$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

do $r$
declare t text;
begin
  foreach t in array array[
    'family_rooms','family_members','family_todos','family_studies',
    'family_study_logs','family_stamps','family_missions',
    'family_chat_messages','family_allowance_tx',
    'family_events','family_growth','family_homeworks'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $r$;

select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename like 'family_%'
order by tablename;

-- ------------------------------------------------------------
-- v3 확장 (2026-11-17): Smart Life(Tuya) 집 조명 연동
--   * tuya_connections : 방별 Smart Life 토큰 (service_role 전용)
--   * family_rooms.light_labels : 스위치 채널 이름 별칭 (가족 공유)
--   * 위의 "grant select, insert, update, delete ... to anon, authenticated"
--     뒤에 revoke 가 와야 하므로 반드시 이 파일 맨 끝에 둔다.
-- ------------------------------------------------------------

create table if not exists public.tuya_connections (
  room_id text primary key references public.family_rooms(room_id) on delete cascade,
  home_id text not null,
  client_id text not null,
  user_code text not null,
  terminal_id text not null,
  endpoint text not null,
  uid text not null,
  access_token text not null,
  refresh_token text not null,
  expire_at_ms bigint not null,
  switch_labels jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tuya_connections enable row level security;

do $d$
begin
  execute 'drop policy if exists tuya_connections_room_access on public.tuya_connections';
end $d$;

revoke all on public.tuya_connections from anon, authenticated;
revoke all on public.tuya_connections from public;
grant all on public.tuya_connections to service_role;

alter table public.family_rooms
  add column if not exists light_labels jsonb not null default '{}'::jsonb;
