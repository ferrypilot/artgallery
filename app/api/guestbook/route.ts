// app/api/guestbook/route.ts
//
// 전시장 벽에 걸린 방명록.
//
//   POST { handle, name, body, message }   한 줄 남기기
//
// 로그인하지 않아도 남길 수 있습니다. 관람은 누구나이고, 관람한 사람이
// 한마디 남기는 것까지가 관람입니다 — RLS 의 "방명록은 누구나 남긴다" 가
// 그렇게 열려 있습니다. 대신 지우는 것은 전시장 주인과 관리자만 할 수
// 있습니다(아직 화면에 그 길은 없습니다).
//
// 지금까지는 남긴 글이 브라우저 메모리에만 있었습니다. 새로고침하면
// 사라졌는데, 학생 눈에는 글이 안 써진 게 아니라 지워진 것으로 보입니다.

import { supabaseServer } from "@/lib/supabase";
import { json } from "@/lib/imagine";

const HANDLE = /^[a-z0-9-]{2,20}$/;
// 벽에 걸리는 판이라 길면 잘립니다. DB 의 check 도 80 자입니다.
const MAX_MSG = 80;
const MAX_NAME = 12;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const handle = String(body.handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const name = String(body.name ?? "").trim().slice(0, MAX_NAME);
  if (!name) return json({ error: "이름을 먼저 정해주세요" }, 400);

  const message = String(body.message ?? "").trim().slice(0, MAX_MSG);
  if (!message) return json({ error: "한 줄 적어주세요" }, 400);

  // 아바타 종류는 남/여뿐입니다. 모르는 값이면 컬럼 기본값과 같은 것을 씁니다.
  const raw = String(body.body ?? "");
  const avatar = raw === "male" || raw === "female" ? raw : "neutral";

  const supabase = await supabaseServer();

  const { data: gallery } = await supabase
    .from("galleries").select("id").eq("handle", handle).maybeSingle();
  if (!gallery) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  const { data, error } = await supabase
    .from("guestbook")
    .insert({ gallery_id: gallery.id, visitor_name: name, avatar_type: avatar, message })
    .select("visitor_name, message")
    .single();

  if (error) return json({ error: error.message }, 500);

  // 화면이 쓰는 모양으로 돌려줍니다 — exhibition.json 과 같은 {name, msg} 입니다.
  return json({ entry: { name: data.visitor_name, msg: data.message } });
}
