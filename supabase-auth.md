# 이메일 로그인 · 권한 실제 구현

프로토타입(`exhibition-v5.html`)의 로그인은 흐름 확인용 목업입니다.
인증 코드가 화면에 보이고, 권한 검사가 브라우저에서 돕니다.
이 문서는 그것을 실제로 동작하게 만드는 방법입니다.

**핵심 원칙 하나**: 클라이언트 코드는 보안이 아닙니다. 삭제를 막는 것은
아래 RLS 정책이지, 화면에서 버튼을 숨기는 코드가 아닙니다.

---

## 1. 스키마

```sql
-- 학생 프로필. auth.users 와 1:1
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  display_name text not null,
  avatar_type  text not null default 'neutral'
    check (avatar_type in ('male','female','neutral')),
  is_admin     boolean not null default false,
  created_at   timestamptz default now()
);

create table galleries (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users on delete cascade,
  handle      text unique not null check (handle ~ '^[a-z0-9-]{2,20}$'),
  title       text not null,
  statement   text,
  theme       jsonb not null default '{"wall":"#131318","floor":"#0a0a0c"}',
  is_public   boolean not null default true,
  created_at  timestamptz default now()
);

create table works (
  id         uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references galleries on delete cascade,
  slot       int  not null check (slot between 0 and 9),
  title      text not null,
  note       text,
  kind       text not null check (kind in ('image','video')),
  media_url  text not null,
  poster_url text,
  created_at timestamptz default now(),
  unique (gallery_id, slot)          -- 한 자리에 한 점
);

create table guestbook (
  id           uuid primary key default gen_random_uuid(),
  gallery_id   uuid not null references galleries on delete cascade,
  visitor_name text not null,
  avatar_type  text not null default 'neutral',
  message      text not null check (char_length(message) <= 80),
  created_at   timestamptz default now()
);
```

`unique (gallery_id, slot)` 가 중요합니다. 프로토타입에서는 배열로 관리했지만,
DB에서는 이 제약이 "한 자리에 두 점이 겹치는" 사고를 막아줍니다.

---

## 2. RLS — 여기가 실제 방어선

```sql
alter table profiles  enable row level security;
alter table galleries enable row level security;
alter table works     enable row level security;
alter table guestbook enable row level security;

-- 관리자 판별을 한 곳에 모아둡니다
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 소유 여부
create or replace function owns_gallery(g uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.galleries
    where id = g and owner_id = auth.uid()
  );
$$;

-- ── profiles ───────────────────────────────────
-- RLS 는 정책이 없으면 전부 거부입니다. 이게 없으면 서버가 is_admin 을
-- 읽지 못해서 관리자가 영영 관리자로 인식되지 않습니다.
create policy "본인 프로필을 본다"
  on profiles for select using (id = auth.uid() or is_admin());

-- update 정책은 일부러 두지 않습니다. profiles.is_admin 을 학생이 스스로
-- 켜지 못하게 막는 것이 이 빈자리입니다. 프로필 이름 수정 화면을 만들 때는
-- is_admin 을 뺀 컬럼만 고치는 security definer 함수를 따로 두세요.

-- ── galleries ──────────────────────────────────
create policy "누구나 공개 전시장을 본다"
  on galleries for select using (is_public or owner_id = auth.uid() or is_admin());

create policy "로그인한 사람은 자기 전시장을 만든다"
  on galleries for insert with check (owner_id = auth.uid());

create policy "주인과 관리자만 수정한다"
  on galleries for update using (owner_id = auth.uid() or is_admin());

create policy "주인과 관리자만 삭제한다"
  on galleries for delete using (owner_id = auth.uid() or is_admin());

-- ── works ──────────────────────────────────────
create policy "공개 전시장의 작품은 누구나 본다"
  on works for select using (
    exists (select 1 from galleries g where g.id = gallery_id and g.is_public)
    or owns_gallery(gallery_id) or is_admin()
  );

create policy "주인과 관리자만 작품을 건다"
  on works for insert with check (owns_gallery(gallery_id) or is_admin());

create policy "주인과 관리자만 작품을 바꾼다"
  on works for update using (owns_gallery(gallery_id) or is_admin());

create policy "주인과 관리자만 작품을 내린다"
  on works for delete using (owns_gallery(gallery_id) or is_admin());

-- ── guestbook ──────────────────────────────────
create policy "방명록은 누구나 읽는다"
  on guestbook for select using (true);

create policy "방명록은 누구나 남긴다"     -- 로그인 없이도
  on guestbook for insert with check (true);

create policy "전시장 주인과 관리자만 지운다"
  on guestbook for delete using (owns_gallery(gallery_id) or is_admin());
```

`galleries` 를 지우면 `on delete cascade` 로 `works` 와 `guestbook` 이
함께 사라집니다. 애플리케이션에서 순서대로 지울 필요가 없습니다.

---

## 3. 로그인

Supabase 대시보드에서 **Authentication → Providers → Email** 을 켜고
**Confirm email** 을 활성화하면 매직링크가 동작합니다.

```ts
// 로그인 요청
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: `${location.origin}/auth/callback`,
    shouldCreateUser: true,
  },
});
```

```ts
// app/auth/callback/route.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (code) {
    const supabase = createServerClient(/* cookies */);
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/`);
}
```

### 가입은 열어둡니다

지메일, 네이버 등 어떤 주소로도 가입할 수 있습니다. 도메인 제한을 걸지
않는 대신, 경계는 **소유권**이 담당합니다. 누가 가입하든 남의 전시장은
건드릴 수 없고, 자기 전시장만 만들 수 있습니다.

Supabase 대시보드에서 **Rate Limits** 를 확인해두세요. 열린 가입에서
같은 IP의 무한 인증 메일 요청을 막는 것은 이쪽입니다.

전시가 끝난 뒤 새 전시장 생성을 닫고 싶다면, 가입을 막는 대신
`galleries` 의 insert 정책을 조이는 편이 낫습니다.

```sql
-- 예: 초대된 사람만 전시장을 만들 수 있게
create table allowlist (email text primary key);

drop policy "로그인한 사람은 자기 전시장을 만든다" on galleries;
create policy "허용된 사람만 전시장을 만든다"
  on galleries for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from allowlist a
      where a.email = (select email from auth.users where id = auth.uid())
    )
  );
```

이렇게 하면 관람과 방명록은 누구에게나 열려 있고, 전시장 생성만
선생님이 명단으로 통제합니다. 처음에는 이 정책 없이 시작하고,
필요해지면 추가하세요.

### 가입 직후 프로필 자동 생성

```sql
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

이름은 이메일 앞부분으로 임시 생성되므로, 첫 로그인 후 프로필 화면에서
학생이 직접 고치게 하세요.

### 관리자 지정

`profiles.is_admin` 을 직접 true 로 바꿉니다. RLS 때문에 클라이언트에서는
바꿀 수 없고, 대시보드 SQL 에디터나 service role 키로만 가능합니다.

```sql
update profiles set is_admin = true
where id = (select id from auth.users where email = 'joonall@naver.com');
```

---

## 4. 스토리지

```sql
insert into storage.buckets (id, name, public)
values ('works', 'works', true);
```

경로 규칙을 `{user_id}/{gallery_handle}/{filename}` 으로 두면
정책이 단순해집니다.

```sql
create policy "본인 폴더에만 올린다"
  on storage.objects for insert
  with check (
    bucket_id = 'works'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "작품 파일은 누구나 본다"
  on storage.objects for select using (bucket_id = 'works');

create policy "본인 파일만 지운다"
  on storage.objects for delete using (
    bucket_id = 'works'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

-- 폴링 라우트가 완성 영상을 같은 경로에 덮어쓸 수 있어야 합니다(upsert).
-- 이게 없으면 저장이 한 번 실패한 생성은 다시 시도할 때마다 막힙니다.
create policy "본인 파일만 덮어쓴다"
  on storage.objects for update using (
    bucket_id = 'works'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

업로드 전 클라이언트에서 검증하세요. 4K 영상이 올라오면 관람이 불가능해집니다.

```ts
const MAX_MB = 30, MAX_SEC = 15;
// video.videoHeight <= 720, video.duration <= MAX_SEC, file.size <= MAX_MB * 1048576
```

서버에서 720p 트랜스코딩과 첫 프레임 추출(포스터)을 하는 단계를 두면
더 안전합니다. Supabase Edge Function + ffmpeg 조합이 흔한 선택입니다.

---

## 5. 삭제 흐름

```ts
async function deleteGallery(handle: string) {
  // 1) 스토리지 파일 먼저 (DB가 지워지면 경로를 못 찾습니다)
  const { data: works } = await supabase
    .from('works').select('media_url, poster_url')
    .eq('gallery_id', galleryId);

  const paths = works.flatMap(w =>
    [w.media_url, w.poster_url].filter(Boolean).map(toStoragePath));
  if (paths.length) await supabase.storage.from('works').remove(paths);

  // 2) 전시장 삭제 → works, guestbook 은 cascade
  const { error } = await supabase.from('galleries').delete().eq('handle', handle);
  if (error) throw error;   // 권한이 없으면 RLS가 여기서 막습니다
}
```

권한이 없는 사용자가 이 함수를 직접 호출해도 `error` 가 돌아옵니다.
화면에서 버튼을 숨기는 것은 편의이고, 실제 차단은 이 지점입니다.

---

## 6. 프로토타입에서 바꿔야 하는 부분

| 프로토타입 | 실제 |
|---|---|
| `session.email` 을 목업 코드로 설정 | `supabase.auth.getUser()` |
| `ADMIN_EMAILS` 배열 | `profiles.is_admin` |
| `canManage()` 로 삭제 차단 | RLS 정책 (`canManage()` 는 UI 표시용으로 남김) |
| `URL.createObjectURL` | Supabase Storage 업로드 후 공개 URL |
| `GALLERIES` 배열 | `galleries` 테이블 조회 |
| 해시 라우팅 `#/g/handle` | Next.js `/g/[handle]` |

`canManage()` 를 지우지 마세요. 서버가 막아주더라도, 권한 없는 사람에게
삭제 버튼을 보여준 뒤 에러를 띄우는 것은 나쁜 경험입니다.
서버는 차단을, 클라이언트는 안내를 담당합니다.
