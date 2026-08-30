// app/auth/callback/route.ts
//
// 매직링크를 눌렀을 때 도착하는 곳. 코드를 세션으로 바꿉니다.
// Supabase 대시보드 → Authentication → URL Configuration 의
// Redirect URLs 에 http://localhost:3000/auth/callback 을 넣어두세요.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/?auth=failed`);
}
