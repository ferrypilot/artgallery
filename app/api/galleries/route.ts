// app/api/galleries/route.ts
//
// 로비와 전시장이 읽는 목록. 로그인 없이도 열립니다 — 관람은 누구나.
//
// 응답을 exhibition.json 과 같은 모양으로 맞췄습니다. 전시장 HTML 이
// 이미 그 형식을 읽을 줄 알아서, 화면 쪽은 출처만 바꾸면 됩니다.

import { supabaseServer, SUPABASE_READY } from "@/lib/supabase";
import { json, loadViewer } from "@/lib/imagine";
import { ROOMS, isRoomName, type RoomName } from "@/lib/rooms";

const HANDLE = /^[a-z0-9-]{2,20}$/;

/**
 * 전시장 만들기.  POST { handle, title, name, theme }
 *
 * 스튜디오에서 첫 작품을 걸어도 전시장이 자동으로 생기지만, 이쪽은
 * 학생이 주소·제목·색을 직접 정하는 길입니다. 작품이 없어도 만들 수
 * 있어야 "빈 전시장을 먼저 꾸며두는" 방식이 가능합니다.
 *
 * 한 사람이 여러 개를 만들 수 있습니다. 막을 이유가 없고, 막으면
 * 반 전체 공동 전시장 같은 것을 못 만듭니다.
 */
export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  if (!v.approved) return json({ error: "사용이 중지된 계정입니다. 선생님께 문의하세요" }, 403);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const handle = String(body.handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) {
    return json({ error: "주소는 영문 소문자·숫자·하이픈 2~20자입니다" }, 400);
  }

  const title = String(body.title ?? "").trim().slice(0, 60);
  if (!title) return json({ error: "전시 제목을 적어주세요" }, 400);

  const name = String(body.name ?? "").trim().slice(0, 40) || v.email.split("@")[0];

  // 색은 화면이 보내는 {wall, floor} 만 받습니다. 아무 jsonb 나 그대로
  // 넣으면 전시장 코드가 읽지 못하는 값이 들어올 수 있습니다.
  const t = body.theme ?? {};
  const theme = (isColor(t.wall) && isColor(t.floor))
    ? { wall: t.wall, floor: t.floor }
    : { wall: "#131318", floor: "#0a0a0c" };

  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("galleries")
    .insert({ owner_id: v.id, handle, title, owner_name: name, theme })
    .select("handle, title")
    .single();

  if (error) {
    if (error.code === "23505") return json({ error: "이미 쓰이는 주소입니다" }, 409);
    return json({ error: error.message }, 500);
  }

  return json({ handle: data.handle, title: data.title });
}

/**
 * 전시장 꾸미기 저장.  PATCH { handle, theme: {wall, floor}, room? }
 *
 * 지금까지 벽·바닥 색은 화면에서만 바뀌고 새로고침하면 되돌아갔습니다.
 * 전시장을 꾸미는 일은 학생이 자기 전시를 갖는 느낌의 절반쯤 되는데,
 * 그게 남지 않으면 꾸밀 이유가 없습니다.
 *
 * 권한은 여기서 따로 세지 않습니다. RLS 의 "주인과 관리자만 수정한다" 가
 * 실제 차단선이고, 막히면 오류가 아니라 0행 수정으로 옵니다 — 그것을
 * 403 으로 바꿔 보냅니다. 조용한 실패를 남기지 않으려는 것입니다.
 */
export async function PATCH(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const handle = String(body.handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const t = body.theme ?? {};
  if (!isColor(t.wall) || !isColor(t.floor)) {
    return json({ error: "색은 #rrggbb 여섯 자리로 보내주세요" }, 400);
  }

  // 전시관은 보내지 않으면 그대로 둡니다. 색만 저장하는 쪽이 훨씬 잦습니다.
  let room: RoomName | null = null;
  if (body.room !== undefined) {
    if (!isRoomName(body.room)) return json({ error: "그런 전시관은 없습니다" }, 400);
    room = body.room;
  }

  const supabase = await supabaseServer();

  // 색만 덮어씁니다. theme 를 통째로 새로 넣으면 같은 칸에 들어 있는
  // 대표 이미지(cover)가 함께 지워집니다 — 학생이 색을 저장할 때마다
  // 골라둔 카드 그림이 조용히 사라지는 셈이었습니다.
  const { data: g } = await supabase
    .from("galleries").select("id, theme").eq("handle", handle).maybeSingle();
  if (!g) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  /* 자리가 적은 전시관으로 옮기면 뒤쪽 자리의 작품은 걸릴 벽이 없습니다.
     조용히 사라지게 두면 학생은 작품을 잃은 줄 압니다. 무엇을 먼저
     내려야 하는지 이름까지 적어 돌려보냅니다. */
  if (room) {
    const limit = ROOMS[room].slots.length;
    const { data: over } = await supabase
      .from("works").select("slot, title")
      .eq("gallery_id", g.id).gte("slot", limit).order("slot");

    if (over && over.length) {
      const list = over.map((w: any) => `${w.slot + 1}번 「${w.title}」`).join(", ");
      return json({
        error: `${ROOMS[room].name}은 자리가 ${limit}개입니다. ` +
               `${over.length}점을 먼저 내려주세요 — ${list}`,
      }, 409);
    }
  }

  const theme: Record<string, unknown> = {
    ...(g.theme as object), wall: t.wall, floor: t.floor,
  };
  if (room) theme.room = room;

  const { data, error } = await supabase
    .from("galleries")
    .update({ theme })
    .eq("handle", handle)
    .select("handle, theme");

  if (error) return json({ error: error.message }, 500);
  if (!data || !data.length) {
    return json({ error: "고칠 권한이 없거나 없는 전시장입니다" }, 403);
  }
  return json({ ok: true, handle, theme: data[0].theme });
}

/**
 * 전시장 삭제.  DELETE /api/galleries?handle=<주소>
 *
 * works 와 guestbook 은 on delete cascade 로 함께 사라집니다.
 *
 * 영상 파일은 지우지 않습니다. generations 이 계속 가리키고 있어서
 * 비용 집계가 맞아야 하고, 학생이 같은 영상을 새 전시장에 다시 걸 수
 * 있어야 합니다. 파일 정리는 학기가 끝난 뒤 따로 하세요.
 */
export async function DELETE(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const handle = new URL(request.url).searchParams.get("handle") ?? "";
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("galleries").delete().eq("handle", handle).select("handle");

  if (error) return json({ error: error.message }, 500);
  // RLS 가 막으면 오류가 아니라 0행 삭제로 옵니다. 조용한 실패를 막습니다.
  if (!data || !data.length) {
    return json({ error: "지울 권한이 없거나 이미 없는 전시장입니다" }, 403);
  }
  return json({ ok: true, handle });
}

function isColor(s: unknown) {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

/* 방명록은 오래된 것부터 늘어놓습니다 — 벽에 걸린 판이 뒤에서 다섯 개를
   잘라 쓰기 때문입니다. 한 전시장에 50개까지만 실어 보냅니다. 그 위로는
   화면에 닿지도 않는데 목록만 무거워집니다. */
const GUESTBOOK_MAX = 50;
function recentGuestbook(rows: any) {
  if (!Array.isArray(rows)) return [];
  return rows
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(-GUESTBOOK_MAX)
    // id 를 함께 보냅니다. 주인과 선생님이 한 줄만 골라 지우려면 필요합니다.
    .map((e) => ({ id: e.id, name: e.visitor_name, msg: e.message }));
}

export async function GET() {
  if (!SUPABASE_READY) {
    return json({ error: "Supabase 가 설정되지 않았습니다" }, 503);
  }

  const supabase = await supabaseServer();

  // 로그인하지 않았어도 됩니다. 관람은 누구나 — 그때 user 는 null 입니다.
  const { data: { user } } = await supabase.auth.getUser();

  // 공개 전시장만 보이는 것은 RLS 가 정합니다. 여기서 거르지 않습니다.
  const { data, error } = await supabase
    .from("galleries")
    .select("handle, title, owner_name, theme, layout, owner_id, " +
            "works(slot, title, note, kind, media_url), " +
            "guestbook(id, visitor_name, message, created_at)")
    .order("created_at");

  if (error) return json({ error: error.message }, 500);

  const galleries = (data ?? []).map((g: any) => ({
    handle: g.handle,
    name: g.owner_name || g.handle,
    title: g.title,
    theme: g.theme,
    layout: Array.isArray(g.layout) ? g.layout : [],
    guestbook: recentGuestbook(g.guestbook),
    // 남의 이메일은 내려보내지 않습니다. 화면에는 "내 것인지"만 있으면 됩니다.
    mine: !!user && g.owner_id === user.id,
    works: (g.works ?? [])
      .sort((a: any, b: any) => a.slot - b.slot)
      .map((w: any) => ({
        slot: w.slot,
        src: w.media_url,
        title: w.title,
        note: w.note,
        kind: w.kind,
      })),
  }));

  return json({ galleries });
}
