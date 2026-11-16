-- =====================================================================
-- 우리할일 — (008) 여러 번 실행해도 안전합니다.
--   1) 집중도·미루기·기분·불안(daily4)도 0~10점으로. 예전 0~5 기록은 ×2 로 한 번만 바꿈
--   2) 감정 기록의 비공개 메모 (나만 볼 수 있는 별도 표)
--   3) 갈 곳 태그
-- =====================================================================

-- 1) 점수 범위: 모든 항목 0~10 (web/js/mood.js 의 PROFILES 와 같이 바꾸세요)
create or replace function public.valid_mood_scores(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
    where e.key not in ('joy', 'calm', 'love', 'sad', 'anxious', 'angry', 'focus', 'procrast', 'mood', 'anxiety')
       or jsonb_typeof(e.value) <> 'number'
       or (e.value)::numeric < 0 or (e.value)::numeric > 10
  )
$$;

create table if not exists public.app_flags (key text primary key, at timestamptz not null default now());
alter table public.app_flags enable row level security;
do $$ begin
  insert into public.app_flags (key) values ('008_daily4_x2');
  update public.moods m set scores = (
    select jsonb_object_agg(e.key, case when e.key in ('focus', 'procrast', 'mood', 'anxiety')
                                        then to_jsonb((e.value)::numeric * 2) else e.value end)
    from jsonb_each(m.scores) e)
  where m.scores ?| array['focus', 'procrast', 'mood', 'anxiety'];
exception when unique_violation then null; end $$;

-- 2) 비공개 메모: 같은 날 감정 기록과 짝. 본인만 읽고 씀 (상대는 행 자체를 못 봄)
create table if not exists public.mood_private (
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  day         date not null,
  note        text not null check (char_length(note) between 1 and 300),
  updated_at  timestamptz not null default now(),
  primary key (member_id, day)
);
drop trigger if exists mood_private_touch on public.mood_private;
create trigger mood_private_touch before update on public.mood_private
  for each row execute function public.touch_updated_at();

alter table public.mood_private enable row level security;
drop policy if exists mood_private_own on public.mood_private;
create policy mood_private_own on public.mood_private for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

do $$ begin
  begin alter publication supabase_realtime add table public.mood_private; exception when duplicate_object then null; end;
end $$;

-- 3) 갈 곳 태그: 최대 10개, 각 1~20자 (사용자가 직접 붙이는 값이라 카카오 저장 제한과 무관)
alter table public.places add column if not exists tags text[] not null default '{}';
create or replace function public.valid_tags(t text[]) returns boolean
language sql immutable as $$
  select cardinality(t) <= 10 and not exists (select 1 from unnest(t) x where x is null or char_length(x) not between 1 and 20)
$$;
do $$ begin
  alter table public.places add constraint places_tags_chk check (public.valid_tags(tags));
exception when duplicate_object then null; end $$;
