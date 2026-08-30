// app/page.tsx
//
// 임시 안내 화면. 프로토타입 HTML 로 가는 입구이고,
// 서버가 제대로 붙었는지도 여기서 확인합니다.
// 로비를 React 로 포팅하면 이 파일이 그 자리를 대신합니다.
//
// 색과 글꼴은 여기 적지 않습니다. public/theme.css 가 사이트 표준이고,
// 이 파일은 그 클래스만 씁니다 — .page / .t-h1 / .btn / .notice.

"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; note: string; needsLogin?: boolean };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/imagine/settings")
      .then(async (r) => {
        if (r.status === 401) {
          return { ok: true, note: "서버 연결됨 · 아직 로그인 전입니다", needsLogin: true };
        }
        if (!r.ok) {
          // 서버가 이유를 적어 보내면 그대로 보여줍니다. "서버 오류 503" 만으로는
          // .env.local 을 안 만든 것인지 Supabase 가 죽은 것인지 알 수 없습니다.
          const d = await r.json().catch(() => null);
          return { ok: false, note: d?.error ?? `서버 오류 ${r.status}` };
        }
        const d = await r.json();
        const role = d.isAdmin ? " · 관리자" : d.isTeacher ? " · 선생님" : "";
        return { ok: true, note: `${d.email} · 한도 ${d.used}/${d.quota}개${role}` };
      })
      .catch(() => ({ ok: false, note: "서버에 연결하지 못했습니다" }))
      .then(setHealth);
  }, []);

  return (
    <>
      <div className="bg-photo" aria-hidden="true" />
      <main className="page">
      <div className="t-eyebrow copy">Copyright © 2026 Kang SongWeol</div>
      <h1 className="t-h1" style={{ margin: "10px 0 0" }}>서울온라인학교의 Art Gallery</h1>

      <div className={"notice" + (health?.ok === false ? " warn" : "")}
           style={{ marginTop: 24 }}>
        {health ? health.note : "서버 확인 중…"}
        {health?.needsLogin && <> · <a href="/login">로그인하기</a></>}
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 26 }}>
        <Door href="/exhibition.html" title="전시장"
              note="로비에서 학생 전시장을 고르고 문을 열어 들어갑니다" />
        <Door href="/studio-ai.html" title="생성 스튜디오"
              note="이미지와 프롬프트로 짧은 영상을 만듭니다 · Grok Imagine" />
      </div>
      </main>
    </>
  );
}

/** 두 프로토타입으로 가는 입구. 카드 하나가 곧 한 화면입니다. */
function Door({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <a href={href} className="card"
       style={{ display: "block", padding: "20px 22px", textDecoration: "none" }}>
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}>{title}</div>
      <div className="t-help" style={{ marginTop: 6 }}>{note}</div>
    </a>
  );
}
