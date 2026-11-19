-- =====================================================================
-- 우리할일 — (014) 계획 실패 패널티. 여러 번 실행해도 안전합니다.
--   그날 할일(퀘스트)을 그날 안에 체크 못 하면, 다음 날 0시에 그 퀘스트 경험치만큼(또는 2배) 깎임
--   · 개인 할일은 담당자, 공통 할일은 둘 다
--   · 사람마다 끄기 / 1배 / 2배 고를 수 있음 (기본 1배)
--   · 경험치는 0 아래로 내려가지 않음 (가진 만큼만 깎음)
--   · 늦게라도 체크하면 원래 경험치는 그대로 받음 (깎인 건 그대로)
-- =====================================================================

-- 패널티 기록은 xp_log 에 음수로. 기존 보상 기록(item_id)과 겹치지 않게 penalty_item 을 따로 둠
alter table public.xp_log add column if not exists penalty_item uuid references public.items(id) on delete set null;
alter table public.xp_log drop constraint if exists xp_log_quest_type_check;
do $$ begin
  alter table public.xp_log add constraint xp_log_quest_type_check check (quest_type in ('daily', 'sub', 'penalty'));
exception when duplicate_object then null; end $$;
create unique index if not exists xp_log_penalty_uq on public.xp_log (penalty_item, occur_date, member_id) where penalty_item is not null;

-- 사람별 설정
create table if not exists public.xp_settings (
  member_id      uuid primary key default auth.uid() references public.members(id) on delete cascade,
  penalty_mult   smallint not null default 1 check (penalty_mult in (0, 1, 2)),
  penalty_since  date not null default ((now() at time zone 'Asia/Seoul')::date + 1),
  updated_at     timestamptz not null default now()
);
drop trigger if exists xp_settings_touch on public.xp_settings;
create trigger xp_settings_touch before update on public.xp_settings for each row execute function public.touch_updated_at();
alter table public.xp_settings enable row level security;
drop policy if exists xs_read on public.xp_settings; drop policy if exists xs_write on public.xp_settings;
create policy xs_read  on public.xp_settings for select to authenticated using (public.is_member());
create policy xs_write on public.xp_settings for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

-- 처음 켤 때: 지금 있는 사람은 내일 할일부터 적용 (오늘 것은 미리 알려 주지 못했으니 빼 줌)
insert into public.xp_settings (member_id) select id from public.members on conflict (member_id) do nothing;

do $$ begin
  begin alter publication supabase_realtime add table public.xp_settings; exception when duplicate_object then null; end;
end $$;
