// app/api/auth/signout/route.ts
//
// 로그아웃. 전시장 HTML 의 로그인 버튼이 부릅니다.
// 정적 HTML 이라 supabase-js 를 들이지 않고 이 라우트로 대신합니다.

import { supabaseServer, SUPABASE_READY } from "@/lib/supabase";
import { json } from "@/lib/imagine";

export async function POST() {
  if (!SUPABASE_READY) return json({ ok: true });
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return json({ ok: true });
}
