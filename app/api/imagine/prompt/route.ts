// app/api/imagine/prompt/route.ts
//
// 학생이 쓴 한국어 한 줄을 영문 모션 프롬프트로 옮깁니다.
// 텍스트 모델 호출 한 번이라 사실상 공짜인 반면, 재시도 한 번은
// 영상 생성 한 번 값이 그대로 듭니다. 이 단계가 재시도를 한 번만
// 줄여도 본전을 넘깁니다. — studio-setup.md
//
// 결과는 학생에게 그대로 보여주고 고치게 합니다. 무엇이 전송되는지
// 감추지 않는 것이 이 화면의 요점입니다.

import { loadViewer, json, XAI_BASE } from "@/lib/imagine";

const SYSTEM = `You turn a Korean student's one-line wish into an English motion prompt
for an image-to-video model.

The still image is already given, so do NOT describe what the picture contains.
Describe only what MOVES and how the CAMERA behaves.

Rules:
- English only. One paragraph, 2-3 sentences, under 60 words.
- Name the moving subject, the direction and the speed ("slowly", "gently", "drifting").
- Add one camera instruction (static, slow push in, slow pan left, subtle handheld).
- Keep the original artwork's mood. Do not add objects, people or text that are not there.
- No style words like "4k", "masterpiece", "cinematic lighting". They do nothing here.
- Output the prompt only. No quotes, no preamble, no explanation.`;

export async function POST(request: Request) {
  const v = await loadViewer();
  if (!v) return json({ error: "로그인이 필요합니다" }, 401);

  const key = process.env.XAI_API_KEY;
  if (!key) return json({ error: "XAI_API_KEY 가 설정되지 않았습니다" }, 500);

  const body = await request.json().catch(() => null);
  const ko = String(body?.ko ?? "").trim().slice(0, 500);
  if (!ko) return json({ error: "한국어 메모가 비어 있습니다" }, 400);

  const duration = clamp(Number(body?.duration) || 6, 1, 15);

  const r = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      // 모델 이름은 자주 바뀝니다. 환경변수로 빼둔 이유입니다.
      model: process.env.XAI_TEXT_MODEL || "grok-4-1-fast-non-reasoning",
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `The clip is ${duration} seconds long, so keep the motion to a single ` +
            `continuous action that fits in that time.\n\nStudent's note (Korean): ${ko}`,
        },
      ],
    }),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    // 대개 XAI_TEXT_MODEL 이름이 틀렸을 때입니다. xAI 콘솔의 모델 목록과 대조하세요.
    return json({ error: `xAI 오류 ${r.status}`, detail: detail.slice(0, 500) }, 502);
  }

  const d = await r.json();
  const prompt = String(d?.choices?.[0]?.message?.content ?? "").trim();
  if (!prompt) return json({ error: "빈 응답이 왔습니다" }, 502);

  return json({ prompt });
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
