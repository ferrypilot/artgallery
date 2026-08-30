// app/api/galleries/cover/route.ts
//
// 전시장 카드에 걸리는 대표 이미지.
//
//   POST   multipart { handle, image }   정하기
//   DELETE ?handle=<주소>                지우기 (그리던 방 그림으로 돌아갑니다)
//
// 왜 컬럼을 새로 만들지 않았나 — galleries.theme 이 jsonb 라서 거기에
// cover 한 칸을 더 얹으면 됩니다. 데이터베이스를 고치지 않아도 오늘
// 바로 쓸 수 있고, /api/galleries 와 백업이 theme 를 이미 통째로
// 내보내고 있어서 화면과 오프라인 전시가 저절로 따라옵니다.
//
// 권한은 여기서 세지 않습니다. RLS 의 "주인과 관리자만 수정한다" 가
// 실제 차단선이고, 막히면 0행 수정으로 오는 것을 403 으로 바꿉니다.

import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";

const HANDLE = /^[a-z0-9-]{2,20}$/;

// 화면은 카드 한 장 크기로만 씁니다. 브라우저가 미리 줄여서 보내므로
// 이 한도에 걸릴 일은 거의 없고, 걸린다면 줄이지 않고 보낸 것입니다.
const MAX_MB = 3;

/** 저장된 주소에서 버킷 안 경로를 되짚습니다.
 *
 *  올리는 사람의 폴더에 넣기 때문에, 선생님이 학생 전시장의 대표 이미지를
 *  바꾸면 파일은 선생님 폴더에 들어갑니다. 지울 때 보는 사람의 id 로
 *  경로를 다시 만들면 그 파일을 찾지 못하고 버킷에 남습니다. 그래서
 *  추측하지 않고 저장해 둔 주소에서 그대로 읽어냅니다. */
function pathOf(cover: unknown) {
  if (typeof cover !== "string") return null;
  const tail = cover.split("?")[0].split("/storage/v1/object/public/works/")[1];
  return tail ? decodeURIComponent(tail) : null;
}

export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const fd = await request.formData().catch(() => null);
  if (!fd) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const handle = String(fd.get("handle") ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const image = fd.get("image");
  if (!(image instanceof File) || !image.type.startsWith("image/")) {
    return json({ error: "이미지 파일이 필요합니다" }, 400);
  }
  if (image.size > MAX_MB * 1048576) {
    return json({ error: `이미지는 ${MAX_MB}MB 이하여야 합니다` }, 413);
  }

  const supabase = await supabaseServer();

  // 지금 색을 그대로 두고 cover 만 얹어야 하므로 먼저 읽습니다.
  // 남의 전시장이면 RLS 가 아니라 여기서 먼저 걸립니다(공개 전시장은
  // 읽히니까요). 실제 차단은 아래 update 가 합니다.
  const { data: g } = await supabase
    .from("galleries").select("theme").eq("handle", handle).maybeSingle();
  if (!g) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  /* 파일 이름을 전시장마다 하나로 고정하고 덮어씁니다(upsert).
     바꿀 때마다 새 파일을 만들면 아무도 안 보는 옛 그림이 버킷에 쌓입니다.
     대신 주소가 같아지므로 브라우저가 옛 그림을 계속 보여줍니다 —
     그래서 뒤에 ?v= 를 붙여 새 것임을 알립니다. */
  const path = `${v.id}/covers/${handle}.jpg`;
  const { error: upErr } = await supabase.storage
    .from("works")
    .upload(path, image, { contentType: image.type, upsert: true });
  if (upErr) return json({ error: `올리지 못했습니다: ${upErr.message}` }, 500);

  const base = supabase.storage.from("works").getPublicUrl(path).data.publicUrl;
  const cover = `${base}?v=${Date.now()}`;

  const { data, error } = await supabase
    .from("galleries")
    .update({ theme: { ...(g.theme as object), cover } })
    .eq("handle", handle)
    .select("handle");

  if (error) return json({ error: error.message }, 500);
  if (!data || !data.length) {
    return json({ error: "고칠 권한이 없거나 없는 전시장입니다" }, 403);
  }

  // 옛 그림이 다른 폴더에 있었다면(주인과 선생님이 번갈아 바꾼 경우)
  // upsert 가 덮어쓰지 못합니다. 아무도 안 보는 파일이므로 치웁니다.
  const before = pathOf((g.theme as Record<string, unknown>)?.cover);
  if (before && before !== path) {
    await supabase.storage.from("works").remove([before]);
  }
  return json({ ok: true, cover });
}

export async function DELETE(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const handle = new URL(request.url).searchParams.get("handle") ?? "";
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const supabase = await supabaseServer();
  const { data: g } = await supabase
    .from("galleries").select("theme").eq("handle", handle).maybeSingle();
  if (!g) return json({ error: "전시장을 찾을 수 없습니다" }, 404);

  const { cover, ...rest } = (g.theme ?? {}) as Record<string, unknown>;

  const { data, error } = await supabase
    .from("galleries").update({ theme: rest }).eq("handle", handle).select("handle");

  if (error) return json({ error: error.message }, 500);
  if (!data || !data.length) {
    return json({ error: "고칠 권한이 없거나 없는 전시장입니다" }, 403);
  }

  // 파일은 지워도 그만입니다. 실패해도 화면에서는 이미 사라졌으므로
  // 학생에게 알리지 않습니다 — 나중에 다시 정하면 덮어써집니다.
  const path = pathOf(cover);
  if (path) await supabase.storage.from("works").remove([path]);
  return json({ ok: true });
}
