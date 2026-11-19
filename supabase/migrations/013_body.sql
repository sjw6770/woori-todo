-- =====================================================================
-- 우리할일 — (013) 체중·인바디 관리. 여러 번 실행해도 안전합니다.
--   body_goals : 사람별 목표 체중·목표 골격근량, 상대에게 공개 여부 (기본: 나만 보기)
--   body_logs  : 하루 한 줄 기록 (체중 / 골격근량 / 체지방률, 하나 이상)
--   공개로 해 둔 사람의 목표·기록만 상대가 볼 수 있음
-- =====================================================================
create table if not exists public.body_goals (
  member_id      uuid primary key default auth.uid() references public.members(id) on delete cascade,
  target_weight  numeric(5,1) check (target_weight is null or target_weight between 20 and 300),
  target_smm     numeric(4,1) check (target_smm is null or target_smm between 5 and 100),
  shared         boolean not null default false,
  updated_at     timestamptz not null default now()
);

create table if not exists public.body_logs (
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  day         date not null,
  weight      numeric(5,1) check (weight is null or weight between 20 and 300),
  smm         numeric(4,1) check (smm is null or smm between 5 and 100),
  fat_pct     numeric(4,1) check (fat_pct is null or fat_pct between 1 and 70),
  note        text check (note is null or char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (member_id, day),
  constraint body_logs_some check (weight is not null or smm is not null or fat_pct is not null)
);

drop trigger if exists body_goals_touch on public.body_goals;
create trigger body_goals_touch before update on public.body_goals for each row execute function public.touch_updated_at();
drop trigger if exists body_logs_touch on public.body_logs;
create trigger body_logs_touch before update on public.body_logs for each row execute function public.touch_updated_at();

-- 이 사람이 공개해 뒀는지 (정책 안에서 쓰려고 security definer — 공개 여부만 알려 줌)
create or replace function public.body_shared(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select shared from public.body_goals where member_id = mid), false)
$$;

alter table public.body_goals enable row level security;
alter table public.body_logs enable row level security;
drop policy if exists bg_read on public.body_goals;  drop policy if exists bg_write on public.body_goals;
drop policy if exists bl_read on public.body_logs;   drop policy if exists bl_write on public.body_logs;
create policy bg_read  on public.body_goals for select to authenticated using (public.is_member() and (member_id = auth.uid() or shared));
create policy bg_write on public.body_goals for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());
create policy bl_read  on public.body_logs for select to authenticated using (public.is_member() and (member_id = auth.uid() or public.body_shared(member_id)));
create policy bl_write on public.body_logs for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

do $$ begin
  begin alter publication supabase_realtime add table public.body_goals; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.body_logs; exception when duplicate_object then null; end;
end $$;
