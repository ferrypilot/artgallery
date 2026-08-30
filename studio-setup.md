# 생성 스튜디오 · 서버 설정

`studio-ai.html` 과 `app/api/imagine/**` 를 붙이기 위해 필요한 것들.

## 환경변수

```
XAI_API_KEY=xai-...                 # 서버 전용. NEXT_PUBLIC_ 붙이지 마세요
XAI_TEXT_MODEL=grok-4.20-0309-non-reasoning  # 프롬프트 작성용. 모델 목록에서 확인하세요
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

`XAI_API_KEY` 에 `NEXT_PUBLIC_` 을 붙이는 순간 브라우저 번들에 들어갑니다.
학생 한 명이 개발자 도구를 열면 반 전체의 크레딧이 노출됩니다.

## 프롬프트 작성 단계

`POST /api/imagine/prompt` 가 학생의 한국어 메모를 영문 모션 프롬프트로
옮깁니다. 영상 모델은 "무엇이 보이는가"가 아니라 "무엇이 어떻게
움직이는가"에 반응하는데, 학생이 쓴 한 줄은 대개 전자입니다.

이 단계는 텍스트 모델 호출 한 번이라 사실상 공짜입니다. 반면 재시도
한 번은 영상 생성 한 번 값이 그대로 듭니다. **이 단계가 재시도를 한 번만
줄여도 본전을 훨씬 넘깁니다.**

결과는 학생에게 그대로 보여주고 고칠 수 있게 했습니다. 무엇이 전송되는지
감추지 않는 것이 중요합니다. 학생이 영문 프롬프트를 직접 손대면서
"모델이 무엇에 반응하는가"를 배우는 게 이 수업의 내용이기도 하고요.

모델 이름은 자주 바뀝니다. `XAI_TEXT_MODEL` 로 빼뒀으니 xAI 모델 목록에서
현재 쓸 수 있는 값을 확인하고 넣으세요.

## 테이블

```sql
create table generations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  gallery_id  uuid references galleries on delete set null,
  request_id  text,
  status      text not null default 'running',
    -- running | done | failed | expired
  prompt      text,      -- 실제로 xAI 에 보낸 영문 프롬프트
  prompt_ko   text,      -- 학생이 쓴 한국어 원문
  model       text,
  duration    int,
  resolution  text,
  source_url  text,      -- 원본 이미지 (xAI 에 넘긴 공개 URL)
  media_url   text,      -- 완성된 영상 (우리 Storage)
  cost_usd    numeric,
  error       text,
  created_at  timestamptz default now()
);

create index on generations (user_id, created_at desc);

alter table generations enable row level security;

create policy "본인 것만 본다"
  on generations for select using (user_id = auth.uid() or is_admin());
create policy "본인 것만 만든다"
  on generations for insert with check (user_id = auth.uid());
create policy "본인 것만 고친다"
  on generations for update using (user_id = auth.uid());
```

`is_admin()` 은 `supabase-auth.md` 에서 만든 함수입니다.
선생님이 반 전체의 생성 내역과 비용을 볼 수 있게 됩니다.

## Grok Imagine 이 실제로 받는 값

| 항목 | 범위 |
|---|---|
| 길이 | 1~15초 (한 번에) |
| 비율 | 1:1 · 16:9 · 9:16 · 4:3 · 3:4 · 3:2 · 2:3, 생략하면 원본 이미지 비율 |
| 화질 | 480p · 720p, 1080p 는 `grok-imagine-video-1.5` 의 이미지→영상에서만 |
| 소리 | 기본으로 함께 생성됩니다 (효과음·환경음·대사) |

이미지→영상에서는 **비율을 생략하는 쪽이 안전합니다.** 원본과 다른 비율을
지정하면 잘리거나 늘어납니다.

15초보다 긴 영상은 한 번에 못 만듭니다. `POST /v1/videos/extensions` 로
마지막 프레임에서 이어 붙이는 방식이고, 입력 영상은 8.7초가 상한입니다.
학생 작업에는 굳이 필요 없을 겁니다.

참조 이미지를 여러 장 쓰는 reference-to-video 도 있는데, 이쪽은 720p가
상한입니다. 같은 인물이나 사물을 여러 클립에 걸쳐 유지해야 할 때 쓰세요.

## 한도와 허용 범위

기본값은 **1인당 총 10개**, 화질은 **480p 하나**, 길이는 **5초까지**입니다.
바꾸는 것은 관리자뿐이고, 스튜디오 화면 위쪽 "관리자 설정"에서 합니다.

**길이가 사실상 예산 손잡이입니다.** 과금이 초당이라, 5초를 10초로 열면
같은 편수에 비용이 두 배가 됩니다. 쿼터보다 이쪽을 먼저 보세요.

```sql
-- 전체 기본값 (한 줄만 씁니다)
create table app_settings (
  id          int primary key default 1,
  quota       int  not null default 30,
  resolutions text[] not null default '{480p}',
  models      text[] not null default '{grok-imagine-video}',
  updated_by  uuid references auth.users,
  updated_at  timestamptz default now(),
  constraint one_row check (id = 1)
);
insert into app_settings (id) values (1) on conflict do nothing;

-- 학생별 예외 한도. 있으면 기본값을 이깁니다.
create table user_limits (
  email text primary key,
  quota int not null default 30
);

alter table app_settings enable row level security;
alter table user_limits  enable row level security;

-- 읽기는 로그인한 사람 누구나 (학생 화면이 자기 한도를 알아야 하므로)
create policy "read settings" on app_settings for select using (auth.uid() is not null);
create policy "read limits"   on user_limits  for select using (auth.uid() is not null);

-- 쓰기는 관리자만
create policy "admin writes settings" on app_settings for all using (is_admin());
create policy "admin writes limits"   on user_limits  for all using (is_admin());
```

`is_admin()` 은 `supabase-auth.md` 에서 만든 함수이고, `profiles.is_admin`
을 봅니다. 이 값은 대시보드에서만 바꿀 수 있으니 학생이 스스로
관리자가 될 수는 없습니다.

**어디서 막히는가**

| 검사 | 위치 |
|---|---|
| 한도 초과 | `POST /api/imagine` (429) |
| 잠긴 화질·모델 | `POST /api/imagine` (403) |
| 허용보다 긴 길이 | `POST /api/imagine` (403) |
| 설정 변경 | `POST /api/imagine/settings` (403) |
| 테이블 직접 수정 | RLS |

학생 화면의 자물쇠 표시는 안내입니다. 개발자 도구로 지워도
서버에서 403 이 떨어집니다.

**한도는 누적입니다.** 하루 단위가 아니라 총량이라, 학생이 몰아서 쓰든
나눠 쓰든 30개가 끝입니다. 학기 예산을 잡기에는 이쪽이 예측하기 쉽습니다.
한도를 다 쓴 학생은 관리자가 예외 목록에 넣어 늘려주면 됩니다.

## 비용 관리

라우트에는 상한이 박혀 있지 않고, `app_settings` 를 읽습니다.
관리자 화면에서 바꾼 값이 곧 안전장치입니다.

수업 전체 상한을 따로 두고 싶다면 뷰를 하나 만들어 두세요.

```sql
create view spend_today as
select user_id, count(*) as runs, sum(cost_usd) as usd
from generations
where created_at >= date_trunc('day', now())
group by user_id;
```

**재시도가 비용을 결정합니다.** 한 편 건지는 데 평균 몇 번 돌리는지가
총액을 좌우하지, 모델 단가가 좌우하지 않습니다. 첫 주에 이 숫자를
재보고 쿼터를 다시 정하세요.

## 알아둘 제약

**이미지는 공개 URL이어야 합니다.** xAI 가 이미지를 직접 내려받기 때문에
Storage 버킷이 public 이거나 서명 URL이 유효해야 합니다. 학생 원본이
공개 URL로 잠시 노출된다는 뜻이니, 민감한 사진은 올리지 않도록
안내하세요.

**완성 영상 URL은 만료됩니다.** 그래서 폴링 라우트가 `done` 이 된 순간
파일을 우리 Storage 로 옮겨 담습니다. 이 단계를 빼면 며칠 뒤 전시장의
영상이 전부 깨집니다.

**서버리스 실행 시간.** 영상을 받아 다시 올리는 부분이 Vercel 기본
10초를 넘길 수 있습니다. 720p 15초짜리가 특히 위험합니다.
`export const maxDuration = 60` 을 라우트에 추가하거나,
이 부분만 큐로 빼세요.

**폴링 주기.** 지금은 브라우저가 3초마다 우리 서버를 부르고, 우리 서버가
xAI 를 부릅니다. 학생 10명이 동시에 돌리면 xAI 쪽 rate limit 에 닿을 수
있습니다. 여유가 없으면 5초로 늘리거나, 서버에서 결과를 캐시하세요.

## 전시장에 걸기

스튜디오의 "전시장에 걸기" 버튼은 지금 편집 화면으로 넘기기만 합니다.
연결하려면 `works` 에 행을 하나 넣으면 끝입니다.

```ts
await supabase.from("works").insert({
  gallery_id, slot, title, note,
  kind: "video",
  media_url: gen.media_url,
});
```

`slot` 은 비어 있는 자리 중 하나를 고르게 하세요.
전시장 코드가 이미 `kind: "video"` 를 근접 재생·클릭 재생으로 처리합니다.
