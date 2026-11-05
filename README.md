# 우리할일 — 둘이 쓰는 할일·약속 앱 (아이폰 홈 화면 앱)

Mac·유료 개발자 계정 없이, **브라우저만으로** 설치합니다. 비용 0원.

| 기능 | 설명 |
|---|---|
| 할일 / 약속 | 할일은 체크, 약속은 시간·장소 중심. 둘 다 반복(매일·매주 요일·매월) 가능 |
| 나 / 상대 / 공통 | 누구 일인지 색으로 구분 (종원 파랑, 지윤 분홍, 공통은 두 색 반반) |
| 아침 브리핑 | 매일 정한 시각에 오늘 할일·약속 목록을 알림으로 |
| 저녁 리마인드 | 못 끝낸 할일이 있으면 정한 시각에 알림 |
| 항목별 알림 | 할일: 정시 알림 + "완료할 때까지 30분/1시간/2시간마다 다시 알림" / 약속: 정시~하루 전 |
| 상대 알림 | 상대 몫이나 공통 항목을 추가·완료하면 상대 폰에 알림 |
| 실시간 동기화 | 한 사람이 체크하면 다른 폰에도 바로 반영 |
| 밀린 할일 | 지난 날짜의 미완료 할일이 오늘 화면 위에 모임 |
| 앱 아이콘 배지 | 오늘 남은 내 할일 수 |

## 구조

```
아이폰(홈 화면 웹앱) ──읽기/쓰기──▶ Supabase DB (두 사람만 접근 가능)
        ▲                               │ pg_cron: 매분 호출
        └──── 웹 푸시 알림 ◀── Edge Function "push-tick"
```

```
woori-todo/                 ← 이 저장소 = GitHub Pages 로 공개되는 앱
├─ index.html, css/, js/, sw.js, manifest.webmanifest, icons/
├─ js/config.js             ← 설치 중 3개 값 입력
├─ keygen.html              ← 알림용 키 만들기 (브라우저 안에서만 동작)
└─ supabase/
   ├─ schema.sql            ← 테이블·보안 규칙
   ├─ setup.sql             ← 두 사람 등록 + 매분 알림 예약
   └─ functions/push-tick/index.ts  ← 알림 서버 함수
```

---

## 설치 (PC 브라우저 권장, 약 30분)

### 1. Supabase 프로젝트 만들기
1. https://supabase.com 가입 → **New project**
2. Region 은 **Northeast Asia (Seoul)**, DB 비밀번호는 아무거나(따로 쓸 일 없음)
3. 만들어지면 **SQL Editor** → `supabase/schema.sql` 내용 전체 붙여넣기 → **Run**

### 2. 두 사람 계정 만들기
1. **Authentication → Users → Add user → Create new user**
2. 종원, 지윤 이메일·비밀번호로 각각 생성 (**Auto Confirm User** 체크)
3. 보안: **Authentication → Sign In / Providers** 에서 *Allow new users to sign up* 끄기 (다른 사람이 가입하지 못하게)

### 3. 앱 올리기 (GitHub Pages)
1. 이 저장소의 **Settings → Pages → Branch: main / (root) → Save**
2. 1~2분 뒤 `https://<GitHub아이디>.github.io/woori-todo/` 접속되면 성공 (아직은 데모 모드)

### 4. 알림 키 만들기
1. `https://<GitHub아이디>.github.io/woori-todo/keygen.html` 열기 → **키 만들기**
2. 나온 2개 값(공개 키, 비공개 키)을 메모해 두기

### 5. 알림 함수 배포
1. Supabase **Edge Functions → Deploy a new function → Via Editor**
2. 함수 이름 `push-tick`, 기본 코드를 지우고 `supabase/functions/push-tick/index.ts` 전체 붙여넣기 → **Deploy function** (10~30초)
3. 함수 상세의 **Details(설정)** 에서 **Enforce JWT verification(Verify JWT) 끄기** → Save  
   (함수가 CRON_SECRET 과 로그인 토큰을 직접 검사합니다)
4. **Edge Functions → Secrets** 에 4개 추가

| Key | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | 4단계 공개 키 |
| `VAPID_PRIVATE_KEY` | 4단계 비공개 키 |
| `VAPID_SUBJECT` | `mailto:본인이메일` |
| `CRON_SECRET` | 6단계 SQL 결과의 cron_secret 값 |

### 6. 마무리 SQL
`supabase/setup.sql` 을 **SQL Editor** 에서 Run (이메일·프로젝트 주소는 이미 채워져 있음).  
결과에 `종원, 지윤` 과 `cron_secret` 값이 보이면 성공 → 그 값을 5단계 Secrets 의 `CRON_SECRET` 에 넣기.

### 7. 앱에 서버 연결
GitHub 저장소에서 `js/config.js` 열기 → 연필(편집) 아이콘 → 3개 값 입력 → Commit

```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_KEY: 'sb_publishable_...',   // Project Settings → API Keys 의 Publishable key (또는 anon key)
VAPID_PUBLIC_KEY: '4단계 공개 키',
```

> `service_role` / `secret` 키와 VAPID **비공개** 키는 절대 config.js 에 넣지 마세요. config.js 의 값은 공개돼도 DB 보안 규칙이 데이터를 지킵니다.

### 8. 각자 아이폰에 설치 (iOS 16.4 이상)
1. **Safari** 로 `https://<GitHub아이디>.github.io/woori-todo/` 접속
2. 공유 버튼 → **홈 화면에 추가**
3. 홈 화면의 **우리할일** 아이콘으로 열기 → 로그인
4. **설정 → 알림 켜기 → 허용** → **테스트 알림 보내기** 로 확인

---

## 확인·문제 해결

| 증상 | 확인할 곳 |
|---|---|
| 알림이 전혀 안 옴 | 앱을 **홈 화면 아이콘**으로 열어서 알림을 켰는지 (Safari 탭에서는 불가) |
| 테스트 알림만 오고 예약 알림이 안 옴 | SQL Editor 에서 `select status_code, content::text from net._http_response order by created desc limit 5;` → 200 이 아니면 setup.sql 의 URL·CRON_SECRET 재확인 |
| 함수 오류 | Edge Functions → push-tick → **Logs** |
| 로그인 후 "등록되지 않은 계정" | setup.sql 의 이메일이 Users 의 이메일과 정확히 같은지 |
| 앱이 갑자기 안 열림 | Supabase 무료 프로젝트는 **7일 동안 활동이 없으면 일시정지** → 대시보드에서 Restore |
| 코드 수정 후 화면이 그대로 | 앱을 완전히 닫았다 다시 열기 (네트워크 우선이라 보통 바로 반영) |

## 알아둘 한계 (웹앱 방식)
- **알림은 최대 1분 정도 늦을 수 있어요.** 서버가 1분마다 확인해서 보내는 방식입니다.
- **알람처럼 계속 울리지는 않아요.** 일반 알림 1회입니다. 대신 할일에 "완료할 때까지 다시 알림"을 켜면 체크할 때까지 반복해서 알려줍니다.
- 집중 모드·방해 금지 중에는 iOS 설정에 따라 알림이 숨겨질 수 있어요.
- 나중에 Mac 과 유료 개발자 계정이 생기면 네이티브 앱으로 바꿔도 **DB 는 그대로** 쓸 수 있어요.

## 데모 모드
`config.js` 가 비어 있으면 서버 없이 이 기기에만 저장되는 데모로 동작합니다. 설정 화면에서 "지윤으로 보기"로 상대 화면도 미리 볼 수 있어요.
