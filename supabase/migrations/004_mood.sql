-- =====================================================================
-- 우리할일 — 하루 감정 기록 (004). 여러 번 실행해도 안전합니다.
-- 하루에 한 사람당 1개: 대표 이모지 + 감정별 점수(0~10) + 간단한 사유
-- =====================================================================

-- 감정 키와 점수 범위 검사 (키를 바꾸려면 web/js/mood.js 의 EMOTIONS 와 같이 바꾸세요)
create or replace function public.valid_mood_scores(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
    where e.key not in ('joy', 'calm', 'love', 'sad', 'anxious', 'angry')
       or jsonb_typeof(e.value) <> 'number'
       or (e.value)::numeric < 0 or (e.value)::numeric > 10
  )
$$;

create table if not exists public.moods (
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  day         date not null,
  emoji       text check (emoji is null or char_length(emoji) <= 8),
  scores      jsonb not null default '{}'::jsonb check (public.valid_mood_scores(scores)),
  note        text check (note is null or char_length(note) <= 300),
  shared      boolean not null default true,     -- false 면 나만 보기
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (member_id, day)
);

drop trigger if exists moods_touch on public.moods;
create trigger moods_touch before update on public.moods
  for each row execute function public.touch_updated_at();

-- 보안 규칙: 내 기록은 내가 쓰고, 상대는 공개한 기록만 볼 수 있음
alter table public.moods enable row level security;
drop policy if exists moods_read  on public.moods;
drop policy if exists moods_write on public.moods;
create policy moods_read on public.moods for select to authenticated
  using (public.is_member() and (member_id = auth.uid() or shared));
create policy moods_write on public.moods for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

do $$ begin
  begin alter publication supabase_realtime add table public.moods; exception when duplicate_object then null; end;
end $$;
