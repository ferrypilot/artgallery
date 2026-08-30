# Art Gallery

가상전시관 · 수업용.

학생이 그린 그림을 짧은 영상으로 만들고, 3D 전시장에 걸어 관람합니다.
이 문서는 VS Code 에서 처음부터 띄우는 순서입니다.

## 0. 전략

프로토타입 HTML 을 React 로 다시 쓰지 않습니다. `public/` 에 그대로 두고
API 라우트만 Next.js 로 붙입니다. 같은 도메인이라 로그인 쿠키가 실리고,
HTML 안의 `fetch("/api/imagine")` 이 그대로 동작합니다.

React 로 옮기는 것은 나중에, 한 화면씩 하면 됩니다.

## 1. 준비물

- Node.js 20 이상 (`node -v` 로 확인)
- Supabase 프로젝트 (무료 플랜으로 충분합니다)
- xAI API 키 — https://console.x.ai
- VS Code 확장: **ESLint**, **Tailwind CSS IntelliSense**, **Supabase**

## 2. 프로젝트 만들기

이미 만들어져 있습니다. VS Code 터미널(``Ctrl+` ``)에서 받기만 하면 됩니다.

```bash
npm install
```

## 3. 파일 배치

```
ArtGallery/
├─ app/
│  ├─ layout.tsx
│  ├─ globals.css                    표준을 물려받는 곳 → public/theme.css
│  ├─ page.tsx                       안내 화면 · 서버 연결 확인
│  ├─ login/page.tsx                 선생님 매직링크 · 학생 비밀번호
│  ├─ auth/callback/route.ts         매직링크 착지점
│  └─ api/
│     ├─ imagine/
│     │  ├─ route.ts                 생성 시작 · 지난 영상 목록(GET)
│     │  ├─ [id]/route.ts            상태 폴링 · 영상을 Storage 로 옮김
│     │  ├─ prompt/route.ts          한국어 → 영문 모션 프롬프트
│     │  └─ settings/route.ts        한도·허용 범위
│     ├─ galleries/route.ts          전시장 목록·생성·꾸미기 저장·삭제
│     ├─ works/route.ts              작품 걸기·내리기
│     ├─ students/route.ts           학생 계정 (선생님·관리자) — 6-1, 9-1
│     ├─ account/password/route.ts  본인 비밀번호 바꾸기 — 9-1
│     ├─ backup/route.ts             exhibition.json 내보내기 — 10
│     └─ auth/signout/route.ts       로그아웃
├─ lib/
│  ├─ supabase.ts                    서버용 (쿠키 세션)
│  ├─ supabase-browser.ts            로그인 화면용
│  └─ imagine.ts                     모델표·한도 읽기, 라우트들이 공유
├─ middleware.ts                     세션 쿠키 갱신
├─ supabase/schema.sql               테이블·RLS·스토리지 한 벌 — 5번
├─ scripts/
│  ├─ make-admin.mjs                 관리자 계정 만들기 — 6번
│  ├─ backup.mjs                     영상까지 담은 오프라인 꾸러미 — 10번
│  └─ push.ps1                       커밋 전 비밀값 검사 후 push
├─ public/                           브라우저가 직접 여는 것들
│  ├─ theme.css                      화면 표준 — 글꼴·색·모서리 (아래 3-1)
│  ├─ exhibition.html                전시장 (구 exhibition-v5.html)
│  ├─ exhibition.json                작품 목록 — OFFLINE.md
│  ├─ studio-ai.html
│  └─ works/                         학생 작품 파일. 비어 있습니다
├─ docs/                             지난 버전들. 실행에 쓰이지 않습니다
├─ .env.local                        아래 4번. 없으면 갈래 1 로만 돕니다
└─ package.json
```

`exhibition.html` 안의 스튜디오 링크가 `studio-ai.html` 을 가리키므로
두 파일이 같은 `public/` 안에 있으면 됩니다.

### 3-1. 화면 표준 — `public/theme.css`

글꼴·색·모서리·간격이 **이 파일 한 곳에** 있습니다. 네 화면이 모두 여기를
읽습니다 — 정적 HTML 둘은 `<link href="theme.css">` 로, Next 페이지는
`app/globals.css` 가 `@import url('/theme.css')` 로 같은 파일을 집습니다.

```
글꼴   본문 나눔고딕 · 자간 0 · 굵기는 700 까지
       모노는 주소·코드·비밀번호처럼 한 글자씩 읽는 곳에만
색     --paper 바탕 · --card 카드 · --ink 본문 · --muted 보조 · --faint 약함
       글자 색은 세 단계만. 늘리면 위계가 흐려집니다
모양   --r 9px 버튼·입력칸 · --r-card 14px 카드. 둥글기는 두 가지만
버튼   .btn / .btn.primary / .btn-quiet — 한 화면에 primary 는 하나
```

**색을 화면마다 적지 마세요.** 두 곳에 적히는 순간 반드시 한쪽만 바뀝니다.

React 로 포팅할 때 쓸 `Gallery.jsx`(R3F 버전)는 `docs/` 에 있습니다.
그때 `npm i three @react-three/fiber @react-three/drei` 를 하세요.
지금은 필요 없어서 넣지 않았습니다.

## 4. 환경변수

프로젝트 루트에 `.env.local` 을 만듭니다. **커밋하지 마세요** —
`.gitignore` 에 이미 들어 있습니다.

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase 대시보드의 anon public 키>
XAI_API_KEY=<xAI 콘솔의 API 키>
XAI_TEXT_MODEL=grok-4.20-0309-non-reasoning
SUPABASE_SERVICE_ROLE_KEY=
```

마지막 줄의 값은 비워 두었습니다. `npm run push` 의 비밀값 검사가 그
변수 이름 뒤에 뭐라도 붙어 있으면 실제 키로 보고 멈추기 때문입니다 —
문서의 자리표시자까지 걸리지만, 검사를 느슨하게 푸는 것보다 낫습니다.
`env.local.example` 도 같은 이유로 비워 두었습니다. 값은 Supabase
대시보드 → Settings → API 의 `service_role` 에서 복사해 넣으세요.

`XAI_API_KEY` 에 `NEXT_PUBLIC_` 을 붙이면 브라우저 번들에 들어갑니다.
절대 붙이지 마세요. `SUPABASE_SERVICE_ROLE_KEY` 도 마찬가지입니다 —
RLS 를 통째로 무시하는 키라 새어 나가면 전부 열립니다. 학생 계정
만들기·비밀번호 초기화(9-1)에만 쓰이고, 없으면 그 두 기능만 닫힙니다.

## 5. 데이터베이스

Supabase 대시보드 → SQL Editor 에 **`supabase/schema.sql` 을 통째로**
붙여넣고 한 번 실행하면 끝입니다. 스토리지 버킷과 정책까지 들어 있습니다.

두 문서(`supabase-auth.md`, `studio-setup.md`)의 조각을 의존 순서대로
모아둔 파일입니다. 순서가 중요합니다 — 함수가 없으면 정책 생성이 실패합니다.
여러 번 실행해도 안전합니다.

무엇이 왜 그렇게 생겼는지는 두 문서를 보세요. 실행은 이 파일 하나로 합니다.

## 6. 관리자 계정

`profiles.is_admin` 은 화면에서 바꿀 수 없게 잠가둔 값입니다. 학생이 스스로
관리자가 되는 길을 없애려고 그렇게 뒀습니다. 두 가지 방법이 있습니다.

**비밀번호로 쓰는 관리자 계정을 만들려면** (`SUPABASE_SERVICE_ROLE_KEY` 필요)

```bash
node scripts/make-admin.mjs admin@class.local 비밀번호
```

이미 있는 주소면 비밀번호만 다시 맞춥니다. 여러 번 돌려도 안전합니다.

**이미 로그인해 본 계정을 관리자로 올리려면** SQL Editor 에서

```sql
update profiles set is_admin = true, approved = true
where email = 'joonall@naver.com';
```

### 6-1. 선생님 계정 — 학생 계정만

역할이 두 가지입니다.

| | 학생 계정 만들기·중지·비밀번호 초기화 | 한도·화질·모델·길이 |
|---|---|---|
| **관리자** `profiles.is_admin` | O | O |
| **선생님** `app_metadata.role = "teacher"` | O | **X** |

나눠 둔 이유는 돈입니다. 한도·화질·모델·길이는 곧 청구서라서(영상 한 편에
실제 요금이 붙습니다), 계정을 만들고 중지하는 일과 예산을 정하는 일을
다른 사람이 할 수 있게 했습니다. 선생님 화면에서는 그 칸들이 아예 뜨지
않고, 개발자 도구로 되살려 눌러도 서버가 403 으로 막습니다.

**선생님으로 지정하기** — SQL 이 아니라 인증 쪽 값입니다.

대시보드 → **Authentication → Users** → 그 사람 → **App Metadata** 에

```json
{ "role": "teacher" }
```

`profiles.is_admin` 은 `false` 로 두세요. 그게 켜져 있으면 관리자가 이깁니다.

`app_metadata` 를 쓴 이유는 두 가지입니다. `schema.sql` 을 돌리지 않아도
역할을 줄 수 있고, 이 값은 **service_role 만 쓸 수 있어서** 학생이 자기
토큰을 고쳐 선생님이 되는 길이 없습니다.
(`user_metadata` 는 본인이 고칠 수 있습니다. 절대 쓰지 마세요.)

**지금 `kangsong0217@gmail.com` 이 선생님입니다.**

학생 명단 조회·승인·중지·비밀번호 초기화는 전부 서버가
`SUPABASE_SERVICE_ROLE_KEY` 로 처리합니다. RLS 를 넓히지 않은 이유는,
`profiles` 에 update 를 열어주면 행 전체가 열려서 선생님이 자기 행의
`is_admin` 을 켤 수 있기 때문입니다. 컬럼 단위 제한은 RLS 로 표현할 수
없습니다.

## 7. 실행

```bash
npm run dev
```

- http://localhost:3000 → 안내 화면
- http://localhost:3000/exhibition.html → 전시장
- http://localhost:3000/studio-ai.html → 생성 스튜디오

스튜디오를 열었을 때 "데모 모드" 표시가 사라지면 서버가 제대로 붙은 것입니다.

**전시장 카드 그림은 학생이 정합니다.** 전시장 안 `전시 설정` →
**대표 이미지** 에서 사진을 고르면 로비 카드에 그것이 걸립니다. 고르지
않으면 지금처럼 전시실을 그린 그림이 나옵니다. 브라우저가 긴 변 800px
JPEG 으로 줄여서 올리므로 보통 50~150KB 이고, 전시장마다 파일 하나를
덮어써서 옛 그림이 쌓이지 않습니다. `npm run backup` 도 함께 받아가므로
오프라인 전시에서도 같은 카드가 나옵니다.

**지난 영상은 화면을 열 때 다시 불러옵니다.** 예전에는 목록이 브라우저
메모리에만 있어서 새로고침하면 사라졌습니다 — 파일과 기록은 멀쩡한데
화면만 비었습니다. 지금은 최근 60편까지 그대로 뜨고, 만드는 중이던 것은
진행도 이어집니다. 창을 닫았다 다시 열어도 됩니다.

**grok.com 이나 xAI 콘솔에서 따로 만든 영상은 가져오지 못합니다.**
xAI 에 목록을 내주는 API 가 없습니다(`GET /v1/videos` 는 404). 그쪽 영상을
쓰시려면 파일을 내려받아 `OFFLINE.md` 의 방식으로 `works/` 에 두고
`exhibition.json` 에 적으세요.

**`.env.local` 이 없어도 서버는 뜹니다.** 전시장과 두 스튜디오는 그대로
열리고, 생성 API 만 "Supabase 가 설정되지 않았습니다" 를 돌려줍니다.
갈래 1(`OFFLINE.md`)만 쓰신다면 여기까지로 충분합니다.

## 8. 확인 순서

한꺼번에 보지 말고 하나씩 끊어서 보세요.

1. `/api/imagine/settings` 를 브라우저에서 직접 열어 JSON 이 나오는지
   → 503 이면 `.env.local` 이 없는 것, 401 이면 로그인 전입니다
2. 스튜디오에서 "프롬프트 만들기" → 영문이 나오는지
   → 안 나오면 `XAI_TEXT_MODEL` 이름 문제. xAI 콘솔의 모델 목록과 대조
3. 480p 4초로 한 번 생성 → 1~3분 뒤 결과
   → `.next` 터미널 로그에 xAI 응답이 찍힙니다
4. 결과가 Storage `works/{uid}/videos/` 에 저장됐는지

## 9. 학생에게 열기 — Vercel 배포

무료입니다. HTTPS 와 고정 주소가 딸려 오고, 이 PC 를 켜둘 필요가 없습니다.

1. https://vercel.com 에서 GitHub 계정으로 로그인 → **Add New → Project**
2. `ferrypilot/artgallery` 선택. Next.js 는 자동으로 인식됩니다
3. **Environment Variables** 에 다섯 개를 넣습니다 (`.env.local` 이 아니라 여기입니다)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
XAI_API_KEY
XAI_TEXT_MODEL
SUPABASE_SERVICE_ROLE_KEY
```

마지막 하나가 없으면 배포본에서 학생 계정을 만들지 못합니다(9-1).

4. Deploy → `https://무언가.vercel.app` 을 받습니다
5. Supabase → Authentication → URL Configuration 에
   - **Site URL** 을 받은 주소로
   - **Redirect URLs** 에 `https://무언가.vercel.app/auth/callback` 추가

영상은 Vercel 이 아니라 Supabase Storage 에서 직접 나가므로 Vercel 전송량은
거의 쓰지 않습니다.

**Hobby 플랜은 개인·비상업 용도입니다.** 수강료를 받는 곳이라면 약관을
확인하세요.

## 9-1. 학생 계정 — 선생님이 등록

**메일을 전혀 쓰지 않습니다.** Supabase 기본 메일은 조직 팀원이 아닌
주소로는 발송 자체를 거부하고, 한도도 시간당 2통입니다. 학생 30명에게는
한 통도 가지 않습니다. 그래서 계정을 선생님이 직접 만듭니다.

```
선생님: 스튜디오 → 관리자 설정 → 학생 계정 → 주소를 붙여넣고 "계정 만들기"
        → 초기 비밀번호 표가 나옵니다. 복사하거나 CSV 로 받아 나눠주세요.
학생:   /login 에서 그 주소와 비밀번호로 로그인
```

주소는 줄바꿈이나 쉼표로 구분해 한 번에 여러 명 넣을 수 있습니다.
**`@` 없이 아이디만 적으면 `@class.local` 이 붙습니다** — 메일을 보내지
않으므로 실제 주소가 아니어도 되고, 학생 개인 주소를 모으지 않아도 됩니다.

**학생·선생님은 자기 비밀번호를 스스로 바꿉니다.** `/login` 에 로그인한
상태로 들어가면 **내 계정 → 비밀번호 바꾸기** 가 있습니다. 스튜디오 위쪽의
`비밀번호` 를 눌러도 그리로 갑니다. 지금 비밀번호를 한 번 더 묻습니다 —
교실 컴퓨터는 여러 명이 돌려 쓰고 로그아웃하지 않고 자리를 뜨는 일이
흔해서, 세션만 믿으면 지나가던 사람이 남의 비밀번호를 바꿔 잠가버릴 수
있습니다. 새 값으로 `123456` 은 받지 않습니다.

**매직링크만 써 온 계정은 비밀번호가 없어서** 여기서 "지금 비밀번호가 맞지
않습니다" 가 뜹니다. 초기화를 한 번 받은 뒤에 바꾸세요.

**초기 비밀번호는 만든 직후 화면에만 보입니다.** 서버는 저장하지 않습니다 —
저장하면 그게 곧 평문 비밀번호 목록이 되기 때문입니다. 잊어버린 학생에게는
같은 화면의 **비밀번호 초기화**로 새로 발급하세요.

`SUPABASE_SERVICE_ROLE_KEY` 가 필요합니다(계정 생성·비밀번호 초기화).
**RLS 를 통째로 무시하는 키**이니 서버 전용으로만 두고 `NEXT_PUBLIC_` 을
붙이지 마세요. 없으면 이 두 기능만 닫히고 나머지는 전부 동작합니다.

대시보드에서 **가입(Enable Sign Ups)은 꺼두세요.** 계정은 선생님만
만듭니다. 확인 메일 설정은 건드릴 필요가 없습니다 — 만들 때 확인을 마친
상태로 표시하므로 학생이 바로 로그인합니다.

**사용 중지는 화면이 아니라 RLS 가 막습니다.** 중지된 계정도 로그인 자체는
성공합니다 — Supabase 가 세션을 내주기 때문입니다. 전시장 생성과 영상 생성
정책에 `is_approved()` 조건이 걸려 있어서, 개발자 도구로 화면을 고쳐도
서버에서 막힙니다.

선생님 계정은 매직링크를 그대로 씁니다. 팀원 주소라 메일이 정상적으로
갑니다.

## 10. 전시 당일 — 오프라인으로

Supabase 무료는 월 전송량이 5GB 입니다. 관람객 30명이 각자 전시장을 한
바퀴 돌면 이 한도를 넘깁니다.

전시 전에 영상을 `public/works/` 로 내려받고 `exhibition.json` 에 적으면
**전송량이 0** 이 됩니다. 인터넷도 필요 없고, 노트북 한 대로 전시가 됩니다.
방법은 `OFFLINE.md` 에 있습니다.

**학생 작업을 잃지 않으려면 `npm run backup` 을 주기적으로 돌리세요.**
전시장에 걸지 않은 영상까지 학생별로 전부 받아 `backup/전시-날짜/` 를
만듭니다. 그 폴더 하나가 학기 전체의 사본이고, 그대로 전시장으로도
열립니다. 자세한 것은 `OFFLINE.md` 의 「학생 작업이 사라지지 않게」.

학기 중에는 Supabase 로 만들고, 전시 당일만 오프라인으로 여는 조합을
권합니다.

## 10-1. 만든 영상은 누가 볼 수 있나

| | 누가 보나 |
|---|---|
| 스튜디오 · **내 영상** | 본인만. `generations` 이 RLS 로 본인 행만 내줍니다 |
| 스튜디오 · **전체 학생** | **선생님과 관리자만.** 목록 위 스위치로 켭니다. 카드마다 만든 사람이 붙습니다 |
| 전시장에 **걸어둔** 작품 | 누구나. 그게 전시입니다 |
| 아직 **안 건** 영상 | 본인과 선생님·관리자. 그 밖에는 주소를 아는 사람만 |

학생 화면에는 스위치가 없고, 주소로 `?scope=all` 을 불러도 403 입니다.
남의 영상에는 **전시장에 걸기** 가 붙지 않습니다 — 전시장은 만든 사람의
것이고, 서버도 남의 생성물로는 걸기를 받지 않습니다.

`works` 버킷은 **public 이어야 합니다** — xAI 가 원본 이미지를 직접
내려받고, 전시장은 로그인 없이 열려야 하기 때문입니다. 그래서 "주소를
알면 열린다" 는 성질은 남습니다. 경로가 무작위 UUID 두 개라 찍어서
맞힐 수는 없습니다.

**대신 목록 조회는 본인 것만 됩니다.** 예전 정책(`bucket_id = 'works'`)
그대로면 로그인하지 않은 사람도 storage 의 list 로 폴더와 파일 이름을
전부 훑을 수 있어서, 사실상 반 전체의 영상이 누구에게나 열려 있습니다.
`schema.sql` 의 **"본인 파일만 목록에 보인다"** 정책이 그걸 막습니다.
아직 그 파일을 돌리지 않았다면 지금 한 번 돌리세요.

## 11. 알아둘 것

**서버리스 실행 시간.** 폴링 라우트가 완성 영상을 받아 Storage 로 옮깁니다.
Vercel 기본 10초를 넘길 수 있어서 `app/api/imagine/[id]/route.ts` 와
`app/api/imagine/route.ts` 에 `export const maxDuration = 60` 을 넣어뒀습니다.
로컬 개발에서는 무관합니다.

**전시장 목록의 출처는 세 갈래입니다.** `exhibition.html` 이 이 순서로 찾습니다.

1. `/api/galleries` — 서버가 붙어 있을 때. 학생이 스튜디오에서 건 작품이 옵니다
2. `./exhibition.json` — 서버 없이 여는 전시 (`OFFLINE.md`)
3. 파일 안의 내장 예시 — 둘 다 없을 때

서버가 한 번 응답하면 목록이 비어 있어도 `exhibition.json` 으로 되돌아가지
않습니다. 두 출처가 섞이면 무엇이 진짜인지 알 수 없게 되기 때문입니다.

**로그인은 실제 인증입니다.** `exhibition.html` 은 세션을 직접 만들지 않고
`/api/imagine/settings` 응답으로 로그인 여부만 판단합니다 — 401 이면 서버는
있고 로그인만 안 한 것, 503 이면 `.env.local` 이 없는 것입니다. 로그인
버튼은 `/login?next=...` 으로 넘기고, 끝나면 전시장으로 돌아옵니다.
서버가 없으면 로그인 버튼 자체를 감춥니다 — 눌러도 안 되는 버튼을 남기면
고장난 것처럼 보입니다.

**권한은 브라우저가 아니라 RLS 가 막습니다.** 화면의 "내 것인지" 표시는
안내일 뿐입니다. 개발자 도구로 남의 전시장 편집 화면을 열어도 서버가
0행을 돌려주고, 라우트는 그것을 403 으로 바꿔 보냅니다.

## 12. 포팅 순서 (급하지 않게)

1. ~~로그인 → Next.js 페이지 (`app/login/page.tsx`)~~ — 끝났습니다.
   선생님은 매직링크, 학생은 주소와 비밀번호로 들어옵니다
2. 로비 → `app/page.tsx`, Supabase 에서 목록 조회.
   지금은 두 프로토타입으로 가는 안내 화면입니다
3. 스튜디오 → `app/studio/page.tsx`
4. 전시장 3D → `Gallery.jsx` (R3F). 가장 나중에, 가장 신중하게

전시장을 마지막에 두는 이유는, 지금 vanilla three.js 버전이 검증됐고
R3F 포팅은 검증되지 않았기 때문입니다. 나머지가 다 돌아간 뒤에 손대세요.
