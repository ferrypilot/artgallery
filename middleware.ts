// middleware.ts
//
// 요청마다 세션 쿠키를 갱신합니다. 이게 없으면 토큰이 만료됐을 때
// 로그인이 조용히 풀립니다.
//
// public/ 의 정적 HTML 도 통과시켜야 쿠키가 실려서, matcher 에서
// 정적 자산만 제외합니다.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_READY } from "@/lib/supabase";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  // .env.local 이 아직 없으면 아무것도 하지 않고 통과시킵니다.
  // 이 가드가 없으면 갈래 1(서버 없이 전시 열기)에서도 모든 요청이 500 입니다.
  if (!SUPABASE_READY) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => request.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove: (name: string, options: any) => {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  await supabase.auth.getUser();   // 갱신 트리거
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm)$).*)"],
};
