// app/api/imagine/route.ts
//
// 생성 시작. 브라우저에서 온 이미지를 Storage 에 올리고, 그 공개 URL로
// xAI 를 부른 뒤, generations 에 한 줄 남기고 우리 쪽 id 를 돌려줍니다.
// 이후 진행은 GET /api/imagine/[id] 가 봅니다.
//
// API 키는 이 파일 밖으로 나가지 않습니다. 브라우저는 이 라우트만 부릅니다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase";
import {
  loadViewer, json, costOf, MODELS, ASPECT_RATIOS, XAI_BASE, HARD_MAX_DURATION,
} from "@/lib/imagine";

// 이미지 업로드 + xAI 호출이 10초를 넘길 수 있습니다.
export const maxDuration = 60;

const MAX_IMAGE_MB = 15;

/**
 * 지금까지 만든 영상 목록.  GET /api/imagine
 *
 * 화면의 목록은 그동안 브라우저 메모리에만 있었습니다. 새로고침하면
 * 비었고, 학생은 어제 만든 영상을 다시 볼 방법이 없었습니다. 파일은
 * Storage 에, 기록은 generations 에 멀쩡히 있는데도 그랬습니다.
 *
 * RLS 가 본인 것만 내려보냅니다. 관리자는 자기 것만 봅니다 — 남의 작업을
 * 여기서 보여줄 이유가 없고, 보려면 전시장으로 가면 됩니다.
 */
export async function GET(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const all = new URL(request.url).searchParams.get("scope") === "all";
  if (all && !v.isTeacher) {
    return json({ error: "선생님·관리자만 볼 수 있습니다" }, 403);
  }

  /* 전체 보기는 service_role 로 읽습니다.
     관리자는 RLS(`user_id = auth.uid() or is_admin()`)로도 되지만 선생님은
     안 됩니다. 역할이 데이터베이스가 아니라 app_metadata 에 있어서 정책이
     선생님을 알아보지 못하기 때문입니다. 학생 계정 라우트와 같은 방식으로,
     부르는 사람이 누구인지는 위에서 이미 확인했습니다. */
  const session = await supabaseServer();
  const db = all ? (service() ?? session) : session;
  if (all && !service()) return json({ error: NEED_KEY }, 503);

  let q = db
    .from("generations")
    .select("id, user_id, status, prompt, prompt_ko, model, duration, resolution, " +
            "media_url, cost_usd, error, created_at")
    .order("created_at", { ascending: false })
    .limit(all ? 200 : 60);
  if (!all) q = q.eq("user_id", v.id);

  const { data: gens, error } = await q;
  if (error) return json({ error: error.message }, 500);

  // 누가 만들었는지. 전체 보기에서만 이름이 필요합니다.
  const who = new Map<string, string>();
  if (all) {
    const ids = [...new Set((gens ?? []).map((g: any) => g.user_id))];
    if (ids.length) {
      const { data: ps } = await db
        .from("profiles").select("id, email, display_name").in("id", ids);
      for (const p of ps ?? []) {
        who.set(p.id, p.display_name || (p.email ?? "").split("@")[0] || "(이름 없음)");
      }
    }
  }

  // 어느 것이 이미 전시장에 걸려 있는지. works 는 generation id 가 아니라
  // 영상 주소를 들고 있어서 그것으로 맞춥니다.
  const hung = new Map<string, { handle: string; slot: number }>();
  let gq = db.from("galleries").select("id, handle");
  if (!all) gq = gq.eq("owner_id", v.id);
  const { data: gals } = await gq;

  if (gals?.length) {
    const { data: works } = await db
      .from("works")
      .select("gallery_id, slot, media_url")
      .in("gallery_id", gals.map((g: any) => g.id));

    const handleOf = new Map(gals.map((g: any) => [g.id, g.handle]));
    for (const w of works ?? []) {
      if (w.media_url) {
        hung.set(w.media_url, { handle: handleOf.get(w.gallery_id)!, slot: w.slot });
      }
    }
  }

  return json({
    scope: all ? "all" : "mine",
    jobs: (gens ?? []).map((g: any) => ({
      id: g.id,
      status: g.status,
      prompt: g.prompt ?? "",
      ko: g.prompt_ko ?? "",
      model: g.model,
      res: g.resolution,
      duration: g.duration,
      videoUrl: g.media_url,
      error: g.error,
      cost: Number(g.cost_usd ?? 0),
      at: g.created_at,
      hung: g.media_url ? (hung.get(g.media_url)?.handle ?? null) : null,
      slot: g.media_url ? (hung.get(g.media_url)?.slot ?? null) : null,
      // 전체 보기에서만 채웁니다. 남의 영상은 걸지 못하므로 화면이
      // "내 것인가" 를 알아야 합니다.
      mine: g.user_id === v.id,
      by: all ? (who.get(g.user_id) ?? "(알 수 없음)") : null,
    })),
  });
}

const NEED_KEY =
  "SUPABASE_SERVICE_ROLE_KEY 가 없습니다. .env.local 에 넣고 서버를 다시 시작하세요.";

/** service_role 클라이언트. RLS 를 통째로 무시하므로 역할 확인 뒤에만 만듭니다. */
function service(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const key = process.env.XAI_API_KEY;
  if (!key) return json({ error: "XAI_API_KEY 가 설정되지 않았습니다" }, 500);

  const fd = await request.formData().catch(() => null);
  if (!fd) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const image = fd.get("image");
  if (!(image instanceof File) || !image.type.startsWith("image/")) {
    return json({ error: "이미지 파일이 필요합니다" }, 400);
  }
  if (image.size > MAX_IMAGE_MB * 1048576) {
    return json({ error: `이미지는 ${MAX_IMAGE_MB}MB 이하여야 합니다` }, 413);
  }

  const prompt = String(fd.get("prompt") ?? "").trim();
  if (!prompt) return json({ error: "프롬프트가 비어 있습니다" }, 400);

  const promptKo = String(fd.get("prompt_ko") ?? "").trim();
  const model = String(fd.get("model") ?? "");
  const resolution = String(fd.get("resolution") ?? "");
  const aspect = String(fd.get("aspect_ratio") ?? "auto");
  const duration = Math.round(Number(fd.get("duration")));

  if (!MODELS[model]) return json({ error: "알 수 없는 모델입니다" }, 400);
  if (!MODELS[model].res.includes(resolution)) {
    return json({ error: "이 모델이 지원하지 않는 화질입니다" }, 400);
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > HARD_MAX_DURATION) {
    return json({ error: `길이는 1~${HARD_MAX_DURATION}초입니다` }, 400);
  }
  if (aspect !== "auto" && !ASPECT_RATIOS.includes(aspect)) {
    return json({ error: "알 수 없는 비율입니다" }, 400);
  }

  // ── 여기가 실제 차단선. 화면의 자물쇠는 안내일 뿐입니다 ──
  // 미승인 학생도 로그인 자체는 성공합니다. 그래서 여기서 한 번 더 봅니다.
  if (!v.approved) {
    return json({ error: "사용이 중지된 계정입니다. 선생님께 문의하세요" }, 403);
  }
  if (v.used >= v.quota) {
    return json({ error: `한도를 다 썼습니다 (${v.used}/${v.quota})` }, 429);
  }
  if (!v.isAdmin && !v.resolutions.includes(resolution)) {
    return json({ error: "열려 있지 않은 화질입니다" }, 403);
  }
  if (!v.isAdmin && !v.models.includes(model)) {
    return json({ error: "열려 있지 않은 모델입니다" }, 403);
  }
  // 길이는 곧 비용입니다(초당 과금). 화면의 슬라이더를 개발자 도구로 늘려도
  // 여기서 막힙니다.
  if (!v.isAdmin && duration > v.maxDuration) {
    return json({ error: `길이는 ${v.maxDuration}초까지 만들 수 있습니다` }, 403);
  }

  const supabase = await supabaseServer();

  // 1) 원본을 우리 Storage 로. xAI 가 직접 내려받아야 해서 공개 URL이어야 합니다.
  //    버킷 정책이 {user_id}/ 로 시작하는 경로만 허용하므로 uid 를 앞에 둡니다.
  const ext = (image.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const srcPath = `${v.id}/sources/${Date.now()}.${ext || "png"}`;

  const { error: upErr } = await supabase.storage
    .from("works")
    .upload(srcPath, image, { contentType: image.type, upsert: false });
  if (upErr) return json({ error: `이미지 업로드 실패: ${upErr.message}` }, 500);

  const sourceUrl = supabase.storage.from("works").getPublicUrl(srcPath).data.publicUrl;

  // 2) xAI 호출. 이미지→영상에서는 비율을 생략하는 쪽이 안전합니다.
  //    원본과 다른 비율을 지정하면 잘리거나 늘어납니다. — studio-setup.md
  const payload: Record<string, unknown> = {
    model,
    prompt,
    image: { url: sourceUrl },
    duration,
    resolution,
  };
  if (aspect !== "auto") payload.aspect_ratio = aspect;

  const r = await fetch(`${XAI_BASE}/videos/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    // 올려둔 원본은 지웁니다. 시작도 못 한 요청의 파일이 쌓이면 버킷만 커집니다.
    await supabase.storage.from("works").remove([srcPath]);
    return json({ error: `xAI 오류 ${r.status}`, detail: detail.slice(0, 500) }, 502);
  }

  const d = await r.json();
  const requestId = d?.request_id ?? d?.id;
  if (!requestId) {
    await supabase.storage.from("works").remove([srcPath]);
    return json({ error: "xAI 가 request_id 를 주지 않았습니다" }, 502);
  }

  // 3) 기록. 이 행이 곧 한도 계산의 근거이기도 합니다.
  const { data: row, error: insErr } = await supabase
    .from("generations")
    .insert({
      user_id: v.id,
      request_id: String(requestId),
      status: "running",
      prompt,
      prompt_ko: promptKo || null,
      model,
      duration,
      resolution,
      source_url: sourceUrl,
      cost_usd: costOf(model, resolution, duration),
    })
    .select("id")
    .single();

  if (insErr) return json({ error: insErr.message }, 500);

  return json({ id: row.id });
}
