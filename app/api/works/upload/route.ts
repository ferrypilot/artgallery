// app/api/works/upload/route.ts
//
// 전시실 안에서 파일을 골라 바로 거는 길.
//
//   POST multipart { handle, slot, title, note, file }
//
// 스튜디오는 "AI 로 만든 영상"을 겁니다. 이쪽은 학생이 손에 든 그림 파일을
// 그대로 겁니다 — 사진으로 찍은 그림, 스캔한 그림, 직접 만든 짧은 영상.
// 두 길이 다 필요합니다. 전시실에서 빈 액자를 눌렀을 때 스튜디오로
// 보내버리면, 이미 파일을 들고 있는 학생에게는 돌아가는 길이 됩니다.
//
// 파일 크기는 4MB 로 자릅니다. 서버리스 환경이 요청 본문을 그보다 크게
// 받지 못합니다. 이미지는 화면에서 미리 줄여 보내므로 걸릴 일이 거의 없고,
// 큰 영상은 스튜디오 쪽이 맞습니다(그쪽은 xAI 가 직접 만들어 올립니다).

import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";
import { roomOf } from "@/lib/rooms";

const HANDLE = /^[a-z0-9-]{2,20}$/;
const MAX_MB = 4;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};

export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);
  if (!v.approved) return json({ error: "사용이 중지된 계정입니다. 선생님께 문의하세요" }, 403);

  const fd = await request.formData().catch(() => null);
  if (!fd) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const handle = String(fd.get("handle") ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const title = String(fd.get("title") ?? "").trim().slice(0, 60);
  if (!title) return json({ error: "제목을 적어주세요" }, 400);
  const note = String(fd.get("note") ?? "").trim().slice(0, 200) || null;

  const file = fd.get("file");
  if (!(file instanceof File)) return json({ error: "파일이 필요합니다" }, 400);
  const ext = EXT[file.type];
  if (!ext) return json({ error: "이미지 또는 영상 파일만 걸 수 있습니다" }, 400);
  if (file.size > MAX_MB * 1048576) {
    return json({
      error: `파일이 ${MAX_MB}MB 를 넘습니다. 영상은 생성 스튜디오에서 걸어주세요`,
    }, 413);
  }

  const supabase = await supabaseServer();

  const { data: gallery } = await supabase
    .from("galleries").select("id, theme").eq("handle", handle).maybeSingle();
  if (!gallery) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  const room = roomOf(gallery.theme);
  const slot = Number(fd.get("slot"));
  if (!Number.isInteger(slot) || slot < 0 || slot >= room.slots.length) {
    return json({ error: `${room.name}의 자리는 0~${room.slots.length - 1} 입니다` }, 400);
  }

  const scaleRaw = Number(fd.get("scale"));
  const scale = Number.isFinite(scaleRaw)
    ? Math.round(Math.max(0.6, Math.min(1.6, scaleRaw)) * 100) / 100 : 1;

  /* 파일 이름에 시각을 붙여 매번 새로 만듭니다. 같은 자리에 다시 걸 때
     이름이 같으면 브라우저가 옛 그림을 계속 보여줍니다. 대신 갈아치운
     옛 파일은 아래에서 지웁니다. */
  const path = `${v.id}/works/${handle}-${slot}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("works").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return json({ error: `올리지 못했습니다: ${upErr.message}` }, 500);

  const media_url = supabase.storage.from("works").getPublicUrl(path).data.publicUrl;
  const kind = file.type.startsWith("video/") ? "video" : "image";

  // 그 자리에 걸려 있던 것은 내립니다. unique (gallery_id, slot) 이라
  // 비우지 않으면 새로 걸리지 않습니다.
  const { data: old } = await supabase
    .from("works").select("media_url").eq("gallery_id", gallery.id).eq("slot", slot);
  if (old && old.length) {
    await supabase.from("works").delete().eq("gallery_id", gallery.id).eq("slot", slot);
  }

  const { data, error } = await supabase
    .from("works")
    .insert({ gallery_id: gallery.id, slot, title, note, kind, media_url, scale })
    .select("slot, title, note, kind, media_url, scale")
    .single();

  if (error) {
    // 못 걸었으면 방금 올린 파일도 치웁니다. 아무도 안 보는 파일입니다.
    await supabase.storage.from("works").remove([path]);
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
    if (tail) await supabase.storage.from("works").remove([decodeURIComponent(tail)]);
  }

  return json({
    work: {
      slot: data.slot, title: data.title, note: data.note,
      kind: data.kind, src: data.media_url, scale: data.scale ?? 1,
    },
  });
}
