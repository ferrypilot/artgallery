// app/api/imagine/[id]/route.ts
//
// 상태 폴링. 브라우저가 3초마다 부릅니다.
//
// 완성된 순간 영상을 우리 Storage 로 옮겨 담는 것이 이 라우트의 핵심입니다.
// xAI 가 주는 URL 은 만료됩니다. 이 단계를 빼면 며칠 뒤 전시장의 영상이
// 전부 깨집니다. — studio-setup.md

import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json, XAI_BASE } from "@/lib/imagine";

// 영상을 받아 다시 올리는 부분이 Vercel 기본 10초를 넘길 수 있습니다.
// 720p 15초짜리가 특히 위험합니다.
export const maxDuration = 60;

// Next 15 부터 params 가 Promise 입니다.
// 유니온으로 14/15 양쪽을 받으려 했더니 next build 가 생성하는 라우트 타입
// 검사가 "정확히 Promise" 를 요구해서 거부했습니다. package.json 이 15 로
// 고정돼 있으니 15 시그니처로 둡니다.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const supabase = await supabaseServer();

  // RLS 가 남의 행을 걸러줍니다. 여기서 못 찾으면 없거나 남의 것입니다.
  const { data: gen } = await supabase
    .from("generations")
    .select("id, user_id, request_id, status, media_url, error, source_url")
    .eq("id", id)
    .maybeSingle();

  if (!gen) return json({ error: "찾을 수 없습니다" }, 404);

  // 이미 끝난 것은 xAI 를 다시 부르지 않습니다.
  if (gen.status === "done") {
    return json({ status: "done", videoUrl: gen.media_url });
  }
  if (gen.status === "failed" || gen.status === "expired") {
    return json({ status: gen.status, error: gen.error ?? "생성에 실패했습니다" });
  }

  const key = process.env.XAI_API_KEY;
  if (!key) return json({ error: "XAI_API_KEY 가 설정되지 않았습니다" }, 500);

  const r = await fetch(`${XAI_BASE}/videos/${gen.request_id}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!r.ok) {
    // 일시적인 것일 수 있으니 행은 건드리지 않고 계속 돌게 둡니다.
    return json({ status: "running" });
  }

  const d = await r.json();
  const status = String(d?.status ?? "pending");

  if (status === "failed" || status === "expired") {
    const message = String(d?.error?.message ?? "생성에 실패했습니다");
    await supabase.from("generations")
      .update({ status, error: message })
      .eq("id", gen.id);
    await removeSource(supabase, gen.source_url);
    return json({ status, error: message });
  }

  if (status !== "done") {
    // xAI 의 pending 을 화면의 "생성 중" 으로 맞춥니다.
    return json({ status: "running" });
  }

  const remote = d?.video?.url;
  if (!remote) return json({ status: "running" });

  // ── 만료되기 전에 우리 쪽으로 옮겨 담습니다 ──
  try {
    const file = await fetch(remote);
    if (!file.ok) throw new Error(`다운로드 실패 ${file.status}`);
    const bytes = await file.arrayBuffer();

    const path = `${gen.user_id}/videos/${gen.id}.mp4`;
    const { error: upErr } = await supabase.storage
      .from("works")
      .upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const videoUrl = supabase.storage.from("works").getPublicUrl(path).data.publicUrl;

    await supabase.from("generations")
      .update({ status: "done", media_url: videoUrl })
      .eq("id", gen.id);

    // 영상이 우리 쪽에 안전히 들어온 뒤에야 원본을 지웁니다. 순서가 중요합니다.
    await removeSource(supabase, gen.source_url);

    return json({ status: "done", videoUrl });
  } catch (e: any) {
    // 여기서 실패해도 xAI 쪽에는 아직 영상이 있습니다. 다음 폴링에서 다시 시도하도록
    // 행을 failed 로 바꾸지 않고 running 으로 둡니다. 만료되면 그때 expired 가 옵니다.
    console.error("[imagine] 영상 저장 실패", gen.id, e?.message);
    return json({ status: "running" });
  }
}

/**
 * 생성이 끝난 원본 이미지를 지웁니다.
 *
 * 학생 휴대폰 사진은 장당 2~5MB 라, 안 지우면 완성 영상보다 원본이 용량을
 * 더 먹습니다. Supabase 무료 저장 한도가 1GB 라 이게 먼저 찹니다.
 *
 * 실패해도 조용히 넘어갑니다. 청소가 안 된 것은 나중에 다시 지우면 되지만,
 * 여기서 던지면 학생은 다 만든 영상을 못 받습니다. 그건 훨씬 나쁩니다.
 */
async function removeSource(supabase: any, sourceUrl: string | null) {
  if (!sourceUrl) return;
  try {
    // 공개 URL 에서 버킷 뒤의 경로만 떼어냅니다.
    // .../storage/v1/object/public/works/{uid}/sources/{파일} → {uid}/sources/{파일}
    const marker = "/object/public/works/";
    const at = sourceUrl.indexOf(marker);
    if (at < 0) return;
    const path = decodeURIComponent(sourceUrl.slice(at + marker.length));
    if (!path.includes("/sources/")) return;   // 영상은 절대 건드리지 않습니다

    const { error } = await supabase.storage.from("works").remove([path]);
    if (error) console.error("[imagine] 원본 삭제 실패", path, error.message);
  } catch (e: any) {
    console.error("[imagine] 원본 삭제 중 오류", e?.message);
  }
}
