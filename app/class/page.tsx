// app/class/page.tsx
//
// 전시장 수업 안내.
//
// 처음 들어온 학생이 가장 먼저 막히는 곳은 "뭘 어디서부터 하면 되는지"
// 입니다. 전시장과 스튜디오는 각각 잘 만들어져 있지만 둘을 잇는 순서가
// 어디에도 적혀 있지 않았습니다. 이 화면이 그 순서입니다.
//
// 로그인 없이 열립니다 — 수업 시간에 띄워놓고 같이 읽는 화면이고,
// 읽기 전에 로그인부터 하라고 하면 그 자리에서 막힙니다.
//
// 색과 글꼴은 여기 적지 않습니다. public/theme.css 가 사이트 표준이고
// 이 파일은 그 클래스만 씁니다.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "전시장 수업 · 강송월의 Art Gallery",
  description: "그린 그림을 짧은 영상으로 만들어 내 전시실에 거는 수업",
};

/* 수업 전시장으로 바로 들어가는 길.

   명단은 여기 적지 않습니다. public/exhibition.html 의 CLASS 한 곳에만 두고,
   이 화면은 "수업 쪽으로 열어달라"고만 말합니다 — 두 곳에 적어두면 반이
   바뀔 때 한 곳만 고치고 넘어가게 됩니다. */
const CLASS_URL = "/exhibition.html?class=1";

/** 한 단계. 번호와 제목, 그리고 그 단계에서 실제로 누르는 것들. */
function Step({ n, title, children }:
  { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className="t-mono"
              style={{ fontSize: 12, color: "var(--faint)", flex: "none" }}>
          {String(n).padStart(2, "0")}
        </span>
        <h2 className="t-h2" style={{ margin: 0 }}>{title}</h2>
      </div>
      <div className="t-body" style={{ marginTop: 9 }}>{children}</div>
    </section>
  );
}

/** 키 한 줄. 왼쪽은 누르는 것, 오른쪽은 일어나는 일. */
function Key({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "7px 0",
                  borderTop: "1px solid var(--hair)" }}>
      <span className="t-mono"
            style={{ flex: "none", width: 116, fontSize: 12.5, color: "var(--ink)" }}>
        {k}
      </span>
      <span className="t-help" style={{ margin: 0 }}>{children}</span>
    </div>
  );
}

export default function ClassPage() {
  return (
    <>
      <div className="bg-photo long" aria-hidden="true" />
      <main className="page">
        <div className="t-eyebrow copy">강송월의 <span className="gal">Art Gallery</span></div>
        <h1 className="t-h1" style={{ margin: "10px 0 0" }}>전시장 수업</h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          내가 그린 그림을 짧은 영상으로 만들고, 그 영상을 내 전시실 벽에 거는 수업입니다.
          아래 차례대로 따라오면 전시 하나가 완성됩니다.
        </p>

        {/* 수업에서 함께 보는 전시장. 읽기 전에 눈으로 먼저 보는 쪽이
            순서가 맞아서, 안내 단계보다 위에 둡니다. */}
        <a href={CLASS_URL} className="btn primary wide"
           style={{ textDecoration: "none", justifyContent: "center", marginTop: 22 }}>
          전시장 수업
        </a>
        <p className="t-help" style={{ marginTop: 8 }}>
          이번 수업에서 함께 보는 학생 전시장이 열립니다.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 26 }}>
          <Step n={1} title="로그인">
            학교에서 받은 계정으로 <a href="/login">로그인</a>합니다. 전시장을 만들고
            작품을 거는 일은 로그인한 사람만 할 수 있습니다.
            <br />
            <b>관람은 로그인 없이</b> 누구나 할 수 있습니다 — 친구에게 주소만 알려주면 됩니다.
          </Step>

          <Step n={2} title="내 전시장 만들기">
            로비에서 <b>＋ 전시장 만들기</b>를 누릅니다. 적는 것은 네 가지입니다.
            <br />
            <b>학생 이름 · 전시 제목 · 주소</b>(영문 소문자·숫자, 예: <span className="t-mono">seoyeon</span>)
            <b> · 전시실</b>.
            <br />
            전시실은 창밖 풍경이 다른 네 곳 가운데 고릅니다 —
            빈 · 로마 · 피렌체 · 파리. 네 곳 모두 작품을 <b>21점</b>까지 걸 수 있고,
            만든 뒤에도 전시 설정에서 바꿀 수 있습니다.
          </Step>

          <Step n={3} title="영상 만들기">
            <a href="/studio-ai.html">생성 스튜디오</a>에서 그린 그림을 올리고, 어떻게
            움직였으면 좋겠는지 한국어로 적습니다. 몇 분 뒤 짧은 영상이 나옵니다.
            <br />
            잘 나오지 않으면 설명을 바꿔 다시 만들어 보세요. 만든 영상은 모두 남아 있어서
            그 중에 골라 걸면 됩니다.
          </Step>

          <Step n={4} title="작품 걸기">
            전시실에 들어가 <b>빈 자리</b>를 바라보고 누릅니다
            (「○번 자리에 작품 걸기」가 뜹니다). 작품에서 <b>10m 안</b>이면 닿습니다.
            <br />
            걸 수 있는 것은 두 가지입니다 — <b>만든 영상·그림 파일</b>을 올리거나,
            <b>유튜브 링크</b>를 붙입니다. 제목과 한 줄 설명도 함께 적습니다.
            <br />
            걸린 작품을 누르면 창이 열려 <b>크게</b> 볼 수 있습니다.
          </Step>

          <Step n={5} title="전시실 꾸미기">
            오른쪽 위 <b>전시 설정</b>에서 바꿉니다 — 전시관(창밖 풍경) · 전시실 분위기 ·
            벽과 바닥 색 · 바닥 마감 · 거실 가구 · 로비 카드에 걸리는 대표 이미지 ·
            전시 제목과 학생 이름.
            <br />
            작품을 바라본 채 <span className="t-mono">[</span> <span className="t-mono">]</span> 키로
            크기를(60~200%), <span className="t-mono">Shift+방향키</span>로 벽에서의 자리를 옮깁니다.
          </Step>

          <Step n={6} title="전시 기획서와 방명록">
            <b>전시 기획서</b>는 이 전시가 무엇을 하려는 것인지 적은 문서입니다.
            전시 설정 → 전시 기획서에서 제목과 문서 주소를 올리면, 방명록 판 아래에 걸리고
            누구나 눌러서 열어볼 수 있습니다. <b>올리는 사람은 전시장 주인뿐</b>입니다.
            <br />
            <b>방명록</b>은 반대입니다 — 다녀간 사람이면 누구나 한 줄 남길 수 있습니다.
            벽에 걸린 판을 누르거나 <span className="t-mono">G</span> 키를 누르세요.
          </Step>
        </div>

        <h2 className="t-h2" style={{ margin: "34px 0 4px" }}>전시실 안에서 쓰는 키</h2>
        <div className="card" style={{ padding: "6px 20px 14px" }}>
          <Key k="마우스 드래그">둘러보기</Key>
          <Key k="바닥 클릭">그 자리로 걸어가기</Key>
          <Key k="W A S D">걷기</Key>
          <Key k="작품 클릭">크게 보기</Key>
          <Key k="V">1인칭 ↔ 3인칭</Key>
          <Key k="G">방명록</Key>
          <Key k="E">작품 바꾸기 (주인만)</Key>
          <Key k="[ ]">작품 크기 (주인만)</Key>
          <Key k="Shift+방향키">작품 자리 옮기기 (주인만)</Key>
          <Key k="ESC">창 닫기 · 커서 되찾기</Key>
        </div>

        <div className="notice info" style={{ marginTop: 22 }}>
          막히면 선생님께 말씀하세요. 작품은 지워도 생성 스튜디오에 그대로 남아 있어서
          다시 걸 수 있습니다.
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 26 }}>
          <a href="/" className="btn-quiet" style={{ textAlign: "center", padding: "4px 0" }}>
            처음 화면으로
          </a>
        </div>
      </main>
    </>
  );
}
