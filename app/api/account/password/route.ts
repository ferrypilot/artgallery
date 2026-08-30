// app/api/account/password/route.ts
//
// 본인이 자기 비밀번호를 바꿉니다. 학생도 선생님도 씁니다.
//
//   POST { current, next } → { ok: true }
//
// 왜 필요한가 — 선생님이 초기화한 비밀번호는 123456 입니다. 누구나 아는
// 값이라, 학생이 그걸 그대로 두면 반의 다른 사람이 그 계정으로 들어올 수
// 있습니다. 받은 즉시 자기 것으로 바꾸는 길이 있어야 초기화가 안전해집니다.
//
// 지금 비밀번호를 함께 받습니다. 교실 컴퓨터는 여러 명이 돌려 쓰고,
// 로그아웃하지 않고 자리를 뜨는 일이 흔합니다. 세션만 믿으면 지나가던
// 사람이 남의 비밀번호를 바꿔 잠가버릴 수 있습니다.

import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";

/** 선생님이 초기화할 때 쓰는 값. 이것으로는 다시 정하지 못하게 합니다. */
const RESET_PASSWORD = "123456";

/** Supabase 가 비밀번호 변경에 강제하는 최소 길이입니다. */
const MIN = 6;

export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const body = await request.json().catch(() => null);
  const current = String(body?.current ?? "");
  const next = String(body?.next ?? "");

  if (!current) return json({ error: "지금 비밀번호를 넣어주세요" }, 400);
  if (next.length < MIN) {
    return json({ error: `새 비밀번호는 ${MIN}자 이상이어야 합니다` }, 400);
  }
  if (next === current) {
    return json({ error: "지금 쓰는 것과 같습니다" }, 400);
  }
  if (next === RESET_PASSWORD) {
    return json({
      error: "그 값은 선생님이 초기화할 때 쓰는 값이라 누구나 압니다. 다른 것으로 정해주세요",
    }, 400);
  }

  // 지금 비밀번호가 맞는지 확인합니다. 세션을 건드리지 않으려고 쿠키를
  // 붙이지 않은 클라이언트로 따로 물어봅니다 — 여기서 로그인에 성공해도
  // 브라우저의 로그인 상태는 그대로입니다.
  const probe = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error: badPw } = await probe.auth.signInWithPassword({
    email: v.email, password: current,
  });
  if (badPw) {
    // 매직링크만 써 온 계정은 비밀번호가 없어서 여기서 걸립니다.
    // 그때는 선생님께 초기화를 받고 오면 됩니다.
    return json({
      error: "지금 비밀번호가 맞지 않습니다. 기억나지 않으면 선생님께 초기화를 요청하세요",
    }, 403);
  }
  /* signOut() 을 부르지 않습니다.
     기본값이 scope:"global" 이라 그 사람의 모든 세션을 끊습니다 — 확인만
     하려고 부른 것이 브라우저의 로그인까지 날려서, 바로 아래 updateUser 가
     "Auth session missing" 으로 실패합니다. 실제로 그렇게 당했습니다.
     persistSession:false 라 이 클라이언트는 아무것도 저장하지 않으므로
     그냥 두면 됩니다. */

  // 바꾸는 것은 본인 세션으로 합니다. service_role 을 쓰지 않는 이유는,
  // 그 키로는 아무 계정이나 바꿀 수 있어서 대상이 정말 본인인지를
  // 코드가 아니라 세션이 보증하게 두는 편이 안전하기 때문입니다.
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return json({ error: translate(error.message) }, 400);

  return json({ ok: true });
}

function translate(m: string) {
  if (/at least|weak/i.test(m)) return `새 비밀번호는 ${MIN}자 이상이어야 합니다`;
  if (/different from the old/i.test(m)) return "지금 쓰는 것과 같습니다";
  return m;
}
