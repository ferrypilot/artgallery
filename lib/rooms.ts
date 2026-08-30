// lib/rooms.ts
//
// 전시관 종류. 여기에는 자리 수와 자리 이름만 둡니다 — 벽 좌표는 화면 쪽
// public/exhibition.html 의 ROOMS 표에 있습니다.
//
// 두 표는 자리 순서가 같아야 합니다. 여기 slots[n] 의 이름이 저기
// slots[n] 의 좌표입니다. 한쪽만 고치면 학생이 "정면 벽 3" 에 걸었는데
// 엉뚱한 벽에 걸리거나, 있지도 않은 자리에 걸립니다. 방을 새로 만들 때는
// 두 표를 함께 고치세요.
//
// 어느 방을 쓰는지는 galleries.theme.room 에 적습니다. 대표 이미지(cover)와
// 같은 방식입니다 — theme 이 jsonb 라 컬럼을 새로 만들 필요가 없고,
// /api/galleries 와 백업이 theme 를 통째로 내보내므로 화면과 오프라인
// 전시가 저절로 따라옵니다.

export const ROOMS = {
  // 지금은 이 방 하나뿐입니다. 예전에는 10자리짜리 "기본 전시실" 이 함께
  // 있었지만 아무도 고르지 않아 걷어냈습니다. 방을 다시 늘리려면 여기에
  // 한 줄, exhibition.html 의 ROOMS 에 좌표 한 줄을 같은 순서로 더합니다.
  grand: {
    name: "큰 전시실",
    note: "작품 20점 · 가벽 둘 · 네 벽을 모두 씁니다",
    slots: [
      "왼쪽 벽 1 (안쪽)", "왼쪽 벽 2", "왼쪽 벽 3", "왼쪽 벽 4 (입구 쪽)",
      "오른쪽 벽 1 (안쪽)", "오른쪽 벽 2", "오른쪽 벽 3", "오른쪽 벽 4 (입구 쪽)",
      "정면 벽 1 (왼쪽)", "정면 벽 2", "정면 벽 3 (가운데)", "정면 벽 4", "정면 벽 5 (오른쪽)",
      "입구 쪽 벽 왼쪽", "입구 쪽 벽 왼쪽 안", "입구 쪽 벽 오른쪽",
      "왼쪽 가벽 앞", "왼쪽 가벽 뒤",
      "오른쪽 가벽 앞", "오른쪽 가벽 뒤",
    ],
  },
} as const;

export type RoomName = keyof typeof ROOMS;
export const DEFAULT_ROOM: RoomName = "grand";
export const ROOM_NAMES = Object.keys(ROOMS) as RoomName[];

/** 자리 번호가 가장 많은 방의 자리 수. DB 의 works.slot 제약과 같아야
 *  합니다 — schema.sql 의 `check (slot between 0 and 19)`. */
export const MAX_SLOTS = Math.max(...ROOM_NAMES.map((r) => ROOMS[r].slots.length));

export function isRoomName(v: unknown): v is RoomName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ROOMS, v);
}

/** 전시장의 theme 에서 방을 읽습니다. 모르는 이름이면 기본 방입니다 —
 *  손으로 고친 값 하나가 전시장을 통째로 못 열게 만들지 않도록.
 *  없어진 "hall" 이 남아 있는 예전 전시장도 이 규칙으로 흡수됩니다. */
export function roomOf(theme: unknown) {
  const r = (theme as { room?: unknown } | null)?.room;
  return ROOMS[isRoomName(r) ? r : DEFAULT_ROOM];
}

export const slotCount = (theme: unknown) => roomOf(theme).slots.length;
