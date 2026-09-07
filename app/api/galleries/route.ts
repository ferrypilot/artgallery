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
// 전시 제목과 학생 이름의 길이. 만들 때와 고칠 때가 같아야 합니다.
const MAX_TITLE = 100;
const MAX_NAME = 100;

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

  /* 이름과 제목은 100 자까지. 예전에는 20 자(제목)·12 자(이름)에서 잘렸는데,
     「3학년 2반 김서연의 여름 그림 전시」 같은 제목이 그대로 잘려 나갔습니다.
     칸은 galleries.title·owner_name 둘 다 text 라 길이 제한이 없습니다. */
  const title = String(body.title ?? "").trim().slice(0, MAX_TITLE);
  if (!title) return json({ error: "전시 제목을 적어주세요" }, 400);

  const name = String(body.name ?? "").trim().slice(0, MAX_NAME) || v.email.split("@")[0];

  // 색은 화면이 보내는 {wall, floor} 만 받습니다. 아무 jsonb 나 그대로
  // 넣으면 전시장 코드가 읽지 못하는 값이 들어올 수 있습니다.
  const t = body.theme ?? {};
  const theme: Record<string, unknown> = (isColor(t.wall) && isColor(t.floor))
    ? { wall: t.wall, floor: t.floor }
    : { wall: "#131318", floor: "#0a0a0c" };

  /* 어느 전시실에 지을지. 만들기 창에서 고릅니다 — 작품을 건 뒤에 옮기면
     자리가 모자라 도로 내려야 하는 일이 생겨서, 처음에 정하는 편이
     낫습니다. 보내지 않거나 모르는 이름이면 기본 전시실입니다. */
  if (isRoomName(body.room)) theme.room = body.room;

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
 * 전시장 꾸미기 저장.
 *   PATCH { handle, theme?: {wall, floor}, room?, title?, name?, plan? }
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

  /* 색은 보낼 때만 고칩니다. 예전에는 늘 있어야 했는데, 그러면 이름만
     고치러 온 화면도 색을 함께 실어 보내야 했습니다 — 고칠 뜻이 없는
     것까지 덮어쓰게 됩니다. */
  const t = body.theme ?? {};
  const wantTheme = body.theme !== undefined;
  if (wantTheme && (!isColor(t.wall) || !isColor(t.floor))) {
    return json({ error: "색은 #rrggbb 여섯 자리로 보내주세요" }, 400);
  }

  /* 전시 제목과 학생 이름. 만들 때 한 번 적고 끝이었는데, 오타 하나를
     고치려고 전시장을 새로 만들 수는 없습니다. 길이는 만들 때와 같습니다. */
  let title: string | null = null;
  if (body.title !== undefined) {
    title = String(body.title).trim().slice(0, MAX_TITLE);
    if (!title) return json({ error: "전시 제목을 적어주세요" }, 400);
  }
  let ownerName: string | null = null;
  if (body.name !== undefined) {
    ownerName = String(body.name).trim().slice(0, MAX_NAME);
    if (!ownerName) return json({ error: "학생 이름을 적어주세요" }, 400);
  }
  /* 바닥 마감. 보내지 않으면 그대로 둡니다 — 예전 화면에서 색만 저장해도
     골라둔 마감이 사라지면 안 됩니다. 이름은 exhibition.html 의
     FLOOR_PATTERNS 와 같은 줄로 맞춰 두세요. */
  const FLOOR_PATTERNS = ["plank", "tile", "plain"];
  let floorPattern: string | null = null;
  if (t.floorPattern !== undefined) {
    if (!FLOOR_PATTERNS.includes(String(t.floorPattern))) {
      return json({ error: "그런 바닥 마감은 없습니다" }, 400);
    }
    floorPattern = String(t.floorPattern);
  }
  /* 거실 가구 색. 바닥 마감과 같은 규칙입니다 — 보내지 않으면 그대로
     둡니다. 이름은 exhibition.html 의 LOUNGE_SETS 와 같은 줄로 맞추세요. */
  const LOUNGE_SETS = ["cream", "charcoal"];
  let lounge: string | null = null;
  if (t.lounge !== undefined) {
    if (!LOUNGE_SETS.includes(String(t.lounge))) {
      return json({ error: "그런 거실 가구 색은 없습니다" }, 400);
    }
    lounge = String(t.lounge);
  }

  /* 전시 기획서 {title, url}. 전시장을 만든 사람이 방명록 아래 칸에서 올립니다.
     null 을 보내면 내립니다. 칸을 새로 만들지 않고 theme 에 얹습니다 —
     cover·room 과 같은 자리입니다.

     주소는 http·https 만 받습니다. 화면에서도 같은 검사를 하지만, 화면을
     거치지 않고 이 자리로 곧장 보낼 수 있으니 여기가 실제 차단선입니다. */
  let plan: { title: string; url: string } | null | undefined;
  if (body.plan !== undefined) {
    if (body.plan === null) {
      plan = null;
    } else {
      const pt = String(body.plan?.title ?? "").trim().slice(0, MAX_TITLE);
      const pu = String(body.plan?.url ?? "").trim().slice(0, 300);
      if (!pt || !pu) {
        return json({ error: "기획서 제목과 문서 주소를 모두 보내주세요" }, 400);
      }
      let u: URL | null = null;
      try { u = new URL(/^https?:\/\//i.test(pu) ? pu : "https://" + pu); }
      catch { u = null; }
      const bad = !u || (u.protocol !== "http:" && u.protocol !== "https:")
        || !u.hostname.includes(".") || /\s/.test(pu);
      if (bad || !u) {
        return json({ error: "주소가 올바르지 않습니다. 예: https://docs.google.com/..." }, 400);
      }
      plan = { title: pt, url: u.toString().slice(0, 300) };
    }
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

  const patch: Record<string, unknown> = {};
  if (wantTheme || room || floorPattern || lounge || plan !== undefined) {
    const theme: Record<string, unknown> = { ...(g.theme as object) };
    if (wantTheme) { theme.wall = t.wall; theme.floor = t.floor; }
    if (room) theme.room = room;
    if (floorPattern) theme.floorPattern = floorPattern;
    if (lounge) theme.lounge = lounge;
    if (plan === null) delete theme.plan;
    else if (plan) theme.plan = plan;
    patch.theme = theme;
  }
  if (title) patch.title = title;
  if (ownerName) patch.owner_name = ownerName;
  if (!Object.keys(patch).length) return json({ error: "바꿀 것이 없습니다" }, 400);

  const { data, error } = await supabase
    .from("galleries")
    .update(patch)
    .eq("handle", handle)
    .select("handle, title, owner_name, theme");

  if (error) return json({ error: error.message }, 500);
  if (!data || !data.length) {
    return json({ error: "고칠 권한이 없거나 없는 전시장입니다" }, 403);
  }
  return json({ ok: true, handle, title: data[0].title,
                name: data[0].owner_name, theme: data[0].theme });
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

/* 방명록은 오래된 것부터 늘어놓습니다 — 벽에 걸린 판도 창의 목록도 뒤에서
   부터 읽기 때문입니다.

   예전에는 50개까지만 실었습니다. 그때는 판이 다섯 개만 걸었으니 나머지는
   어차피 화면에 닿지 않았는데, 이제 판은 담기는 대로 다 걸고 창은 전부
   보여줍니다. 한 학기를 받아낼 만큼 올려둡니다. */
const GUESTBOOK_MAX = 200;
function recentGuestbook(rows: any) {
  if (!Array.isArray(rows)) return [];
  return rows
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(-GUESTBOOK_MAX)
    // id 를 함께 보냅니다. 주인과 선생님이 한 줄만 골라 지우려면 필요합니다.
    .map((e) => ({ id: e.id, name: e.visitor_name, msg: e.message,
                   link: e.link ?? null }));
}

export async function GET() {
  if (!SUPABASE_READY) {
    return json({ error: "Supabase 가 설정되지 않았습니다" }, 503);
  }

  const supabase = await supabaseServer();

  // 로그인하지 않았어도 됩니다. 관람은 누구나 — 그때 user 는 null 입니다.
  const { data: { user } } = await supabase.auth.getUser();

  /* 공개 전시장만 보이는 것은 RLS 가 정합니다. 여기서 거르지 않습니다.

     works.dx·dy 와 guestbook.link 는 나중에 더한 칸입니다. schema.sql 을
     아직 돌리지 않은 데이터베이스에서는 그 칸이 없어 조회가 통째로
     실패하고, 그러면 로비가 500 으로 뜹니다 — 배포가 마이그레이션보다
     먼저 나가면 전시장 전체가 안 열리는 셈입니다. 두 번 겪은 일이라
     한 번 더 묻습니다: 새 칸이 없으면 그것들을 빼고 다시 읽고,
     빠진 값은 기본값으로 봅니다. */
  const head = "handle, title, owner_name, theme, layout, owner_id, ";
  const wkFull = "works(slot, title, note, kind, media_url, scale, dx, dy)";
  const wkLite = "works(slot, title, note, kind, media_url, scale)";
  const gbFull = "guestbook(id, visitor_name, message, link, created_at)";
  const gbLite = "guestbook(id, visitor_name, message, created_at)";
  const pick = (wk: string, gb: string) =>
    supabase.from("galleries").select(head + wk + ", " + gb).order("created_at");

  let { data, error } = await pick(wkFull, gbFull);
  const missing = (m: string) => ["dx", "dy", "link"].some((c) => m.includes(c));
  if (error && missing(error.message)) {
    console.warn("새 칸이 없습니다 — supabase/schema.sql 을 실행하세요:", error.message);
    ({ data, error } = await pick(wkLite, gbLite));
  }

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
        scale: w.scale ?? 1,
        dx: w.dx ?? 0,
        dy: w.dy ?? 0,
      })),
  }));

  return json({ galleries });
}
