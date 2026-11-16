-- =====================================================================
-- PAUSE (009) — 싸움이 위험해질 때: 멈춤 → 상태 체크 → 15분 진정 → 재측정 → 중재 대화 → 행동 약속 → 종료
-- 여러 번 실행해도 안전합니다. 시간은 모두 서버 시각 기준.
-- 공개 범위: 체크 강도·대화·약속은 둘 다 봄 / 체크 항목·혼잣말·감정 메모는 본인만
-- =====================================================================

-- 알림 구독: 앱 구분에 'pause' 추가
alter table public.push_subs drop constraint if exists push_subs_app_chk;
alter table public.push_subs add constraint push_subs_app_chk check (app in ('woori', 'joy', 'pause'));

-- 사람별 설정: 폭발 신호, 성향(열 오름/추궁), 안전계획 — 둘 다 볼 수 있음, 본인만 수정
create table if not exists public.pause_profiles (
  member_id       uuid primary key default auth.uid() references public.members(id) on delete cascade,
  style           text not null default 'heat' check (style in ('heat', 'chase')),
  signals         text[] not null default '{}' check (cardinality(signals) <= 20),
  safety_contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(safety_contacts) = 'array' and jsonb_array_length(safety_contacts) <= 5),
  safety_place    text check (safety_place is null or char_length(safety_place) <= 200),
  safety_note     text check (safety_note is null or char_length(safety_note) <= 500),
  updated_at      timestamptz not null default now()
);

-- 둘이 평온할 때 합의한 절대 금지 행동 (각자 동의 표시)
create table if not exists public.pause_rules (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (char_length(text) between 1 and 60),
  created_by  uuid default auth.uid() references public.members(id) on delete set null,
  agreed      uuid[] not null default '{}',
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- 한 번의 PAUSE
create table if not exists public.pause_sessions (
  id          uuid primary key default gen_random_uuid(),
  started_by  uuid not null default auth.uid() references public.members(id) on delete cascade,
  started_at  timestamptz not null default now(),
  cool_until  timestamptz not null default now(),
  extensions  integer not null default 0 check (extensions between 0 and 12),
  phase       text not null default 'cool' check (phase in ('cool', 'talk', 'agree', 'red', 'closed')),
  talk_at     timestamptz,
  red_at      timestamptz,
  red_by      uuid references public.members(id) on delete set null,
  end_votes   uuid[] not null default '{}',
  closed_at   timestamptz
);
-- 진행 중인 PAUSE 는 하나만 (둘이 동시에 눌러도 하나로 합쳐짐)
create unique index if not exists pause_one_open on public.pause_sessions ((true)) where closed_at is null;

create or replace function public.pause_session_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.started_at := now();
    new.cool_until := now() + interval '15 minutes';
    new.phase := 'cool'; new.extensions := 0; new.end_votes := '{}';
    new.talk_at := null; new.red_at := null; new.red_by := null; new.closed_at := null;
    return new;
  end if;
  if old.closed_at is not null then raise exception 'pause session already closed'; end if;
  if new.started_by <> old.started_by or new.started_at <> old.started_at then raise exception 'immutable'; end if;
  -- 연장: 서버 시각 기준 10분
  if new.extensions > old.extensions then
    new.extensions := old.extensions + 1;
    new.cool_until := now() + interval '10 minutes';
    if old.phase <> 'red' then new.phase := 'cool'; end if;
  else
    new.extensions := old.extensions;
    new.cool_until := old.cool_until;
  end if;
  -- 빨간 단계는 '안전해졌어' 로 끝내는 것만 가능
  if old.phase = 'red' and new.phase not in ('red', 'closed') then new.phase := 'red'; end if;
  if new.phase = 'red' and old.phase <> 'red' then new.red_at := now(); new.red_by := auth.uid(); end if;
  if new.phase = 'talk' and old.phase <> 'talk' and old.talk_at is null then new.talk_at := now(); end if;
  if new.phase = 'closed' then new.closed_at := now(); end if;
  return new;
end $$;
drop trigger if exists pause_session_rules on public.pause_sessions;
create trigger pause_session_rules before insert or update on public.pause_sessions
  for each row execute function public.pause_session_rules();

-- 상태 체크 (round 0 = 처음, 1.. = 재측정). 강도·들을 수 있는지·위험 여부만 공유
create table if not exists public.pause_checks (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.pause_sessions(id) on delete cascade,
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  round       integer not null default 0 check (round between 0 and 13),
  intensity   integer not null check (intensity between 0 and 10),
  can_listen  text check (can_listen in ('yes', 'unsure', 'no')),
  red         boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (session_id, member_id, round)
);

-- 본인만: 체크한 항목, 가장 큰 감정, 전송되지 않는 혼잣말, 대화 때 전할 말
create table if not exists public.pause_private (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.pause_sessions(id) on delete cascade,
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  kind        text not null check (kind in ('items', 'emotion', 'vent', 'save')),
  body        text check (body is null or char_length(body) <= 2000),
  items       text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- 상대에게 가는 말: 진정 중 정해진 3가지, 중재 대화(힘들었던 일·세 문장·이해 표시·질문·답)
create table if not exists public.pause_messages (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.pause_sessions(id) on delete cascade,
  from_member  uuid not null default auth.uid() references public.members(id) on delete cascade,
  kind         text not null check (kind in ('quick', 'hard', 'three', 'ack', 'question', 'answer')),
  body         text check (body is null or char_length(body) <= 1000),
  ack          text check (ack in ('yes', 'part', 'no')),
  created_at   timestamptz not null default now(),
  constraint pause_quick_fixed check (kind <> 'quick' or body in ('❤️ 나 안 떠났어', '🕐 진정하고 다시 얘기할게', '🫂 관계를 끝내자는 뜻 아니야')),
  constraint pause_ack_shape check ((kind = 'ack') = (ack is not null))
);

-- 행동 단위 약속: 내가 잘못한 행동 + 다음 싸움에서 할 행동
create table if not exists public.pause_commitments (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid references public.pause_sessions(id) on delete set null,
  member_id    uuid not null default auth.uid() references public.members(id) on delete cascade,
  wrong        text check (wrong is null or char_length(wrong) <= 300),
  next_action  text not null check (char_length(next_action) between 1 and 300),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 마무리 기록: 주요 계기, 이번에 넘은 금지 행동(본인 신고)
create table if not exists public.pause_closings (
  session_id  uuid not null references public.pause_sessions(id) on delete cascade,
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  triggers    text[] not null default '{}' check (cardinality(triggers) <= 8),
  broke       text[] not null default '{}' check (cardinality(broke) <= 20),
  created_at  timestamptz not null default now(),
  primary key (session_id, member_id)
);

-- 동시에 눌러도 안전한 갱신 (배열에 내 id 추가/빼기)
create or replace function public.pause_vote_end(sid uuid) returns public.pause_sessions
language plpgsql as $$
declare s public.pause_sessions; n integer;
begin
  update public.pause_sessions set end_votes = array(select distinct x from unnest(end_votes || auth.uid()) x)
    where id = sid and closed_at is null returning * into s;
  if s.id is null then raise exception 'no open session'; end if;
  select count(*) into n from public.members;
  if cardinality(s.end_votes) >= n then
    update public.pause_sessions set phase = 'closed' where id = sid returning * into s;
  end if;
  return s;
end $$;
create or replace function public.pause_rule_agree(rid uuid, yes boolean) returns void
language sql as $$
  update public.pause_rules set agreed = case when yes then array(select distinct x from unnest(agreed || auth.uid()) x)
                                              else array_remove(agreed, auth.uid()) end
  where id = rid;
$$;

-- 보안 규칙
alter table public.pause_profiles    enable row level security;
alter table public.pause_rules       enable row level security;
alter table public.pause_sessions    enable row level security;
alter table public.pause_checks      enable row level security;
alter table public.pause_private     enable row level security;
alter table public.pause_messages    enable row level security;
alter table public.pause_commitments enable row level security;
alter table public.pause_closings    enable row level security;

drop policy if exists pp_read on public.pause_profiles;   drop policy if exists pp_write on public.pause_profiles;
create policy pp_read  on public.pause_profiles for select to authenticated using (public.is_member());
create policy pp_write on public.pause_profiles for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

drop policy if exists pr_all on public.pause_rules;
create policy pr_all on public.pause_rules for all to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists ps_read on public.pause_sessions; drop policy if exists ps_ins on public.pause_sessions; drop policy if exists ps_upd on public.pause_sessions;
create policy ps_read on public.pause_sessions for select to authenticated using (public.is_member());
create policy ps_ins  on public.pause_sessions for insert to authenticated with check (public.is_member() and started_by = auth.uid());
create policy ps_upd  on public.pause_sessions for update to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists pc_read on public.pause_checks; drop policy if exists pc_write on public.pause_checks;
create policy pc_read  on public.pause_checks for select to authenticated using (public.is_member());
create policy pc_write on public.pause_checks for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

drop policy if exists pv_own on public.pause_private;
create policy pv_own on public.pause_private for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

drop policy if exists pm_read on public.pause_messages; drop policy if exists pm_ins on public.pause_messages;
create policy pm_read on public.pause_messages for select to authenticated using (public.is_member());
create policy pm_ins  on public.pause_messages for insert to authenticated with check (from_member = auth.uid() and public.is_member());

drop policy if exists pk_read on public.pause_commitments; drop policy if exists pk_write on public.pause_commitments;
create policy pk_read  on public.pause_commitments for select to authenticated using (public.is_member());
create policy pk_write on public.pause_commitments for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

drop policy if exists pz_read on public.pause_closings; drop policy if exists pz_write on public.pause_closings;
create policy pz_read  on public.pause_closings for select to authenticated using (public.is_member());
create policy pz_write on public.pause_closings for all to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_member());

do $$ begin
  begin alter publication supabase_realtime add table public.pause_sessions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pause_checks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pause_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pause_commitments; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pause_closings; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pause_rules; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pause_profiles; exception when duplicate_object then null; end;
end $$;

-- 처음 한 번: 예시 금지 행동 (둘이 동의 표시를 해야 '합의됨')
do $$ begin
  insert into public.app_flags (key) values ('009_pause_rules');
  insert into public.pause_rules (text, created_by, sort)
  select t, null, i from unnest(array['욕설', '인격모독', '헤어짐을 협박 수단으로 쓰기', '죽겠다는 말로 상대를 움직이기',
    '물건 던지기·부수기', '가족에게 연락하거나 찾아가기', '운전하면서 싸우기']) with ordinality as r(t, i);
exception when unique_violation then null; end $$;
