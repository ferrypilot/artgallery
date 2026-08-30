-- Art Gallery — 데이터베이스 한 벌
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 한 번 실행하세요.
-- supabase-auth.md 와 studio-setup.md 의 조각들을 의존 순서대로 모은 것입니다.
-- 순서가 중요합니다. 함수가 없으면 정책 생성이 실패합니다.
--
-- 여러 번 실행해도 안전하도록 if not exists / or replace 로 적었습니다.

-- ════════════════════════════════════════════════════════
--  1. 테이블
-- ════════════════════════════════════════════════════════

create table if not exists profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null,
  avatar_type  text not null default 'neutral'
    check (avatar_type in ('male','female','neutral')),
  is_admin     boolean not null default false,
  created_at   timestamptz default now()
);

create table if not exists galleries (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users on delete cascade,
  handle     text unique not null check (handle ~ '^[a-z0-9-]{2,20}$'),
  title      text not null,
  statement  text,
  theme      jsonb not null default '{"wall":"#131318","floor":"#0a0a0c"}',
  is_public  boolean not null default true,
  created_at timestamptz default now()
);

-- 사용 여부. 선생님이 관리자 화면에서 켜고 끕니다.
--
-- 계정은 선생님이 만들고(만들 때 켜짐), 문제가 생기면 끕니다. 끈 계정도
-- 로그인 자체는 성공합니다 — Supabase 가 세션을 내주니까요. 그래서 화면에서
-- 막는 것으로는 부족하고, 아래 정책이 실제 차단선입니다.
--
-- 기본값이 false 인 것은 안전한 쪽으로 틀린 것입니다. 혹시 다른 경로로
-- 계정이 생겨도 아무것도 만들지 못합니다.
alter table profiles add column if not exists approved boolean not null default false;

-- 선생님(학생 계정만 관리)은 여기에 컬럼을 두지 않습니다.
-- auth.users 의 app_metadata 에 {"role":"teacher"} 로 있습니다 — README 6-1.
-- 컬럼을 만들지 않은 이유는 이 파일을 돌리지 않아도 역할을 줄 수 있어야
-- 하기 때문이고, app_metadata 는 service_role 만 쓸 수 있어 학생이 스스로
-- 선생님이 되는 길도 없습니다.
-- 학생 명단 조회·승인·초기화는 전부 서버가 service_role 로 하므로
-- 정책을 넓힐 필요도 없습니다 — app/api/students/route.ts

-- 관리자 화면이 명단을 보여주려면 이메일이 필요합니다. auth.users 는
-- RLS 로 읽을 수 없으므로 계정을 만들 때 여기에 같이 적어둡니다.
alter table profiles add column if not exists email text;

-- 이미 가입한 사람들 채워넣기 (여러 번 실행해도 안전)
update profiles p set email = u.email
  from auth.users u where u.id = p.id and p.email is null;

-- 관리자는 스스로 승인돼 있어야 합니다. 안 그러면 선생님도 아무것도 못 만듭니다.
update profiles set approved = true where is_admin and not approved;

-- 전시장 카드에 띄울 학생 이름. profiles 를 조인하지 않으려고 여기 둡니다.
-- profiles 는 RLS 로 본인 행만 읽히는데, 로비는 로그인 없이도 보여야 해서
-- 남의 이름을 읽을 방법이 없습니다. 이름은 어차피 공개용입니다.
alter table galleries add column if not exists owner_name text;

create table if not exists works (
  id         uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references galleries on delete cascade,
  slot       int  not null check (slot between 0 and 19),
  title      text not null,
  note       text,
  kind       text not null check (kind in ('image','video')),
  media_url  text not null,
  poster_url text,
  created_at timestamptz default now(),
  unique (gallery_id, slot)          -- 한 자리에 한 점
);

-- 걸린 작품의 크기. 학생이 [ ] 로 키우고 줄인 것이 지금까지 화면에만
-- 남았습니다. 1 이 기본이고 화면이 0.6~1.4 로 자릅니다 — 여기서는 손으로
-- 고친 값이 들어와도 방이 깨지지 않을 만큼만 넓게 잡습니다.
alter table works add column if not exists scale real not null default 1
  check (scale between 0.3 and 3);

-- 전시장에 놓은 가구. 배열 하나를 통째로 넣고 뺍니다 — 많아야 여덟 개라
-- 표를 따로 만들 만한 양이 아니고, /api/galleries 와 백업이 이 칸을 함께
-- 실어 나르면 오프라인 전시가 저절로 따라옵니다.
alter table galleries add column if not exists layout jsonb not null default '[]'::jsonb;

-- 전시관에 따라 자리가 스무 개까지 늘었습니다(큰 전시실). 예전에 만든
-- 데이터베이스는 0~9 로 묶여 있으므로 제약을 다시 겁니다. 위 create table
-- 은 이미 있는 표를 건드리지 않기 때문에 이 줄이 따로 필요합니다.
-- 어느 방이 몇 자리인지는 lib/rooms.ts 가 정하고, 여기서는 그중 가장 큰
-- 방까지만 허용합니다.
alter table works drop constraint if exists works_slot_check;
alter table works add  constraint works_slot_check check (slot between 0 and 19);

create table if not exists guestbook (
  id           uuid primary key default gen_random_uuid(),
  gallery_id   uuid not null references galleries on delete cascade,
  visitor_name text not null,
  avatar_type  text not null default 'neutral',
  message      text not null check (char_length(message) <= 80),
  created_at   timestamptz default now()
);

create table if not exists generations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  gallery_id uuid references galleries on delete set null,
  request_id text,
  status     text not null default 'running',   -- running | done | failed | expired
  prompt     text,        -- 실제로 xAI 에 보낸 영문 프롬프트
  prompt_ko  text,        -- 학생이 쓴 한국어 원문
  model      text,
  duration   int,
  resolution text,
  source_url text,        -- 원본 이미지 (xAI 에 넘긴 공개 URL)
  media_url  text,        -- 완성된 영상 (우리 Storage)
  cost_usd   numeric,
  error      text,
  created_at timestamptz default now()
);

create index if not exists generations_user_created_idx
  on generations (user_id, created_at desc);

-- 전체 기본값. 한 줄만 씁니다.
-- quota 10 은 Supabase 무료 저장 1GB 에 맞춘 값입니다.
-- 30명 × 10편 ≈ 300MB. 올리려면 스튜디오의 관리자 설정에서 바꾸세요.
create table if not exists app_settings (
  id          int primary key default 1,
  quota       int    not null default 10,
  resolutions text[] not null default '{480p}',
  models      text[] not null default '{grok-imagine-video}',
  -- on delete set null 이 없으면, 설정을 한 번이라도 저장한 계정을 지울 때
  -- 대시보드와 관리자 화면 양쪽에서 삭제가 실패합니다
  -- ("violates foreign key constraint app_settings_updated_by_fkey").
  -- 누가 마지막으로 고쳤는지는 참고 정보일 뿐이라, 사람이 지워지면
  -- 비워두는 것이 맞습니다.
  updated_by  uuid references auth.users on delete set null,
  updated_at  timestamptz default now(),
  constraint one_row check (id = 1)
);
insert into app_settings (id) values (1) on conflict do nothing;

-- 이미 만들어진 데이터베이스의 제약을 고칩니다. create table 의 변경은
-- 이미 있는 테이블에는 반영되지 않기 때문에, 여기서 걸어 다시 겁니다.
alter table app_settings drop constraint if exists app_settings_updated_by_fkey;
alter table app_settings add constraint app_settings_updated_by_fkey
  foreign key (updated_by) references auth.users on delete set null;

-- 학생이 만들 수 있는 최대 길이(초). 관리자만 넘습니다.
-- 비용이 초당으로 붙기 때문에, 길이가 사실상 예산 손잡이입니다.
alter table app_settings add column if not exists max_duration int not null default 5;

-- 학생별 예외 한도. 있으면 기본값을 이깁니다.
create table if not exists user_limits (
  email text primary key,
  quota int not null default 10
);

-- 이미 app_settings 행이 만들어진 뒤라면 default 를 바꿔도 반영되지 않습니다.
-- 기존 행의 값을 실제로 낮춥니다.
update app_settings set quota = 10 where id = 1 and quota = 30;

-- ════════════════════════════════════════════════════════
--  2. 함수 — 정책보다 먼저 있어야 합니다
-- ════════════════════════════════════════════════════════

-- security definer 라서 profiles 의 RLS 를 타지 않습니다.
-- 이게 아니면 정책이 자기 자신을 다시 부르며 무한 재귀합니다.
--
-- set search_path = '' 과 public. 접두사가 한 쌍입니다.
-- security definer 함수는 부르는 쪽의 search_path 를 물려받는데, 그대로 두면
-- (1) 인증 서비스처럼 public 이 경로에 없는 문맥에서 테이블을 못 찾고
-- (2) 같은 이름의 테이블을 앞에 놓아 함수를 속이는 수법에 열립니다.
-- 경로를 비우고 전부 스키마까지 적는 것이 정석입니다.

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function owns_gallery(g uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.galleries where id = g and owner_id = auth.uid());
$$;

-- 쓸 수 있는 계정인가. 관리자는 항상 통과합니다.
create or replace function is_approved()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select approved or is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ════════════════════════════════════════════════════════
--  3. RLS — 여기가 실제 방어선
-- ════════════════════════════════════════════════════════

alter table profiles     enable row level security;
alter table galleries    enable row level security;
alter table works        enable row level security;
alter table guestbook    enable row level security;
alter table generations  enable row level security;
alter table app_settings enable row level security;
alter table user_limits  enable row level security;

-- ── profiles ────────────────────────────────────────────
-- RLS 는 정책이 없으면 전부 거부입니다. 이 정책이 없으면 서버가
-- is_admin 을 읽지 못해서 관리자가 영영 관리자로 인식되지 않습니다.
drop policy if exists "본인 프로필을 본다" on profiles;
create policy "본인 프로필을 본다"
  on profiles for select using (id = auth.uid() or is_admin());

-- 승인 처리는 관리자만. 학생은 자기 행조차 못 고칩니다.
--
-- 관리자가 실수로(또는 악의로) is_admin 을 퍼뜨리는 것까지는 막지 않지만,
-- 학생이 스스로 관리자가 되는 길은 없습니다. 관리자 지정은 아래 6번처럼
-- 대시보드에서만 하세요.
drop policy if exists "관리자만 프로필을 고친다" on profiles;
create policy "관리자만 프로필을 고친다"
  on profiles for update using (is_admin()) with check (is_admin());

-- 선생님에게는 update 를 열지 않습니다. RLS 는 행 단위라 "approved 만
-- 고치게" 할 수가 없고, 열어주면 선생님이 자기 행의 is_admin 을 켜서
-- 예산까지 손댈 수 있게 됩니다. 그래서 사용/중지는 화면이 아니라
-- 서버가 service_role 로 처리합니다 — app/api/students/route.ts 의 PATCH.
-- 명단 조회도 같은 이유로 서버가 합니다.
--
-- 학생 본인의 update 정책은 일부러 두지 않습니다. 이름 수정 화면을 만들
-- 때가 되면, is_admin 과 approved 를 뺀 컬럼만 고치는 security definer
-- 함수를 따로 두세요. 컬럼 단위 제한은 RLS 로는 표현할 수 없습니다.

-- ── galleries ───────────────────────────────────────────
drop policy if exists "누구나 공개 전시장을 본다" on galleries;
create policy "누구나 공개 전시장을 본다"
  on galleries for select using (is_public or owner_id = auth.uid() or is_admin());

-- 승인된 사람만 만듭니다. 이 조건이 승인제의 실제 차단선입니다.
drop policy if exists "로그인한 사람은 자기 전시장을 만든다" on galleries;
drop policy if exists "승인된 사람은 자기 전시장을 만든다" on galleries;
create policy "승인된 사람은 자기 전시장을 만든다"
  on galleries for insert with check (owner_id = auth.uid() and is_approved());

drop policy if exists "주인과 관리자만 수정한다" on galleries;
create policy "주인과 관리자만 수정한다"
  on galleries for update using (owner_id = auth.uid() or is_admin());

drop policy if exists "주인과 관리자만 삭제한다" on galleries;
create policy "주인과 관리자만 삭제한다"
  on galleries for delete using (owner_id = auth.uid() or is_admin());

-- ── works ───────────────────────────────────────────────
drop policy if exists "공개 전시장의 작품은 누구나 본다" on works;
create policy "공개 전시장의 작품은 누구나 본다"
  on works for select using (
    exists (select 1 from galleries g where g.id = gallery_id and g.is_public)
    or owns_gallery(gallery_id) or is_admin()
  );

drop policy if exists "주인과 관리자만 작품을 건다" on works;
create policy "주인과 관리자만 작품을 건다"
  on works for insert with check ((owns_gallery(gallery_id) and is_approved()) or is_admin());

drop policy if exists "주인과 관리자만 작품을 바꾼다" on works;
create policy "주인과 관리자만 작품을 바꾼다"
  on works for update using (owns_gallery(gallery_id) or is_admin());

drop policy if exists "주인과 관리자만 작품을 내린다" on works;
create policy "주인과 관리자만 작품을 내린다"
  on works for delete using (owns_gallery(gallery_id) or is_admin());

-- ── guestbook ───────────────────────────────────────────
drop policy if exists "방명록은 누구나 읽는다" on guestbook;
create policy "방명록은 누구나 읽는다"
  on guestbook for select using (true);

drop policy if exists "방명록은 누구나 남긴다" on guestbook;
create policy "방명록은 누구나 남긴다"        -- 로그인 없이도
  on guestbook for insert with check (true);

drop policy if exists "전시장 주인과 관리자만 지운다" on guestbook;
create policy "전시장 주인과 관리자만 지운다"
  on guestbook for delete using (owns_gallery(gallery_id) or is_admin());

-- ── generations ─────────────────────────────────────────
drop policy if exists "본인 것만 본다" on generations;
create policy "본인 것만 본다"
  on generations for select using (user_id = auth.uid() or is_admin());

drop policy if exists "본인 것만 만든다" on generations;
create policy "본인 것만 만든다"
  on generations for insert with check (user_id = auth.uid() and is_approved());

drop policy if exists "본인 것만 고친다" on generations;
create policy "본인 것만 고친다"
  on generations for update using (user_id = auth.uid());

-- ── app_settings · user_limits ──────────────────────────
-- 읽기는 로그인한 사람 누구나. 학생 화면이 자기 한도를 알아야 합니다.
drop policy if exists "read settings" on app_settings;
create policy "read settings" on app_settings
  for select using (auth.uid() is not null);

drop policy if exists "read limits" on user_limits;
create policy "read limits" on user_limits
  for select using (auth.uid() is not null);

drop policy if exists "admin writes settings" on app_settings;
create policy "admin writes settings" on app_settings
  for all using (is_admin()) with check (is_admin());

drop policy if exists "admin writes limits" on user_limits;
create policy "admin writes limits" on user_limits
  for all using (is_admin()) with check (is_admin());

-- ════════════════════════════════════════════════════════
--  4. 가입 직후 프로필 자동 생성
-- ════════════════════════════════════════════════════════

-- 이 트리거가 실패하면 가입 자체가 롤백되고 화면에는
-- "Database error saving new user" 만 뜹니다. 그래서 여기는 특히
-- search_path 를 비우고 테이블을 public. 까지 적어야 합니다.
-- 인증 서비스 문맥에는 public 이 검색 경로에 없을 수 있습니다.
-- approved 는 기본 false 로 시작하고, 선생님이 관리자 화면에서 계정을
-- 만들 때 서버가 켭니다. 다른 경로로 계정이 생기면 꺼진 채로 남습니다.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, split_part(new.email, '@', 1), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ════════════════════════════════════════════════════════
--  5. 스토리지
--  public 이어야 합니다. xAI 가 원본 이미지를 직접 내려받습니다.
-- ════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('works', 'works', true)
on conflict (id) do update set public = true;

drop policy if exists "본인 폴더에만 올린다" on storage.objects;
create policy "본인 폴더에만 올린다"
  on storage.objects for insert with check (
    bucket_id = 'works'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 목록은 본인 것만 보입니다.
--
-- 예전 정책은 `using (bucket_id = 'works')` 였습니다. 그게 있으면 로그인
-- 하지 않은 사람도 storage 의 list 를 불러 폴더(=사용자 id)와 파일 이름을
-- 전부 훑을 수 있습니다. 주소만 알면 재생되니, 사실상 반 전체의 영상이
-- 누구에게나 열려 있던 셈입니다.
--
-- 이 정책을 좁혀도 전시장은 그대로 돕니다. 버킷이 public 이면
-- /object/public/... 로 읽는 것은 RLS 를 타지 않기 때문입니다.
-- (정책이 하나도 없는 공개 버킷으로 확인했습니다 — 읽기 200, 목록 빈 배열.)
-- 걸어둔 작품의 주소는 어차피 전시장이 내주는 값이라 공개가 맞고,
-- 아직 걸지 않은 영상은 주소를 아는 사람만 볼 수 있습니다.
drop policy if exists "작품 파일은 누구나 본다" on storage.objects;
drop policy if exists "본인 파일만 목록에 보인다" on storage.objects;
create policy "본인 파일만 목록에 보인다"
  on storage.objects for select using (
    bucket_id = 'works'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

-- 폴링 라우트가 완성 영상을 같은 경로에 덮어쓸 수 있어야 합니다(upsert).
drop policy if exists "본인 파일만 덮어쓴다" on storage.objects;
create policy "본인 파일만 덮어쓴다"
  on storage.objects for update using (
    bucket_id = 'works'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "본인 파일만 지운다" on storage.objects;
create policy "본인 파일만 지운다"
  on storage.objects for delete using (
    bucket_id = 'works'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_admin())
  );

-- ════════════════════════════════════════════════════════
--  6. 본인을 관리자로 — 한 번 로그인해서 계정을 만든 뒤에 실행하세요
-- ════════════════════════════════════════════════════════

-- update profiles set is_admin = true
-- where id = (select id from auth.users where email = 'joonall@naver.com');

-- 선생님(학생 계정만)은 이 파일이 아니라 auth 쪽에서 지정합니다.
-- 대시보드 → Authentication → 사용자 → App Metadata 에
--   {"role": "teacher"}
-- 를 넣으면 됩니다. README 6-1 을 보세요.
-- 승인만 여기서 켜 둡니다.
update profiles set approved = true
where email = 'kangsong0217@gmail.com';
