-- =====================================================================
-- 우리할일 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요. (1회)
-- =====================================================================

-- 1) 구성원 (종원, 지윤 두 명만) ------------------------------------------
create table if not exists public.members (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default '#3b6fd8',
  brief_time  time not null default '08:00',   -- 아침 브리핑 시각 (KST)
  nag_time    time not null default '21:00',   -- 저녁 미완료 리마인드 시각 (KST)
  created_at  timestamptz not null default now()
);

-- 2) 할일 / 약속 ----------------------------------------------------------
create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'task' check (kind in ('task','event')),
  title         text not null check (length(title) between 1 and 200),
  note          text,
  owner         uuid references public.members(id) on delete cascade, -- null = 공통
  start_date    date not null,
  time          time,                          -- 할일: 알림 시각 / 약속: 시작 시각
  end_date      date,                          -- 반복 종료일 (null = 계속)
  repeat        text not null default 'none' check (repeat in ('none','daily','weekly','monthly')),
  weekdays      smallint[] not null default '{}', -- 매주 반복 요일 (0=일 … 6=토)
  remind_before integer,                       -- 몇 분 전에 알릴지 (null = 알림 없음, 0 = 정시)
  nag_every     integer not null default 0,    -- 완료할 때까지 N분마다 다시 알림 (0 = 끔)
  created_by    uuid default auth.uid() references public.members(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists items_start_idx on public.items (start_date);

-- 3) 완료 체크 (반복 항목은 날짜별로 체크) -------------------------------
create table if not exists public.completions (
  item_id    uuid not null references public.items(id) on delete cascade,
  occur_date date not null,
  done_by    uuid default auth.uid() references public.members(id) on delete set null,
  done_at    timestamptz not null default now(),
  primary key (item_id, occur_date)
);

-- 4) 푸시 구독 (아이폰마다 1개) -------------------------------------------
create table if not exists public.push_subs (
  endpoint   text primary key,
  member_id  uuid not null default auth.uid() references public.members(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- 5) 중복 발송 방지 기록 (서버 함수만 사용) ------------------------------
create table if not exists public.sent_log (
  key     text primary key,
  sent_at timestamptz not null default now()
);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- 보안 규칙 (RLS): 등록된 두 사람만 읽고 쓸 수 있음
-- =====================================================================
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = auth.uid())
$$;

alter table public.members     enable row level security;
alter table public.items       enable row level security;
alter table public.completions enable row level security;
alter table public.push_subs   enable row level security;
alter table public.sent_log    enable row level security;  -- 정책 없음 = 앱에서 접근 불가

drop policy if exists members_read   on public.members;
drop policy if exists members_update on public.members;
create policy members_read   on public.members for select to authenticated using (public.is_member());
create policy members_update on public.members for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists items_all on public.items;
create policy items_all on public.items for all to authenticated
  using (public.is_member()) with check (public.is_member());

drop policy if exists completions_all on public.completions;
create policy completions_all on public.completions for all to authenticated
  using (public.is_member()) with check (public.is_member());

drop policy if exists push_subs_own on public.push_subs;
create policy push_subs_own on public.push_subs for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());

-- 실시간 동기화 (한 사람이 체크하면 상대 화면에 바로 반영)
do $$ begin
  begin alter publication supabase_realtime add table public.items;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.completions; exception when duplicate_object then null; end;
end $$;
