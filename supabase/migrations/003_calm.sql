-- =====================================================================
-- 우리할일 — 진정하기 (003). 여러 번 실행해도 안전합니다.
-- 한 사람이 진정 요청 → 상대 화면에 진정 시간이 크게 뜸 → 정한 시간 뒤 다시 이야기
-- =====================================================================

create table if not exists public.calm_sessions (
  id           uuid primary key default gen_random_uuid(),
  from_member  uuid not null default auth.uid() references public.members(id) on delete cascade,
  minutes      integer not null default 20 check (minutes between 5 and 180),
  message      text check (message is null or length(message) <= 200),
  started_at   timestamptz not null default now(),
  ends_at      timestamptz not null,            -- 아래 트리거가 서버 시각 기준으로 채움
  accepted_at  timestamptz,                     -- 상대가 "나도 진정할게"
  ended_at     timestamptz,                     -- "다시 이야기하기" 또는 자동 정리
  ended_by     uuid references public.members(id) on delete set null
);
create index if not exists calm_active_idx on public.calm_sessions (started_at desc) where ended_at is null;

-- 시작·종료 시각은 폰 시계가 아니라 서버 시각으로
create or replace function public.calm_set_times() returns trigger
language plpgsql as $$
begin
  new.started_at := now();
  new.ends_at := now() + make_interval(mins => new.minutes);
  return new;
end $$;
drop trigger if exists calm_set_times on public.calm_sessions;
create trigger calm_set_times before insert on public.calm_sessions
  for each row execute function public.calm_set_times();

alter table public.calm_sessions enable row level security;
drop policy if exists calm_all on public.calm_sessions;
create policy calm_all on public.calm_sessions for all to authenticated
  using (public.is_member()) with check (public.is_member());

do $$ begin
  begin alter publication supabase_realtime add table public.calm_sessions; exception when duplicate_object then null; end;
end $$;
