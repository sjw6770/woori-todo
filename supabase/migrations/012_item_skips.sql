-- =====================================================================
-- 우리할일 — (012) 반복 일정에서 '이 날만 건너뛰기' / '이 날만 바꾸기'
--   건너뛴 날짜를 항목에 목록으로 저장 (앱·알림 서버 모두 이 날짜는 없는 날로 봄)
--   여러 번 실행해도 안전합니다.
-- =====================================================================
alter table public.items add column if not exists skip_dates date[] not null default '{}';
do $$ begin
  alter table public.items add constraint items_skip_dates_chk check (cardinality(skip_dates) <= 400);
exception when duplicate_object then null; end $$;
