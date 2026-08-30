// app/api/galleries/layout/route.ts
//
// 전시장에 놓은 가구.
//
//   PUT { handle, layout: [{t,x,z,r}, …]   통째로 바꿔치기
//
// 왜 한 점씩 더하고 빼지 않고 배열 전체를 보내나 — 가구는 많아야 여덟
// 개입니다. 한 점씩 주고받으면 순서와 번호를 맞추는 일이 생기는데,
// 통째로 보내면 화면에 보이는 것이 곧 저장된 것입니다. 여럿이 동시에
// 고치는 화면도 아닙니다(주인과 선생님만 고칩니다).
//
// 권한은 여기서 세지 않습니다. RLS 의 "주인과 관리자만 수정한다" 가
// 실제 차단선이고, 막히면 0행 수정으로 오는 것을 403 으로 바꿉니다.

import { supabaseServer } from "@/lib/supabase";
import { loadViewer, json } from "@/lib/imagine";
import { cleanLayout } from "@/lib/furniture";

const HANDLE = /^[a-z0-9-]{2,20}$/;

export async function PUT(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "본문을 읽지 못했습니다" }, 400);

  const handle = String(body.handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return json({ error: "주소가 올바르지 않습니다" }, 400);

  const layout = cleanLayout(body.layout);
  if ("error" in layout) return json({ error: layout.error }, 400);

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("galleries")
    .update({ layout })
    .eq("handle", handle)
    .select("handle");

  if (error) return json({ error: error.message }, 500);
  if (!data || !data.length) {
    return json({ error: "고칠 권한이 없거나 없는 전시장입니다" }, 403);
  }
  // 걸러낸 뒤의 목록을 돌려줍니다. 화면이 저장된 것과 같은 것을 들고
  // 있어야 다음에 보낼 때 어긋나지 않습니다.
  return json({ ok: true, layout });
}
