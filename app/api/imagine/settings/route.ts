// app/api/imagine/settings/route.ts
//
// GET  — 스튜디오가 열릴 때 한 번. 이 응답이 안 오면 화면이 데모 모드로 떨어집니다.
//        page.tsx 의 서버 확인도 이 라우트를 씁니다.
// POST — 관리자만. 한도와 허용 범위를 바꿉니다.
//
// 화면의 자물쇠는 안내입니다. 실제 차단은 여기와 POST /api/imagine 에서 합니다.

import { supabaseServer, SUPABASE_READY } from "@/lib/supabase";
import { loadViewer, json, HARD_MAX_DURATION } from "@/lib/imagine";

type Override = { email: string; quota: number };

export async function GET() {
  // 로그인 전(401)과 설정이 아예 없는 것(503)을 구분합니다.
  // 둘을 뭉뚱그리면 .env.local 을 안 만든 것이 "로그인하세요"로 보입니다.
  if (!SUPABASE_READY) {
    return json({ error: "Supabase 가 설정되지 않았습니다 — .env.local 을 만드세요" }, 503);
  }

  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const supabase = await supabaseServer();

  // 예외 목록은 관리자 화면에서만 씁니다. 학생에게는 반 전체 명단을 주지 않습니다.
  let overrides: Override[] = [];
  if (v.isAdmin) {
    const { data } = await supabase
      .from("user_limits").select("email, quota").order("email");
    overrides = data ?? [];
  }

  return json({
    email: v.email,
    // 전시장이 이 둘을 받아 관람자 이름·캐릭터를 미리 채웁니다.
    name: v.name,
    avatarType: v.avatarType,
    quota: v.quota,
    used: v.used,
    resolutions: v.resolutions,
    models: v.models,
    maxDuration: v.maxDuration,
    hardMaxDuration: HARD_MAX_DURATION,
    isAdmin: v.isAdmin,
    isTeacher: v.isTeacher,
    approved: v.approved,
    overrides,
  });
}

export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);
  if (!v.isAdmin) return json({ error: "관리자만 바꿀 수 있습니다" }, 403);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const quota = Number(body.quota);
  if (!Number.isInteger(quota) || quota < 0 || quota > 10000) {
    return json({ error: "한도는 0~10000 사이의 정수여야 합니다" }, 400);
  }

  const resolutions = asStringArray(body.resolutions);
  const models = asStringArray(body.models);
  if (!resolutions.length || !models.length) {
    return json({ error: "화질과 모델을 하나 이상 열어두어야 합니다" }, 400);
  }

  const maxDuration = Number(body.maxDuration);
  if (!Number.isInteger(maxDuration) || maxDuration < 1 || maxDuration > HARD_MAX_DURATION) {
    return json({ error: `학생 최대 길이는 1~${HARD_MAX_DURATION}초입니다` }, 400);
  }

  const supabase = await supabaseServer();

  const { error: sErr } = await supabase.from("app_settings").upsert({
    id: 1, quota, resolutions, models, max_duration: maxDuration,
    updated_by: v.id, updated_at: new Date().toISOString(),
  });
  // RLS 가 막으면 여기서 잡힙니다. profiles.is_admin 이 실제로 true 인지 보세요.
  if (sErr) return json({ error: sErr.message }, 403);

  // 예외 목록은 화면에 보이는 것이 전부입니다. 빠진 줄은 지웁니다.
  const rows: any[] = Array.isArray(body.overrides) ? body.overrides : [];
  const clean: Override[] = rows
    .map((o: any) => ({
      email: String(o?.email ?? "").trim().toLowerCase(),
      quota: Number(o?.quota),
    }))
    .filter((o: Override) =>
      o.email.includes("@") && Number.isInteger(o.quota) && o.quota >= 0);

  const keep = clean.map((o: Override) => o.email);
  const del = supabase.from("user_limits").delete();
  const { error: dErr } = keep.length
    ? await del.not("email", "in", `(${keep.map((e: string) => `"${e}"`).join(",")})`)
    : await del.neq("email", "");
  if (dErr) return json({ error: dErr.message }, 403);

  if (clean.length) {
    const { error: uErr } = await supabase.from("user_limits").upsert(clean);
    if (uErr) return json({ error: uErr.message }, 403);
  }

  return json({ ok: true });
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x)).filter(Boolean))];
}
