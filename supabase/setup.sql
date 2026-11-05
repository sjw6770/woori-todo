-- =====================================================================
-- 우리할일 — 마무리 설정 (schema.sql 실행 + 계정 2개 생성 + 함수 배포 후 실행)
-- 고칠 곳 없음. 통째로 SQL Editor 에 붙여넣고 Run 하세요.
-- 맨 마지막 결과에 나오는 cron_secret 값을 Edge Function Secrets 의 CRON_SECRET 에 넣습니다.
-- =====================================================================

-- 1) 두 사람 등록 (Authentication > Users 에서 만든 이메일)
insert into public.members (id, name, color)
  select id, '종원', '#3b6fd8' from auth.users where email = 'bellone1110@gmail.com'
on conflict (id) do update set name = excluded.name, color = excluded.color;

insert into public.members (id, name, color)
  select id, '지윤', '#e0607e' from auth.users where email = 'kimji1994@naver.com'
on conflict (id) do update set name = excluded.name, color = excluded.color;

-- 2) 매분 알림 함수 호출 예약 (pg_cron + pg_net)
create extension if not exists pg_cron;
create extension if not exists pg_net;

delete from vault.secrets where name in ('project_url', 'cron_secret');  -- 다시 실행해도 되도록
select vault.create_secret('https://gfaawesckaispbyjkost.supabase.co', 'project_url');
select vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'cron_secret');

select cron.unschedule('push-tick') where exists (select 1 from cron.job where jobname = 'push-tick');
select cron.schedule(
  'push-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- 확인용: 최근 실행 기록 (몇 분 뒤 status_code 200 이 보이면 정상)
-- select status_code, content::text, created from net._http_response order by created desc limit 5;

-- 결과 확인: 두 사람 이름과 cron_secret 이 나오면 성공
select (select string_agg(name, ', ') from public.members) as members,
       (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret') as cron_secret;
