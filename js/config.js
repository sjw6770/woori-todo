// 설치 가이드 4단계에서 채우는 값입니다. 비워 두면 "데모 모드"(이 기기에만 저장)로 동작합니다.
// 아래 두 키는 공개돼도 괜찮은 값입니다. (데이터는 DB 보안 규칙이 지킵니다)
// 절대 넣으면 안 되는 값: service_role / secret 키, VAPID 비공개 키
export const CONFIG = {
  SUPABASE_URL: '',        // 예: https://abcdefghijk.supabase.co
  SUPABASE_KEY: '',        // Project Settings > API Keys 의 Publishable key (sb_publishable_...) 또는 anon key
  VAPID_PUBLIC_KEY: '',    // keygen.html 에서 만든 공개 키
};
