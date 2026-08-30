// lib/supabase-browser.ts
//
// 브라우저 전용 클라이언트.
//
// lib/supabase.ts 와 나눠 둔 이유가 있습니다. 저쪽은 최상단에서
// next/headers 를 import 하는데 그건 서버 전용이라, "use client" 컴포넌트가
// 저 파일에서 무엇이든 가져오면 빌드가 깨집니다. 한 파일에 두면
// 언젠가 반드시 밟는 지뢰라 아예 분리했습니다.

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** .env.local 이 아직 없으면 false. 화면에서 안내를 띄우는 데 씁니다. */
export const SUPABASE_READY = !!(url && key);

/** 설정이 없으면 null 을 돌려줍니다. 여기서 던지면 화면이 통째로 하얘집니다. */
export function supabaseBrowser() {
  if (!SUPABASE_READY) return null;
  return createBrowserClient(url!, key!);
}
