-- =====================================================================
-- 우리할일 — 퀘스트 · 경험치 · 레벨 보상 (002)
-- 여러 번 실행해도 안전합니다. GitHub Actions 가 자동으로 적용합니다.
-- =====================================================================

-- 1) 할일 난이도 ---------------------------------------------------------
alter table public.items add column if not exists difficulty text not null default 'normal';
do $$ begin
  alter table public.items add constraint items_difficulty_chk
    check (difficulty in ('easy', 'normal', 'hard', 'epic'));
exception when duplicate_object then null; end $$;

-- 난이도별 경험치 (바꾸려면 이 숫자와 web/js/quest.js 의 XP 를 같이 바꾸세요)
create or replace function public.quest_xp(d text) returns integer
language sql immutable as $$
  select case d when 'easy' then 10 when 'normal' then 25 when 'hard' then 50 when 'epic' then 100 else 0 end
$$;

-- 2) 경험치 기록 (완료 체크 시 자동 적립, 체크 취소 시 회수) ------------
create table if not exists public.xp_log (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  item_id     uuid references public.items(id) on delete set null,  -- 퀘스트를 지워도 경험치는 남음
  occur_date  date not null,
  title       text not null,
  xp          integer not null,
  quest_type  text not null check (quest_type in ('daily', 'sub')),
  created_at  timestamptz not null default now()
);
create index if not exists xp_log_member_idx on public.xp_log (member_id);

-- 사람별 누적 경험치 (앱은 이 합계로 레벨을 계산)
create or replace view public.xp_totals with (security_invoker = true) as
  select member_id, sum(xp)::integer as total from public.xp_log group by member_id;
create unique index if not exists xp_log_item_date_uq on public.xp_log (item_id, occur_date) where item_id is not null;

-- 개인 퀘스트 → 담당자, 공통 퀘스트 → 체크한 사람
create or replace function public.award_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare it public.items%rowtype; who uuid;
begin
  select * into it from public.items where id = new.item_id;
  if not found or it.kind <> 'task' then return new; end if;
  who := coalesce(it.owner, new.done_by, auth.uid());
  if who is null then return new; end if;
  insert into public.xp_log (member_id, item_id, occur_date, title, xp, quest_type)
  values (who, it.id, new.occur_date, it.title, public.quest_xp(it.difficulty),
          case when it.repeat = 'none' then 'sub' else 'daily' end)
  on conflict (item_id, occur_date) where item_id is not null do nothing;
  return new;
end $$;

-- 체크 취소 시 회수. 퀘스트 자체를 삭제해서 지워지는 경우(items 가 이미 없음)는 그대로 둠
create or replace function public.revoke_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.items where id = old.item_id) then
    delete from public.xp_log where item_id = old.item_id and occur_date = old.occur_date;
  end if;
  return old;
end $$;

drop trigger if exists completions_award on public.completions;
create trigger completions_award after insert on public.completions
  for each row execute function public.award_xp();
drop trigger if exists completions_revoke on public.completions;
create trigger completions_revoke after delete on public.completions
  for each row execute function public.revoke_xp();

-- 이미 완료해 둔 할일도 경험치로 쳐 줌 (처음 한 번)
insert into public.xp_log (member_id, item_id, occur_date, title, xp, quest_type, created_at)
select coalesce(i.owner, c.done_by), i.id, c.occur_date, i.title, public.quest_xp(i.difficulty),
       case when i.repeat = 'none' then 'sub' else 'daily' end, c.done_at
from public.completions c join public.items i on i.id = c.item_id
where i.kind = 'task' and coalesce(i.owner, c.done_by) is not null
on conflict (item_id, occur_date) where item_id is not null do nothing;

-- 3) 레벨 보상 -----------------------------------------------------------
create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,  -- 보상 받을 사람
  level       integer not null check (level between 2 and 999),
  title       text not null check (length(title) between 1 and 200),
  note        text,
  created_by  uuid default auth.uid() references public.members(id) on delete set null,  -- 보상을 걸어 둔 사람
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists rewards_member_idx on public.rewards (member_id, level);

-- 4) 보안 규칙 -----------------------------------------------------------
alter table public.xp_log  enable row level security;
alter table public.rewards enable row level security;

drop policy if exists xp_log_read on public.xp_log;
create policy xp_log_read on public.xp_log for select to authenticated using (public.is_member());
-- xp_log 쓰기는 트리거만 (앱에서 직접 못 고침)

drop policy if exists rewards_all on public.rewards;
create policy rewards_all on public.rewards for all to authenticated
  using (public.is_member()) with check (public.is_member());

-- 5) 실시간 동기화 -------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.xp_log;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rewards; exception when duplicate_object then null; end;
end $$;
