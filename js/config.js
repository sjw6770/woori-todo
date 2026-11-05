// 설치 가이드 4단계에서 채우는 값입니다. 비워 두면 "데모 모드"(이 기기에만 저장)로 동작합니다.
// 아래 두 키는 공개돼도 괜찮은 값입니다. (데이터는 DB 보안 규칙이 지킵니다)
// 절대 넣으면 안 되는 값: service_role / secret 키, VAPID 비공개 키
export const CONFIG = {
  SUPABASE_URL: 'https://gfaawesckaispbyjkost.supabase.co',        // 예: https://abcdefghijk.supabase.co
  SUPABASE_KEY: 'sb_publishable_jgAvN83AEKbopSxA3oxjdw_qlqzylpi',        // Project Settings > API Keys 의 Publishable key (sb_publishable_...) 또는 anon key
  VAPID_PUBLIC_KEY: 'BLR6y1KOYQrf3bZcN0GaeBL2Fx-py2sEh139Ouxx2Yt9KllNTbAQ1xZ-XAizSQfTf__yiXwqSXRQvNN_G4qo--g',    // keygen.html 에서 만든 공개 키
};
