// app/api/works/route.ts
//
// 만든 영상을 전시장 자리에 겁니다. 스튜디오의 "전시장에 걸기" 가 부릅니다.
//
// GET  — 내 전시장과 비어 있는 자리 (걸기 전에 어디가 비었는지 보여주려고)
// POST — { generationId, slot, title, note } → works 에 한 줄
//
// 학생이 전시장을 따로 만드는 절차를 두지 않았습니다. 첫 작품을 거는 순간
// 자기 전시장이 생깁니다. 빈 전시장을 먼저 만들게 하면 거기서 이탈합니다.

import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";
import { roomOf, MAX_SLOTS } from "@/lib/rooms";

const HANDLE = /^[a-z0-9-]{2,20}$/;

// 자리 수는 전시장이 쓰는 전시관에 달렸습니다. 지금은 큰 전시실 하나뿐이라
// 어디나 20자리지만, 방이 늘면 전시장마다 달라집니다.
// lib/rooms.ts 의 표가 자리 이름을, public/exhibition.html 의 ROOMS 가
// 벽 좌표를 갖습니다.

export async function GET() {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const supabase = await supabaseServer();
  const gallery = await findGallery(supabase, v.id);

  if (!gallery) {
    // 아직 전시장이 없습니다. 처음 걸면 기본 전시관으로 생깁니다.
    const room = roomOf(null);
    return json({
      gallery: null, taken: [], free: range(room.slots.length),
      room: { name: room.name, slots: room.slots },
    });
  }

  const { data: works } = await supabase
    .from("works").select("slot, title").eq("gallery_id", gallery.id);

  // 자리 이름을 여기서 함께 보냅니다. 스튜디오가 자기 표를 따로 들고 있으면
  // 방을 하나 더 만들 때마다 세 곳이 어긋납니다.
  const room = roomOf(gallery.theme);
  const taken = (works ?? []).map((w: any) => w.slot);
  return json({
    gallery: { handle: gallery.handle, title: gallery.title },
    taken,
    free: range(room.slots.length).filter((s) => !taken.includes(s)),
    room: { name: room.name, slots: room.slots },
  });
}

export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  if (!v.approved) return json({ error: "사용이 중지된 계정입니다. 선생님께 문의하세요" }, 403);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  // 방을 알아야 자리 수를 셀 수 있는데 전시장은 아래에서 찾습니다.
  // 여기서는 어느 방에도 없는 번호만 먼저 걸러냅니다.
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
    return json({ error: `자리는 0~${MAX_SLOTS - 1} 입니다` }, 400);
  }

  const title = String(body.title ?? "").trim().slice(0, 60) || "제목 없음";
  const note = String(body.note ?? "").trim().slice(0, 200) || null;

  const supabase = await supabaseServer();

  // 완성된 내 생성물이어야 합니다. RLS 가 남의 것을 걸러줍니다.
  const { data: gen } = await supabase
    .from("generations")
    .select("id, status, media_url")
    .eq("id", String(body.generationId ?? ""))
    .maybeSingle();

  if (!gen) return json({ error: "생성 기록을 찾을 수 없습니다" }, 404);
  if (gen.status !== "done" || !gen.media_url) {
    return json({ error: "아직 완성되지 않은 영상입니다" }, 409);
  }

  // 전시장이 없으면 지금 만듭니다.
  let gallery = await findGallery(supabase, v.id);
  if (!gallery) {
    const created = await createGallery(supabase, v);
    if ("error" in created) return json({ error: created.error }, 500);
    gallery = created.gallery;
  }

  // 이제 방을 압니다. 그 방에 없는 자리에는 걸 수 없습니다.
  const room = roomOf(gallery.theme);
  if (slot >= room.slots.length) {
    return json({
      error: `${room.name}의 자리는 0~${room.slots.length - 1} 입니다`,
    }, 400);
  }

  const { error } = await supabase.from("works").insert({
    gallery_id: gallery.id,
    slot,
    title,
    note,
    kind: "video",
    media_url: gen.media_url,
  });

  if (error) {
    // unique (gallery_id, slot) — 한 자리에 한 점
    if (error.code === "23505") {
      return json({ error: "그 자리에는 이미 작품이 걸려 있습니다" }, 409);
    }
    return json({ error: error.message }, 500);
  }

  return json({ handle: gallery.handle, slot });
}

/**
 * 작품 내리기.  DELETE /api/works?handle=<주소>&slot=<번호>
 *
 * handle 을 생략하면 내 전시장입니다. 남의 전시장을 지정해도 RLS 가
 * 막습니다 — 여기서 거르는 것은 안내를 위해서일 뿐입니다.
 *
 * 파일은 지우지 않습니다. 같은 영상을 다른 자리에 다시 걸 수 있고,
 * generations 에도 남아 있어야 비용 집계가 맞습니다. 자리에서 내리는 것과
 * 파일을 버리는 것은 다른 일입니다.
 */
export async function DELETE(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const url = new URL(request.url);
  const slot = Number(url.searchParams.get("slot"));
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
    return json({ error: "자리 번호가 올바르지 않습니다" }, 400);
  }

  const supabase = await supabaseServer();
  const handle = url.searchParams.get("handle");

  let galleryId: string | null = null;
  if (handle) {
    const { data } = await supabase
      .from("galleries").select("id").eq("handle", handle).maybeSingle();
    galleryId = data?.id ?? null;
  } else {
    const g = await findGallery(supabase, v.id);
    galleryId = g?.id ?? null;
  }
  if (!galleryId) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  const { data: removed, error } = await supabase
    .from("works")
    .delete()
    .eq("gallery_id", galleryId)
    .eq("slot", slot)
    .select("slot");

  if (error) return json({ error: error.message }, 500);
  // RLS 가 막으면 오류가 아니라 "0행 삭제" 로 옵니다. 조용한 실패를 막습니다.
  if (!removed || !removed.length) {
    return json({ error: "내릴 권한이 없거나 이미 빈 자리입니다" }, 403);
  }

  return json({ ok: true, slot });
}

/* ---------- 안쪽 ---------- */

async function findGallery(supabase: any, userId: string) {
  const { data } = await supabase
    .from("galleries")
    .select("id, handle, title, theme")
    .eq("owner_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function createGallery(supabase: any, v: { id: string; email: string }) {
  // 프로필 이름이 있으면 그걸, 없으면 이메일 앞부분을 씁니다.
  const { data: profile } = await supabase
    .from("profiles").select("display_name").eq("id", v.id).maybeSingle();

  const local = v.email.split("@")[0] || "room";
  const name = profile?.display_name || local;

  const base = local.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 18) || "room";
  // handle 은 unique 이고 ^[a-z0-9-]{2,20}$ 검사가 걸려 있습니다.
  let handle = base.length < 2 ? base + "-1" : base;

  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabase
      .from("galleries")
      .insert({
        owner_id: v.id,
        handle,
        title: `${name}의 전시`,
        owner_name: name,
      })
      .select("id, handle, title, theme")
      .single();

    if (!error) return { gallery: data };
    if (error.code !== "23505") return { error: error.message };

    // 주소가 겹쳤습니다. 뒤에 숫자를 붙여 다시.
    handle = `${base}-${i + 2}`.slice(0, 20);
  }
  return { error: "전시장 주소를 정하지 못했습니다" };
}

function range(n: number) {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * 걸린 작품의 제목·설명·크기 고치기.  PATCH { handle, slot, title, note, scale }
 *
 * 지금까지 전시실 안에서 제목을 바꾸면 화면에만 반영되고 서버에는 가지
 * 않았습니다. 로비로 나왔다 들어오면 옛 제목으로 돌아왔는데, 학생 눈에는
 * 고친 것이 지워진 것으로 보입니다.
 *
 * 영상 자체는 여기서 바꾸지 못합니다. 거는 것은 생성 스튜디오의 일이고,
 * 이쪽은 이미 걸린 것의 이름표만 손봅니다.
 *
 * 권한은 RLS 의 "주인과 관리자만 작품을 바꾼다" 가 정합니다.
 */
export async function PATCH(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const handle = String(body.handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
    return json({ error: "자리 번호가 올바르지 않습니다" }, 400);
  }

  const title = String(body.title ?? "").trim().slice(0, 60);
  if (!title) return json({ error: "제목을 적어주세요" }, 400);
  const note = String(body.note ?? "").trim().slice(0, 200) || null;

  /* 크기는 화면이 0.6~1.6 으로 자르지만 서버가 화면을 믿을 이유는 없습니다.
     보내지 않으면 건드리지 않습니다 — 제목만 고칠 때 크기가 1 로
     되돌아가면 안 됩니다. */
  const patch: Record<string, unknown> = { title, note };
  if (body.scale !== undefined) {
    const scale = Number(body.scale);
    if (!Number.isFinite(scale)) return json({ error: "크기가 올바르지 않습니다" }, 400);
    patch.scale = Math.round(Math.max(0.6, Math.min(1.6, scale)) * 100) / 100;
  }

  const supabase = await supabaseServer();
  const { data: gallery } = await supabase
    .from("galleries").select("id").eq("handle", handle).maybeSingle();
  if (!gallery) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  const { data, error } = await supabase
    .from("works")
    .update(patch)
    .eq("gallery_id", gallery.id)
    .eq("slot", slot)
    .select("slot, title, note, scale");

  if (error) return json({ error: error.message }, 500);
  // RLS 가 막으면 오류가 아니라 0행 수정으로 옵니다. 조용한 실패를 막습니다.
  if (!data || !data.length) {
    return json({ error: "고칠 권한이 없거나 빈 자리입니다" }, 403);
  }
  return json({ ok: true, work: data[0] });
}
