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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  /* 곁들이는 주소. 없어도 됩니다. http·https 만 받습니다 — javascript:
     같은 것을 그대로 두면 누른 사람 화면에서 코드가 돕니다. */
  let link: string | null = null;
  const rawLink = String(body.link ?? "").trim();
  if (rawLink) {
    let u: URL | null = null;
    try { u = new URL(/^https?:\/\//i.test(rawLink) ? rawLink : "https://" + rawLink); }
    catch { u = null; }
    const bad =
      !u ||
      (u.protocol !== "http:" && u.protocol !== "https:") ||
      // 점이 없으면 주소가 아닙니다. https:// 를 앞에 붙이면 아무 글자나
      // 호스트 이름이 되어 버리므로 이 한 줄이 필요합니다.
      !u.hostname.includes(".") ||
      /\s/.test(rawLink);
    if (bad || !u) {
      return json({ error: "주소가 올바르지 않습니다. 예: https://example.com/..." }, 400);
    }
    link = u.toString().slice(0, 300);
  }

  // 아바타 종류는 남/여뿐입니다. 모르는 값이면 컬럼 기본값과 같은 것을 씁니다.
  const raw = String(body.body ?? "");
  const avatar = raw === "male" || raw === "female" ? raw : "neutral";

  const supabase = await supabaseServer();

  const { data: gallery } = await supabase
    .from("galleries").select("id").eq("handle", handle).maybeSingle();
  if (!gallery) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  const { data, error } = await supabase
    .from("guestbook")
    .insert({ gallery_id: gallery.id, visitor_name: name, avatar_type: avatar, message, link })
    .select("id, visitor_name, message, link")
    .single();

  if (error) {
    // link 칸이 아직 없는 데이터베이스입니다. 무엇을 해야 할지 그대로 알려줍니다.
    if (/link/.test(error.message)) {
      return json({ error: "주소를 남기려면 supabase/schema.sql 을 다시 실행하세요" }, 500);
    }
    return json({ error: error.message }, 500);
  }

  // 화면이 쓰는 모양으로 돌려줍니다 — exhibition.json 과 같은 {name, msg} 입니다.
  return json({ entry: { id: data.id, name: data.visitor_name,
                         msg: data.message, link: data.link ?? null } });
}

/**
 * 한 줄 지우기.  DELETE /api/guestbook?id=<uuid>
 *
 * 부적절한 글이 올라왔을 때 전시장 주인과 선생님이 내립니다. 누가 지울 수
 * 있는지는 RLS 의 "전시장 주인과 관리자만 지운다" 가 정합니다 — 여기서
 * 세지 않고, 막히면 0행 삭제로 오는 것을 403 으로 바꿉니다.
 */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return json({ error: "글 번호가 올바르지 않습니다" }, 400);

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("guestbook").delete().eq("id", id).select("id");

  if (error) return json({ error: error.message }, 500);
  if (!data || !data.length) {
    return json({ error: "지울 권한이 없거나 이미 없는 글입니다" }, 403);
  }
  return json({ ok: true, id });
}
