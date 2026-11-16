-- =====================================================================
-- JOY — To Find Joy in Life (007). 여러 번 실행해도 안전합니다.
-- 우리할일과 같은 Supabase 프로젝트·계정을 쓰고, 데이터는 본인만 봅니다.
-- =====================================================================

-- 푸시 구독을 앱별로 구분 (우리할일 알림이 JOY 로, JOY 알림이 우리할일로 가지 않게)
alter table public.push_subs add column if not exists app text not null default 'woori';
do $$ begin
  alter table public.push_subs add constraint push_subs_app_chk check (app in ('woori', 'joy'));
exception when duplicate_object then null; end $$;

-- 설정 (트리거 앱, 연속 사용 기준 시간, 단축어용 토큰)
create table if not exists public.joy_settings (
  member_id        uuid primary key default auth.uid() references public.members(id) on delete cascade,
  trigger_apps     text[] not null default '{}',
  trigger_minutes  integer not null default 45 check (trigger_minutes between 5 and 240),
  recheck_minutes  integer not null default 30 check (recheck_minutes between 5 and 240),
  hook_token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  onboarded        boolean not null default false,
  created_at       timestamptz not null default now()
);

-- 활동 DB (기본 활동을 처음에 복사해 넣고, 이후 자유롭게 수정)
create table if not exists public.joy_activities (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  emoji       text check (emoji is null or char_length(emoji) <= 8),
  energy_min  smallint not null default 0 check (energy_min between 0 and 5),
  energy_max  smallint not null default 5 check (energy_max between 0 and 5),
  desires     text[] not null default '{}',          -- rest | fresh | vent | enjoy | out
  place       text not null default 'in' check (place in ('in', 'out')),
  minutes     integer check (minutes is null or minutes between 1 and 1440),
  prep        boolean not null default false,          -- 준비 필요
  cost        boolean not null default false,          -- 비용 발생
  custom      boolean not null default false,          -- 직접 만든 활동
  favorite    boolean not null default false,
  active      boolean not null default true,
  steps       jsonb not null default '[]'::jsonb,      -- [{"t":"현관까지만 가기","up":false}, ...]
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint joy_act_energy_range check (energy_max >= energy_min)
);
create index if not exists joy_activities_member_idx on public.joy_activities (member_id);

-- JOY DB: 개입/세션 기록
create table if not exists public.joy_sessions (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null default auth.uid() references public.members(id) on delete cascade,
  created_at      timestamptz not null default now(),
  trigger         text not null check (trigger in ('screen', 'help', 'manual', 'nodesire')),
  usage_minutes   integer,                       -- 트리거 당시 연속 사용 시간
  check_answer    text check (check_answer is null or check_answer in ('fun', 'scrolling', 'out')),
  situation       text check (situation is null or situation in ('lying', 'sitting', 'working', 'other')),
  energy          smallint check (energy is null or energy between 0 and 5),
  desire          text,                          -- rest | fresh | vent | enjoy | out | random | none
  suggested       uuid[] not null default '{}',  -- 제안된 활동들
  activity_id     uuid references public.joy_activities(id) on delete set null,
  activity_name   text,
  activity_emoji  text,
  transition_done boolean,                       -- 몸 일으키기 단계 성공 여부
  steps_done      integer not null default 0,
  steps_total     integer not null default 0,
  started         boolean not null default false,
  completed       boolean not null default false,
  joy             smallint check (joy is null or joy between -2 and 2),
  finished_at     timestamptz
);
create index if not exists joy_sessions_member_idx on public.joy_sessions (member_id, created_at desc);

-- 지정 앱 사용 상태 (단축어가 열림/닫힘을 알려 줌 → 서버가 연속 사용 시간을 계산)
create table if not exists public.joy_usage (
  member_id      uuid primary key references public.members(id) on delete cascade,
  open           boolean not null default false,
  started_at     timestamptz,     -- 이번 연속 사용 시작
  last_open_at   timestamptz,
  last_close_at  timestamptz,
  next_check_at  timestamptz,     -- 이 시각이 지나면 "Still having fun?" 알림
  updated_at     timestamptz not null default now()
);

-- 보안 규칙: 전부 본인 것만
alter table public.joy_settings   enable row level security;
alter table public.joy_activities enable row level security;
alter table public.joy_sessions   enable row level security;
alter table public.joy_usage      enable row level security;
drop policy if exists joy_settings_own   on public.joy_settings;
drop policy if exists joy_activities_own on public.joy_activities;
drop policy if exists joy_sessions_own   on public.joy_sessions;
drop policy if exists joy_usage_own      on public.joy_usage;
create policy joy_settings_own   on public.joy_settings   for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy joy_activities_own on public.joy_activities for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy joy_sessions_own   on public.joy_sessions   for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy joy_usage_own      on public.joy_usage      for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
