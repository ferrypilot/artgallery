// app/api/works/upload/route.ts
//
// 전시실 안에서 파일을 골라 바로 거는 길. 두 단계입니다.
//
//   POST   { handle, slot, ext }                  올릴 자리를 받습니다
//   PUT    { handle, slot, path, title, note, … } 올린 파일을 그 자리에 겁니다
//
// 왜 두 단계인가 — 파일이 서버를 거치지 않게 하려는 것입니다.
//
// 처음에는 파일을 이 라우트로 통째로 받아 스토리지에 넘겼습니다. 그런데
// 서버리스는 요청 본문을 4.5MB 남짓까지만 받습니다. 학생이 찍은 영상은
// 그보다 크기 일쑤라, 다섯 개째까지 걸리다가 여섯 개째부터 막혔습니다.
//
// 그래서 서버는 "여기에 올려도 된다"는 서명만 내주고, 파일은 브라우저에서
// Supabase 로 바로 올라갑니다. 서버를 지나지 않으니 그 한도가 사라집니다.
// 권한 검사는 서명을 내줄 때 하고, 경로를 우리가 정하기 때문에 남의 폴더에
// 올릴 수도 없습니다.

import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";
import { roomOf } from "@/lib/rooms";

const HANDLE = /^[a-z0-9-]{2,20}$/;
const EXT: Record<string, string> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image",
  mp4: "video", webm: "video", mov: "video",
};

/** 이 전시장의 이 자리에 걸 수 있는 사람인지 보고, 걸 자리를 돌려줍니다. */
async function place(request: Request, body: any) {
  const v = await loadViewer();
  if (!v) return { err: json({ error: "로그인이 필요합니다" }, 401) };
  if (!v.approved) {
    return { err: json({ error: "사용이 중지된 계정입니다. 선생님께 문의하세요" }, 403) };
  }

  const handle = String(body.handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return { err: json({ error: "주소가 올바르지 않습니다" }, 400) };

  const supabase = await supabaseServer();
  const { data: gallery } = await supabase
    .from("galleries").select("id, theme").eq("handle", handle).maybeSingle();
  if (!gallery) return { err: json({ error: "전시장을 찾을 수 없습니다" }, 404) };

  const room = roomOf(gallery.theme);
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= room.slots.length) {
    return { err: json({ error: `${room.name}의 자리는 0~${room.slots.length - 1} 입니다` }, 400) };
  }
  return { v, supabase, gallery, handle, slot };
}

/** 1단계 — 올릴 자리와 서명을 내줍니다. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const p = await place(request, body);
  if ("err" in p) return p.err;

  const ext = String(body.ext ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!EXT[ext]) return json({ error: "이미지 또는 영상 파일만 걸 수 있습니다" }, 400);

  /* 경로는 서버가 정합니다. 브라우저가 정하게 두면 남의 폴더 이름을 적어
     보낼 수 있습니다. 시각을 붙여 매번 새 파일이 되게 합니다 — 같은 자리에
     다시 걸 때 이름이 같으면 브라우저가 옛 그림을 계속 보여줍니다. */
  const path = `${p.v.id}/works/${p.handle}-${p.slot}-${Date.now()}.${ext}`;
  const { data, error } = await p.supabase.storage
    .from("works").createSignedUploadUrl(path);
  if (error) return json({ error: `올릴 자리를 만들지 못했습니다: ${error.message}` }, 500);

  return json({ path, token: data.token, signedUrl: data.signedUrl, kind: EXT[ext] });
}

/** 2단계 — 올라간 파일을 그 자리에 겁니다. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const p = await place(request, body);
  if ("err" in p) return p.err;

  const path = String(body.path ?? "");
  // 1단계에서 우리가 내준 자리인지 — 남의 폴더를 적어 보낼 수 없습니다.
  if (!path.startsWith(`${p.v.id}/works/`)) {
    return json({ error: "올린 자리가 올바르지 않습니다" }, 400);
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const kind = EXT[ext];
  if (!kind) return json({ error: "이미지 또는 영상 파일만 걸 수 있습니다" }, 400);

  const media_url = p.supabase.storage.from("works").getPublicUrl(path).data.publicUrl;

  // 정말 올라갔는지 확인합니다. 안 올라간 주소를 걸면 빈 액자가 됩니다.
  const head = await fetch(media_url, { method: "HEAD" });
  if (!head.ok) return json({ error: "파일이 아직 올라오지 않았습니다" }, 409);

  const title = String(body.title ?? "").trim().slice(0, 60);
  if (!title) return json({ error: "제목을 적어주세요" }, 400);
  const note = String(body.note ?? "").trim().slice(0, 200) || null;
  const s = Number(body.scale);
  const scale = Number.isFinite(s) ? Math.round(Math.max(0.6, Math.min(1.6, s)) * 100) / 100 : 1;

  // 그 자리에 걸려 있던 것은 내립니다. unique (gallery_id, slot) 이라
  // 비우지 않으면 새로 걸리지 않습니다.
  const { data: old } = await p.supabase
    .from("works").select("media_url").eq("gallery_id", p.gallery.id).eq("slot", p.slot);
  if (old && old.length) {
    await p.supabase.from("works").delete()
      .eq("gallery_id", p.gallery.id).eq("slot", p.slot);
  }

  const { data, error } = await p.supabase
    .from("works")
    .insert({ gallery_id: p.gallery.id, slot: p.slot, title, note, kind, media_url, scale })
    .select("slot, title, note, kind, media_url, scale")
    .single();

  if (error) {
    // 못 걸었으면 방금 올린 파일도 치웁니다. 아무도 안 보는 파일입니다.
    await p.supabase.storage.from("works").remove([path]);
    if (error.code === "42501" || error.message.includes("policy")) {
      return json({ error: "걸 권한이 없습니다" }, 403);
    }
    return json({ error: error.message }, 500);
  }

  // 갈아치운 옛 파일 치우기. 실패해도 알리지 않습니다 — 새 작품은 이미
  // 걸렸고, 남은 파일은 학기말 정리에서 걷힙니다.
  for (const o of (old ?? [])) {
    const tail = String(o.media_url ?? "").split("?")[0]
      .split("/storage/v1/object/public/works/")[1];
    if (tail) await p.supabase.storage.from("works").remove([decodeURIComponent(tail)]);
  }

  return json({
    work: {
      slot: data.slot, title: data.title, note: data.note,
      kind: data.kind, src: data.media_url, scale: data.scale ?? 1,
    },
  });
}
