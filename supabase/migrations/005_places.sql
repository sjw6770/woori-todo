-- =====================================================================
-- 우리할일 — 갈 곳 목록 (005). 여러 번 실행해도 안전합니다.
--
-- 카카오 로컬 API 운영정책: 검색 결과(이름·주소·좌표 등)를 저장해 재사용하면 안 되고,
-- "장소 ID 만 기록하고 나머지는 실시간 호출"은 허용 (devtalk.kakao.com/t/api-20/151271).
-- 그래서 카카오 장소는 ID + 사용자가 직접 입력한 검색어만 저장하고, 보여줄 때마다 다시 조회합니다.
-- OpenStreetMap(ODbL, 출처 표시 시 저장 가능)과 직접 입력한 장소는 이름·주소를 저장합니다.
-- =====================================================================

create table if not exists public.places (
  id          uuid primary key default gen_random_uuid(),
  source      text not null check (source in ('kakao', 'osm', 'manual')),
  source_id   text,                 -- 카카오 장소 ID / OSM "node/123"
  query       text check (query is null or char_length(query) <= 100),   -- 사용자가 입력한 검색어
  name        text check (name is null or char_length(name) <= 120),
  address     text check (address is null or char_length(address) <= 200),
  category    text check (category is null or char_length(category) <= 60),
  lat         double precision,
  lng         double precision,
  url         text check (url is null or char_length(url) <= 300),
  memo        text check (memo is null or char_length(memo) <= 300),
  visited_at  timestamptz,
  added_by    uuid default auth.uid() references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- 카카오 장소는 응답 내용을 저장하지 않음
  constraint places_kakao_id_only check (
    source <> 'kakao' or (query is not null and name is null and address is null and category is null
                          and lat is null and lng is null and url is null)),
  constraint places_has_label check (source = 'kakao' or name is not null)
);
create unique index if not exists places_source_uq on public.places (source, source_id) where source_id is not null;

-- 할일·약속에 장소 연결
alter table public.items add column if not exists place_id uuid references public.places(id) on delete set null;

alter table public.places enable row level security;
drop policy if exists places_all on public.places;
create policy places_all on public.places for all to authenticated
  using (public.is_member()) with check (public.is_member());

do $$ begin
  begin alter publication supabase_realtime add table public.places; exception when duplicate_object then null; end;
end $$;
