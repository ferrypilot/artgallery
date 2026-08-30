// app/api/students/route.ts
//
// 학생 계정 관리. 전부 관리자만.
//
//   GET                        명단
//   POST  { emails: [...] }    계정 만들기 → 초기 비밀번호를 한 번 보여줍니다
//   PATCH { id, approved }     사용 / 중지
//   PUT   { id }               비밀번호 초기화 → 언제나 같은 값(RESET_PASSWORD)
//
// 메일을 전혀 쓰지 않습니다. Supabase 기본 메일은 조직 팀원이 아닌 주소로는
// 발송을 거부하므로 학생에게는 어차피 닿지 않습니다. 대신 선생님이 명단으로
// 계정을 만들고, 초기 비밀번호를 그 자리에서 알려주는 방식입니다.
//
// 만들 때 email_confirm 을 켜서 확인을 마친 상태로 둡니다. 그래서 대시보드의
// "Confirm email" 설정과 무관하게 학생이 바로 로그인할 수 있습니다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";

/** @ 없이 아이디만 적었을 때 붙일 도메인. 메일을 보내지 않으니 아무 값이나
 *  괜찮습니다 — 학생 개인 주소를 모으지 않아도 된다는 뜻이기도 합니다. */
const CLASS_DOMAIN = "class.local";
const MAX_AT_ONCE = 60;

/**
 * 비밀번호를 초기화하면 언제나 이 값이 됩니다.
 *
 * 수업 중에 선생님이 30명에게 무작위 문자열을 불러주는 것이 실제로는
 * 되지 않아서, 외우기 쉬운 하나로 고정했습니다.
 *
 * **6자입니다. 5자로 줄이지 마세요.** Supabase 는 비밀번호를 바꿀 때
 * 최소 6자를 강제합니다(weak_password · reasons:["length"]). 계정을
 * 처음 만드는 경로에는 그 검사가 없어서 5자도 들어가지만, 초기화는
 * 422 로 거절당합니다. 실제로 확인한 값입니다.
 *
 * 대신 이것은 **누구나 아는 값**입니다. 초기화된 계정은 그 학생이
 * 비밀번호를 바꾸기 전까지 반 전체가 들어갈 수 있다고 보아야 합니다.
 * 남의 전시장을 지우거나(RLS 는 "주인"만 보지 "본인"인지는 못 봅니다)
 * 남의 생성 한도를 쓰는 일이 가능합니다 — 한 편에 실제 요금이 붙습니다.
 * 그래서 초기화는 필요한 계정에만, 그 자리에서 쓰도록 두는 편이 좋습니다.
 *
 * 계정을 처음 만들 때(POST)는 여전히 하나씩 다른 값을 냅니다. 그쪽은
 * 화면에 표가 한 번에 나오므로 받아 적는 수고가 같고, 학기 내내 전원이
 * 같은 비밀번호로 남는 것은 다른 문제이기 때문입니다.
 */
const RESET_PASSWORD = "123456";

export async function GET() {
  const guard = await admin();
  if ("res" in guard) return guard.res;

  /* RLS 가 아니라 service_role 로 읽습니다.
     선생님은 profiles 에 대한 읽기 정책이 없습니다 — 정책을 넓히면
     역할을 데이터베이스에도 적어야 하고, 그러면 SQL 을 돌려야만 쓸 수
     있게 됩니다. 이 파일의 다른 세 가지(만들기·승인·초기화)가 이미
     같은 방식이고, 위 admin() 이 부르는 사람을 이미 확인했습니다. */
  const svc = service();
  if (!svc) return json({ error: NEED_KEY }, 503);

  const { data, error } = await svc
    .from("profiles")
    .select("id, email, display_name, approved, is_admin, created_at")
    .order("created_at", { ascending: false });

  if (error) return json({ error: error.message }, 500);

  return json({
    canManage: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    classDomain: CLASS_DOMAIN,
    // 선생님 화면은 관리자를 손대지 못합니다. 버튼부터 내려 둡니다.
    viewerIsAdmin: guard.v.isAdmin,
    students: (data ?? []).map((p: any) => ({
      id: p.id,
      email: p.email ?? "",
      name: p.display_name ?? "",
      approved: p.approved === true || p.is_admin === true,
      isAdmin: p.is_admin === true,
      joinedAt: p.created_at,
    })),
  });
}

/** 계정 만들기. 여러 명을 한 번에 받습니다 — 반 명단을 붙여넣게. */
export async function POST(request: Request) {
  const guard = await admin();
  if ("res" in guard) return guard.res;

  const svc = service();
  if (!svc) return json({ error: NEED_KEY }, 503);

  const body = await request.json().catch(() => null);
  const raw = Array.isArray(body?.emails) ? body.emails : [];
  if (!raw.length) return json({ error: "등록할 주소가 없습니다" }, 400);
  if (raw.length > MAX_AT_ONCE) {
    return json({ error: `한 번에 ${MAX_AT_ONCE}명까지입니다` }, 400);
  }

  const created: { email: string; password: string }[] = [];
  const failed: { email: string; reason: string }[] = [];

  for (const one of raw) {
    const email = normalize(String(one ?? ""));
    if (!email) { failed.push({ email: String(one), reason: "주소 형식이 아닙니다" }); continue; }

    const password = newPassword();
    // email_confirm: 확인을 마친 상태로 만듭니다. 확인 메일이 나가지 않고
    // 학생이 바로 로그인할 수 있습니다.
    const { data, error } = await svc.auth.admin.createUser({
      email, password, email_confirm: true,
    });

    if (error) {
      failed.push({ email, reason: translate(error.message) });
      continue;
    }

    // 선생님이 직접 등록한 계정이니 승인 단계를 따로 두지 않습니다.
    // 트리거가 만든 프로필의 approved 를 켭니다.
    if (data.user) {
      await svc.from("profiles").update({ approved: true }).eq("id", data.user.id);
    }
    created.push({ email, password });
  }

  // 비밀번호는 이 응답에만 있습니다. 어디에도 저장하지 않습니다 —
  // 저장하는 순간 그게 평문 비밀번호 목록이 됩니다.
  return json({ created, failed });
}

/** 사용 / 중지 */
export async function PATCH(request: Request) {
  const guard = await admin();
  if ("res" in guard) return guard.res;

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  const approved = body?.approved === true;
  if (!id) return json({ error: "대상이 없습니다" }, 400);
  if (id === guard.v.id && !approved) {
    return json({ error: "본인 계정은 중지할 수 없습니다" }, 400);
  }
  // 선생님은 관리자를 건드리지 못합니다. 관리자를 중지해 놓고 예산을
  // 아무도 못 바꾸게 만드는 길을 막습니다.
  if (!guard.v.isAdmin && await isAdminRow(id)) {
    return json({ error: "관리자 계정은 바꿀 수 없습니다" }, 403);
  }

  /* RLS 가 아니라 여기서 씁니다.
     profiles 에 update 를 열어주면 행 전체가 열립니다 — RLS 는 행 단위라
     "approved 만 고치게" 할 수가 없습니다. 그대로 두면 선생님이 자기 행의
     is_admin 을 켜서 예산까지 손댈 수 있습니다. 그래서 정책은 관리자에게만
     남겨두고, 승인/중지는 서버가 approved 한 칸만 바꿔 씁니다.
     위 admin() 이 이미 부르는 사람을 확인했습니다. */
  const svc = service();
  if (!svc) return json({ error: NEED_KEY }, 503);

  const { data, error } = await svc
    .from("profiles").update({ approved }).eq("id", id).select("id, is_admin");

  if (error) return json({ error: error.message }, 500);
  if (!data || !data.length) return json({ error: "그런 계정이 없습니다" }, 404);
  return json({ ok: true, id, approved });
}

/** 비밀번호 초기화 */
export async function PUT(request: Request) {
  const guard = await admin();
  if ("res" in guard) return guard.res;

  const svc = service();
  if (!svc) return json({ error: NEED_KEY }, 503);

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!id) return json({ error: "대상이 없습니다" }, 400);
  if (id === guard.v.id) {
    return json({ error: "본인 비밀번호는 여기서 바꾸지 마세요" }, 400);
  }
  // 초기화 값은 누구나 아는 값입니다. 선생님이 관리자 계정을 그 값으로
  // 되돌려 관리자로 들어가는 길을 막습니다.
  if (!guard.v.isAdmin && await isAdminRow(id)) {
    return json({ error: "관리자 계정은 바꿀 수 없습니다" }, 403);
  }

  const password = RESET_PASSWORD;
  const { error } = await svc.auth.admin.updateUserById(id, { password });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, password });
}

/* ---------- 안쪽 ---------- */

const NEED_KEY =
  "SUPABASE_SERVICE_ROLE_KEY 가 없습니다. .env.local 에 넣고 서버를 다시 시작하세요.";

/**
 * 학생 계정을 다룰 수 있는 사람인지 확인하고, 아니면 그대로 돌려줄 응답을 냅니다.
 *
 * 관리자와 선생님 둘 다 통과합니다. 둘의 차이는 이 파일이 아니라
 * settings 라우트에 있습니다 — 한도·화질·모델·길이는 관리자만 바꿉니다.
 * 그쪽이 곧 청구서라서 나눠 둔 것입니다.
 */
async function admin() {
  const v = await loadViewer();
  if (!v) return { res: json({ error: "로그인이 필요합니다" }, 401) };
  if (!v.isTeacher) {
    return { res: json({ error: "선생님·관리자만 할 수 있습니다" }, 403) };
  }
  return { v };
}

/** 그 계정이 관리자인가. 선생님이 관리자를 건드리려는지 보려고 씁니다. */
async function isAdminRow(id: string) {
  const svc = service();
  if (!svc) return false;
  const { data } = await svc
    .from("profiles").select("is_admin").eq("id", id).maybeSingle();
  return data?.is_admin === true;
}

/** service_role 클라이언트. RLS 를 통째로 무시하므로 관리자 확인 뒤에만
 *  만들고, 세션도 쿠키도 붙이지 않습니다. */
function service(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** "hong" → hong@class.local, " Hong@X.com " → hong@x.com */
function normalize(s: string) {
  const t = s.trim().toLowerCase().replace(/^[<"']+|[>"',;]+$/g, "");
  if (!t) return "";
  const full = t.includes("@") ? t : `${t}@${CLASS_DOMAIN}`;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(full) ? full : "";
}

function translate(m: string) {
  if (/already been registered|already exists/i.test(m)) return "이미 등록된 주소입니다";
  if (/invalid|unable to validate/i.test(m)) return "주소를 받아들이지 못했습니다";
  return m;
}

/** 읽어주기 쉬운 임시 비밀번호. 헷갈리는 글자(0/O, 1/l)는 뺐습니다. */
function newPassword() {
  const A = "abcdefghijkmnpqrstuvwxyz";
  const N = "23456789";
  const pick = (s: string, n: number) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join("");
  return `${pick(A, 4)}-${pick(N, 4)}-${pick(A, 4)}`;
}
