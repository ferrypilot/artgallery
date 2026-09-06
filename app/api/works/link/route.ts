// app/api/works/link/route.ts
//
// 유튜브 영상을 벽에 거는 길.
//
//   POST { handle, slot, url, title, note, scale }
//
// 올릴 파일이 없으므로 한 단계입니다. 스토리지를 쓰지 않고 주소 한 줄만
// works.media_url 에 넣습니다 — 영상은 유튜브에 그대로 있고 우리는 어디에
// 있는지만 적어두는 셈입니다. 학생 한도(용량)를 쓰지 않는 것도 그래서입니다.
//
// 벽에 걸리는 것은 유튜브 썸네일이고, 관람자가 누르면 그 자리에 유튜브
// 플레이어가 열립니다. 영상을 벽면에 그대로 칠할 수는 없습니다 — 유튜브
// 플레이어는 다른 사이트의 iframe 이라 그 픽셀을 읽어올 수 없습니다.

import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";
import { roomOf } from "@/lib/rooms";

const HANDLE = /^[a-z0-9-]{2,20}$/;

/* 유튜브 주소에서 영상 번호만 꺼냅니다. 학생이 붙여 넣는 주소는 모양이
   여럿입니다 — 주소창에서 복사한 것, 공유 단추가 준 짧은 것, 쇼츠, 그리고
   ?t=30 같은 꼬리표가 붙은 것. 번호는 열한 글자입니다. */
// 내보내지 않습니다 — Next 의 라우트 파일은 핸들러 말고 다른 것을
// 내보내면 빌드가 거절합니다.
function youtubeId(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // 번호만 그대로 붙여 넣은 경우
  if (/^[\w-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s.startsWith("http") ? s : "https://" + s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const ok = ["youtube.com", "youtu.be", "youtube-nocookie.com"];
  if (!ok.includes(host)) return null;

  const pick = (v: string | null) => (v && /^[\w-]{11}$/.test(v) ? v : null);
  if (host === "youtu.be") return pick(u.pathname.slice(1).split("/")[0]);
  if (u.pathname === "/watch") return pick(u.searchParams.get("v"));
  const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/);
  return m ? pick(m[2]) : null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);
  if (!v.approved) {
    return json({ error: "사용이 중지된 계정입니다. 선생님께 문의하세요" }, 403);
  }

  const id = youtubeId(body.url);
  if (!id) {
    return json({ error: "유튜브 주소가 아닙니다. 주소창의 주소를 그대로 붙여 넣으세요" }, 400);
  }

  const handle = String(body.handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const supabase = await supabaseServer();
  const { data: gallery } = await supabase
    .from("galleries").select("id, theme").eq("handle", handle).maybeSingle();
  if (!gallery) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  const room = roomOf(gallery.theme);
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= room.slots.length) {
    return json({ error: `${room.name}의 자리는 0~${room.slots.length - 1} 입니다` }, 400);
  }

  const title = String(body.title ?? "").trim().slice(0, 60) || "제목 없음";
  const note = String(body.note ?? "").trim().slice(0, 200) || null;
  const s = Number(body.scale);
  const scale = Number.isFinite(s)
    ? Math.round(Math.max(0.6, Math.min(2.0, s)) * 100) / 100 : 1;

  /* 그 자리에 있던 것을 먼저 내립니다. 한 자리에 한 점이라 비우지 않으면
     새로 걸리지 않습니다. 올려둔 파일이 있었다면 스토리지에서도 치웁니다 —
     아무도 보지 않는 파일이 남습니다. */
  const { data: old } = await supabase
    .from("works").select("media_url").eq("gallery_id", gallery.id).eq("slot", slot);
  if (old && old.length) {
    await supabase.from("works").delete()
      .eq("gallery_id", gallery.id).eq("slot", slot);
  }

  const { data, error } = await supabase
    .from("works")
    .insert({
      gallery_id: gallery.id, slot, title, note,
      kind: "youtube", media_url: `https://www.youtube.com/watch?v=${id}`, scale,
    })
    .select("slot, title, note, kind, media_url, scale, dx, dy")
    .single();

  if (error) {
    if (error.code === "42501" || error.message.includes("policy")) {
      return json({ error: "걸 권한이 없습니다" }, 403);
    }
    // kind 에 youtube 가 아직 없는 데이터베이스입니다. supabase/schema.sql 을
    // 실행하라고 그대로 알려줍니다 — "23514" 만 보면 무엇을 해야 할지 모릅니다.
    if (error.code === "23514") {
      return json({ error: "유튜브를 걸려면 supabase/schema.sql 을 다시 실행하세요" }, 500);
    }
    return json({ error: error.message }, 500);
  }

  for (const o of (old ?? [])) {
    const tail = String(o.media_url ?? "").split("?")[0]
      .split("/storage/v1/object/public/works/")[1];
    if (tail) await supabase.storage.from("works").remove([decodeURIComponent(tail)]);
  }

  return json({
    work: {
      slot: data.slot, title: data.title, note: data.note,
      kind: data.kind, src: data.media_url, scale: data.scale ?? 1,
      dx: data.dx ?? 0, dy: data.dy ?? 0,
    },
  });
}
