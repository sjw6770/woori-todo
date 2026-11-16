-- =====================================================================
-- 우리할일 — (010) 하루 일기. 여러 번 실행해도 안전합니다.
--   한 사람당 하루 한 편. '함께 보기'로 저장한 것만 상대가 볼 수 있음
-- =====================================================================
create table if not exists public.diaries (
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  day         date not null,
  body        text not null check (char_length(body) between 1 and 5000),
  shared      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (member_id, day)
);
drop trigger if exists diaries_touch on public.diaries;
create trigger diaries_touch before update on public.diaries
  for each row execute function public.touch_updated_at();

alter table public.diaries enable row level security;
drop policy if exists diaries_read on public.diaries;
drop policy if exists diaries_write on public.diaries;
create policy diaries_read on public.diaries for select to authenticated
  using (public.is_member() and (member_id = auth.uid() or shared));
create policy diaries_write on public.diaries for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

do $$ begin
  begin alter publication supabase_realtime add table public.diaries; exception when duplicate_object then null; end;
end $$;
