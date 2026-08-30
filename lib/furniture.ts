// lib/furniture.ts
//
// 전시장에 놓는 가구. 여기에는 종류 이름과 상한만 둡니다 — 생김새와
// 충돌 반지름은 화면 쪽 public/exhibition.html 의 FURNITURE 표에 있습니다.
// 두 표의 열쇠(key)가 같아야 합니다.
//
// 놓은 것은 galleries.layout 에 배열 통째로 들어갑니다. theme 에 얹지
// 않은 이유 — theme 은 "보이는 톤"(벽색·바닥색·대표 이미지·전시관)이고
// 이건 늘어나는 목록이라 성격이 다릅니다. 한 칸에 몰아두면 색 하나
// 저장할 때마다 가구 배열 전체가 실려 다니게 됩니다.

export const FURNITURE = {
  bench: "벤치",
  sofa: "소파",
  table: "낮은 테이블",
  stool: "스툴",
  plant: "화분",
  stand: "안내대",
} as const;

export type FurnitureKind = keyof typeof FURNITURE;
export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];

/** 한 전시장에 놓을 수 있는 개수. 스무 명이 각자 소파를 놓으면 전시장이
 *  아니라 창고가 됩니다. 화면에서도 이 수를 넘으면 더 놓지 못합니다. */
export const MAX_FURNITURE = 8;

export type Piece = { t: FurnitureKind; x: number; z: number; r: number };

function isKind(v: unknown): v is FurnitureKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(FURNITURE, v);
}

/**
 * 받은 배열을 그대로 믿지 않고 다시 씁니다. 모르는 열쇠와 남는 칸을
 * 떨어내고, 좌표는 방보다 넉넉한 한도 안으로 자릅니다 — 화면이 이미
 * 벽 안으로 잘라 보내지만, 서버가 화면을 믿을 이유는 없습니다.
 *
 * 잘못된 한 칸 때문에 전부를 되돌리지는 않습니다. 걸러내고 나머지를
 * 저장하는 편이 학생에게 덜 잔인합니다.
 */
export function cleanLayout(v: unknown): Piece[] | { error: string } {
  if (!Array.isArray(v)) return { error: "가구 목록이 배열이 아닙니다" };
  if (v.length > MAX_FURNITURE * 2) return { error: "가구가 너무 많습니다" };

  const out: Piece[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (!isKind(p.t)) continue;
    const x = Number(p.x), z = Number(p.z), r = Number(p.r);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r)) continue;
    out.push({
      t: p.t,
      x: round(clamp(x, -40, 40)),
      z: round(clamp(z, -40, 40)),
      // 방향은 한 바퀴 안으로 접습니다. 3600도 같은 값이 쌓이지 않게.
      r: round(((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)),
    });
    if (out.length >= MAX_FURNITURE) break;
  }
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 1000) / 1000;
