// lib/imagine.ts
//
// 생성 라우트 네 개가 함께 쓰는 것들.
// 화면(studio-ai.html)에도 같은 표가 있지만, 저쪽은 안내이고
// 이쪽이 실제 차단선입니다. 값을 바꿀 때 두 곳을 같이 보세요.

import { supabaseServer, SUPABASE_READY } from "@/lib/supabase";

export const XAI_BASE = "https://api.x.ai/v1";

/** xAI 문서 기준 (2026-08). 화질별 초당 단가는 요금표가 바뀌면 같이 고치세요. */
export const MODELS: Record<string, { res: string[]; rate: Record<string, number> }> = {
  "grok-imagine-video": {
    res: ["480p", "720p"],
    rate: { "480p": 0.05, "720p": 0.07 },
  },
  "grok-imagine-video-1.5": {
    res: ["480p", "720p", "1080p"],
    rate: { "480p": 0.08, "720p": 0.08, "1080p": 0.08 },
  },
};

export const IMAGE_IN = 0.002;          // 입력 이미지 한 장 값
export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export function costOf(model: string, resolution: string, duration: number) {
  const rate = MODELS[model]?.rate[resolution] ?? 0;
  return rate * duration + IMAGE_IN;
}

// Supabase 무료 저장 1GB 에 맞춘 값입니다.
// 학생 30명 × 10편 × 약 1MB ≈ 300MB. 원본은 생성 후 지웁니다.
// 재시도 통계를 보고 관리자 화면에서 올리세요.
const DEFAULTS = {
  quota: 10,
  resolutions: ["480p"],
  models: ["grok-imagine-video"],
  // 비용이 초당으로 붙습니다. 길이가 사실상 예산 손잡이라 짧게 잡았습니다.
  maxDuration: 5,
};

/** xAI 가 한 번에 만들 수 있는 상한. 이보다 길게는 관리자도 못 받습니다. */
export const HARD_MAX_DURATION = 15;

export type Viewer = {
  id: string;
  email: string;
  isAdmin: boolean;
  /**
   * 학생 계정만 관리하는 선생님. 관리자는 항상 true — 상위 집합입니다.
   * 한도·화질·모델·길이(=예산)는 관리자만 바꿉니다.
   *
   * 이 값은 profiles 가 아니라 auth 쪽 app_metadata.role 에 있습니다.
   * 이유가 두 가지입니다.
   *   1. 컬럼을 새로 만들지 않아도 되어, SQL 을 돌리지 않고 바로 씁니다.
   *   2. app_metadata 는 서버(service_role)만 쓸 수 있습니다. 학생이
   *      자기 토큰을 고쳐 선생님이 되는 길이 없습니다.
   *      (user_metadata 는 본인이 고칠 수 있으니 절대 쓰지 마세요.)
   *
   * 지정: Supabase 대시보드 → Authentication → 사용자 → App Metadata 에
   *       {"role":"teacher"} 를 넣거나, README 6-1 의 명령을 쓰세요.
   */
  isTeacher: boolean;
  /** 선생님이 승인했는가. 관리자는 항상 true. */
  approved: boolean;
  quota: number;
  used: number;
  resolutions: string[];
  models: string[];
  maxDuration: number;
};

/**
 * 로그인한 사람과 그 사람에게 적용되는 한도를 한 번에 읽습니다.
 * 로그인하지 않았으면 null — 부르는 쪽에서 401 을 냅니다.
 *
 * app_settings 가 비어 있어도(마이그레이션 전) 기본값으로 동작하게 두었습니다.
 * 여기서 던지면 스튜디오가 통째로 데모 모드로 떨어져서 원인이 안 보입니다.
 */
export async function loadViewer(): Promise<Viewer | null> {
  if (!SUPABASE_READY) return null;      // .env.local 이 아직 없는 상태
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const email = (user.email ?? "").toLowerCase();

  const [profile, settings, override, used] = await Promise.all([
    // 컬럼을 하나씩 적지 않고 행을 통째로 받습니다. is_teacher 는 나중에
    // 추가된 칸이라, 아직 schema.sql 을 다시 돌리지 않은 데이터베이스에서
    // 이름을 찍어 조회하면 PostgREST 가 통째로 거절합니다. 그러면 profile 이
    // null 이 되어 관리자까지 학생으로 떨어집니다. 한 줄짜리 조회라
    // 통째로 받는 값이 쌉니다.
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("app_settings")
      .select("quota, resolutions, models, max_duration").eq("id", 1).maybeSingle(),
    supabase.from("user_limits").select("quota").eq("email", email).maybeSingle(),
    // 실패한 생성은 과금되지 않으므로 한도에서도 빼줍니다.
    supabase.from("generations").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).neq("status", "failed"),
  ]);

  const isAdmin = profile.data?.is_admin === true;
  const role = (user.app_metadata as { role?: string } | null)?.role;

  return {
    id: user.id,
    email,
    isAdmin,
    isTeacher: isAdmin || role === "teacher",
    approved: isAdmin || profile.data?.approved === true,
    // 학생별 예외가 있으면 그것이 전체 기본값을 이깁니다.
    quota: override.data?.quota ?? settings.data?.quota ?? DEFAULTS.quota,
    used: used.count ?? 0,
    resolutions: settings.data?.resolutions ?? DEFAULTS.resolutions,
    models: settings.data?.models ?? DEFAULTS.models,
    maxDuration: settings.data?.max_duration ?? DEFAULTS.maxDuration,
  };
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}
