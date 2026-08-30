// lib/supabase.ts
//
// 서버·브라우저용 Supabase 클라이언트.
// API 라우트들이 각자 만들던 것을 여기로 모았습니다.

// ⚠ 이 파일은 next/headers 를 import 합니다. 서버 전용입니다.
//   "use client" 컴포넌트에서는 lib/supabase-browser.ts 를 쓰세요.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** .env.local 이 아직 없어도 서버가 뜨게 하려고 둔 표시입니다.
 *
 *  갈래 1(서버 없이 전시 열기)은 Supabase 가 아예 필요 없습니다. 이 값이
 *  false 면 미들웨어와 로그인 검사가 통째로 비켜서고, public/ 의 전시장은
 *  그대로 열립니다. — OFFLINE.md */
export const SUPABASE_READY = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/** 서버 컴포넌트 · 라우트 핸들러용
 *
 *  Next 15 부터 cookies() 가 Promise 를 돌려줍니다. Next 14 에서는 그냥 객체라
 *  await 이 통과하므로, 이렇게 두면 두 버전에서 다 돕니다.
 *  부르는 쪽에서 await 을 빠뜨리지 마세요. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => store.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          try { store.set({ name, value, ...options }); } catch { /* RSC 에서는 무시 */ }
        },
        remove: (name: string, options: any) => {
          try { store.set({ name, value: "", ...options }); } catch { /* 위와 같음 */ }
        },
      },
    }
  );
}
