-- =====================================================================
-- 우리할일 — 사람별 감정 기록 방식 (006). 여러 번 실행해도 안전합니다.
--   emotions : 감정 6가지 0~10점 + 기분 이모지 (종원)
--   daily4   : 집중도·미루기·기분·불안 0~5점, 이모지 없음 (지윤)
-- =====================================================================

alter table public.members add column if not exists mood_profile text not null default 'emotions';
do $$ begin
  alter table public.members add constraint members_mood_profile_chk check (mood_profile in ('emotions', 'daily4'));
exception when duplicate_object then null; end $$;

-- 점수 키와 범위 (키별로 0~10 또는 0~5). web/js/mood.js 의 PROFILES 와 같이 바꾸세요.
create or replace function public.valid_mood_scores(j jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (
    select 1 from jsonb_each(j) e
    where jsonb_typeof(e.value) <> 'number'
       or not (
         (e.key in ('joy', 'calm', 'love', 'sad', 'anxious', 'angry') and (e.value)::numeric between 0 and 10)
         or (e.key in ('focus', 'procrast', 'mood', 'anxiety') and (e.value)::numeric between 0 and 5))
  )
$$;

-- 한 번만 실행되는 설정: 지윤의 기록 방식을 daily4 로 (나중에 설정에서 바꾸면 그대로 유지)
create table if not exists public.app_flags (key text primary key, at timestamptz not null default now());
alter table public.app_flags enable row level security;   -- 정책 없음 = 앱에서 접근 불가
do $$ begin
  insert into public.app_flags (key) values ('006_jiyun_daily4');
  update public.members set mood_profile = 'daily4' where name = '지윤';
exception when unique_violation then null; end $$;
