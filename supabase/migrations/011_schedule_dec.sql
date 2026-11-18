-- =====================================================================
-- 우리할일 — (011) 수첩 연말 일정 한 번만 넣기 (11/18 ~ 12/2)
--   app_flags 로 딱 한 번만 실행 → 나중에 앱에서 지워도 다시 생기지 않음
--   같은 날 같은 제목이 이미 있으면 건너뜀
-- =====================================================================
do $$
declare j uuid; y uuid;
begin
  insert into public.app_flags (key) values ('011_schedule_dec');
  select id into j from public.members where name = '종원';
  select id into y from public.members where name = '지윤';
  insert into public.items (kind, title, note, owner, start_date)
  select v.kind, v.title, v.note, case v.who when 'j' then j when 'y' then y else null end, v.d::date
  from (values
    ('event', '쉬는 날', null, null, '2026-11-18'),
    ('event', '종원 약속', null, 'j', '2026-11-19'),
    ('event', '지윤 약속', null, 'y', '2026-11-20'),
    ('event', '종원 약속', null, 'j', '2026-11-20'),
    ('event', '호캉스', null, null, '2026-11-21'),
    ('event', '보미랑', null, null, '2026-11-22'),
    ('task',  '각자 운동 후 운동 내역 공유', null, null, '2026-11-23'),
    ('event', '가봉', null, null, '2026-11-24'),
    ('event', '신라호텔 뷔페', '수첩 메모: (이벤트 사진?)', null, '2026-11-25'),
    ('task',  '각자 독서 day', null, null, '2026-11-26'),
    ('event', '관악 신풍루 곱창', null, null, '2026-11-27'),
    ('task',  '반찬 day', '같이 먹을 거면 사 가기', null, '2026-11-27'),
    ('event', '여주 아울렛', null, null, '2026-11-28'),
    ('task',  'dalbot retreat 예약', '수첩 글씨 그대로 옮김 — 맞는지 확인', null, '2026-12-01'),
    ('event', '포시즌스 칵테일 + 집 가서 클레이 대결', null, null, '2026-12-02')
  ) as v(kind, title, note, who, d)
  where not exists (select 1 from public.items i where i.title = v.title and i.start_date = v.d::date);
exception when unique_violation then null;
end $$;
