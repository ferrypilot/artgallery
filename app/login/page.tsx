// app/login/page.tsx
//
// 학생: 선생님이 등록해 준 주소와 초기 비밀번호로 로그인.
// 선생님: 매직링크. 팀원 주소라 메일이 정상적으로 갑니다.
//
// 학생 스스로 가입하는 길은 두지 않았습니다. Supabase 기본 메일은 조직
// 팀원이 아닌 주소로는 발송을 거부해서 확인 메일이 학생에게 닿지 않고,
// 선생님이 명단을 이미 가지고 있기 때문입니다. 계정은 스튜디오의
// 관리자 설정에서 만듭니다.
//
// 사용 중지 여부는 화면이 아니라 RLS 가 강제합니다. 중지된 계정도 로그인
// 자체는 성공하므로(세션이 발급되므로), 화면 안내만으로는 부족합니다.

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser, SUPABASE_READY } from "@/lib/supabase-browser";

type Mode = "in" | "link";
type Me = { email: string; approved: boolean; isAdmin: boolean };

export default function Login() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // 비밀번호 바꾸기 — 로그인한 뒤에만 씁니다
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // undefined = 확인 중. null = 로그인 안 함.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [back, setBack] = useState("/studio-ai.html");

  useEffect(() => {
    const n = nextPath();
    if (n !== "/") setBack(n);
  }, []);

  useEffect(() => { void refresh(); }, []);

  /** 지금 누구이고 승인됐는지는 서버가 압니다. */
  async function refresh() {
    try {
      const r = await fetch("/api/imagine/settings", { cache: "no-store" });
      if (r.status === 401) { setMe(null); return; }
      if (!r.ok) { setMe(null); return; }
      const d = await r.json();
      setMe({ email: d.email, approved: !!d.approved, isAdmin: !!d.isAdmin });
    } catch { setMe(null); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    const addr = email.trim().toLowerCase();
    if (!addr.includes("@")) { setError("이메일 주소를 확인해 주세요"); return; }

    setBusy(true); setError(null);
    try {
      if (mode === "link") {
        const { error } = await supabase.auth.signInWithOtp({
          email: addr,
          options: {
            emailRedirectTo:
              `${location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}`,
            shouldCreateUser: false,   // 매직링크로 새 계정을 만들지는 않습니다
          },
        });
        if (error) throw error;
        setSent(true);
        return;
      }

      if (!pw) { setError("비밀번호를 넣어주세요"); return; }

      const { error } = await supabase.auth.signInWithPassword({
        email: addr, password: pw,
      });
      if (error) throw error;

      await refresh();
      setPw("");
    } catch (err: any) {
      setError(translate(err?.message ?? "알 수 없는 오류"));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    location.reload();
  }

  /** 본인 비밀번호 바꾸기. 서버가 지금 비밀번호를 한 번 더 확인합니다. */
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true); setPwMsg(null);
    try {
      const r = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: pwCur, next: pwNew }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `서버 오류 ${r.status}`);
      setPwCur(""); setPwNew("");
      setPwMsg({ ok: true, text: "바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요" });
    } catch (err: any) {
      setPwMsg({ ok: false, text: err.message });
    }
    setPwBusy(false);
  }

  return (
    <main className="page">
      <div className="t-eyebrow">Generative Video Exhibition · 2026</div>
      <h1 className="t-h1" style={{ margin: "10px 0 0" }}>{me ? "내 계정" : "로그인"}</h1>

      {!SUPABASE_READY ? (
        <Notice tone="warn">
          Supabase 가 설정되지 않았습니다. <code>.env.local</code> 을 채우고
          개발 서버를 껐다 켜세요.
        </Notice>

      ) : me === undefined ? (
        <Notice>확인 중…</Notice>

      /* ── 로그인된 상태 ── */
      ) : me ? (
        <>
          <Notice tone={me.approved ? undefined : "warn"}>
            <b>{me.email}</b>
            {me.isAdmin ? " · 관리자" : me.approved ? " · 승인됨" : ""}
            {!me.approved && (
              <>
                <br />
                사용이 중지된 계정입니다. 전시장을 만들거나 영상을 만들 수
                없습니다. 선생님께 문의하세요.
              </>
            )}
          </Notice>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {me.approved && (
              <a href={back} className="btn primary" style={{ flex: 1, padding: "12px 14px", fontSize: 14 }}>
                {back === "/studio-ai.html"
                  ? "생성 스튜디오로"
                  : back.startsWith("/exhibition.html")
                    ? "Art Gallery 로 가기"
                    : "돌아가기"}
              </a>
            )}
            <button onClick={() => location.reload()} className="btn">새로고침</button>
            <button onClick={signOut} className="btn">로그아웃</button>
          </div>

          {/* 선생님이 초기화해 준 비밀번호는 누구나 아는 값입니다.
              받은 즉시 자기 것으로 바꾸라고 여기 둡니다. */}
          {!pwOpen ? (
            <button className="btn-quiet" style={{ marginTop: 18 }}
                    onClick={() => { setPwOpen(true); setPwMsg(null); }}>
              비밀번호 바꾸기
            </button>
          ) : (
            <form onSubmit={changePassword} style={{ marginTop: 22 }}>
              <hr className="hair" />
              <p className="t-help" style={{ margin: "16px 0 12px" }}>
                선생님이 초기화해 준 비밀번호는 반 전체가 아는 값입니다.
                받았다면 여기서 바꾸세요.
              </p>
              <input type="password" className="field" value={pwCur}
                     autoComplete="current-password" placeholder="지금 비밀번호"
                     onChange={(e) => setPwCur(e.target.value)} />
              <input type="password" className="field" style={{ marginTop: 8 }}
                     value={pwNew} autoComplete="new-password"
                     placeholder="새 비밀번호 (6자 이상)"
                     onChange={(e) => setPwNew(e.target.value)} />

              {pwMsg && (
                <div className={"notice" + (pwMsg.ok ? "" : " warn")}
                     style={{ margin: "12px 0 0" }}>{pwMsg.text}</div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="submit" className="btn primary" disabled={pwBusy}
                        style={{ flex: 1, padding: "12px 14px", fontSize: 14 }}>
                  {pwBusy ? "바꾸는 중…" : "바꾸기"}
                </button>
                <button type="button" className="btn"
                        onClick={() => { setPwOpen(false); setPwCur(""); setPwNew(""); setPwMsg(null); }}>
                  닫기
                </button>
              </div>
            </form>
          )}
        </>

      /* ── 매직링크를 보낸 뒤 ── */
      ) : sent ? (
        <>
          <Notice>
            <b>{email.trim().toLowerCase()}</b> 으로 링크를 보냈습니다.
            메일함을 확인하세요.
          </Notice>
          <p className="t-help" style={{ margin: "18px 0 14px" }}>
            링크는 한 번만 쓸 수 있고 한 시간쯤 뒤 만료됩니다.
            메일이 안 오면 선생님 계정이 아닌 주소일 수 있습니다 —
            학생은 아래 비밀번호 방식을 쓰세요.
          </p>
          <button onClick={() => { setSent(false); setMode("in"); }} className="btn">
            비밀번호로 로그인
          </button>
        </>

      /* ── 로그인 · 가입 ── */
      ) : (
        <form onSubmit={submit}>
          <p className="t-help" style={{ margin: "18px 0 14px" }}>
            선생님이 알려준 주소와 초기 비밀번호로 들어옵니다.
            잊어버렸으면 선생님께 초기화를 요청하세요.
          </p>

          <input
            type="email" value={email} autoFocus autoComplete="email"
            placeholder="you@example.com" className="field" style={{ marginTop: 20 }}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password" value={pw} className="field" style={{ marginTop: 8 }}
            autoComplete="current-password" placeholder="비밀번호"
            onChange={(e) => setPw(e.target.value)}
          />

          {error && <Notice tone="warn">{error}</Notice>}

          <button type="submit" disabled={busy} className="btn primary wide" style={{ marginTop: 12 }}>
            {busy ? "잠시만요…" : "로그인"}
          </button>

          {/* 선생님 전용. 학생 주소로는 메일이 가지 않습니다. */}
          <button type="button" className="btn-quiet" style={{ display: "block", width: "100%", marginTop: 14 }}
            onClick={() => { setMode("link"); setError(null); }}>
            선생님이신가요? 메일 링크로 로그인
          </button>

          {mode === "link" && (
            <Notice>
              위 주소로 접속 링크를 보냅니다. 비밀번호는 쓰지 않습니다.
              {" "}
              <button type="submit" className="btn-quiet" style={{ color: "var(--ink)", fontSize: 13 }} disabled={busy}>
                {busy ? "보내는 중…" : "링크 보내기"}
              </button>
            </Notice>
          )}
        </form>
      )}

      <div style={{ display: "flex", gap: 18, marginTop: 40, paddingTop: 18, borderTop: "1px solid var(--hair)" }}>
        <a href="/" className="t-help" style={{ textDecoration: "none" }}>← 안내 화면</a>
        <a href="/exhibition.html" className="t-help" style={{ textDecoration: "none" }}>전시장 둘러보기</a>
      </div>
    </main>
  );
}

/** ?next=/exhibition.html 처럼 돌아갈 곳. 같은 사이트 안의 경로만 허용합니다
 *  — 외부 주소를 받으면 로그인 링크가 남의 사이트로 사람을 보내는 데
 *  쓰일 수 있습니다. */
function nextPath() {
  const raw = new URLSearchParams(location.search).get("next") ?? "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

/** Supabase 의 영문 오류 중 학생이 자주 보는 것만 우리말로 */
function translate(m: string) {
  if (/Invalid login credentials/i.test(m)) {
    return "주소나 비밀번호가 맞지 않습니다. 선생님이 등록해 준 주소인지 확인하세요";
  }
  if (/Email not confirmed/i.test(m)) {
    return "확인되지 않은 계정입니다. 선생님께 비밀번호 초기화를 요청하세요";
  }
  if (/rate limit|Too many/i.test(m)) return "잠시 뒤에 다시 시도해 주세요";
  return m;
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={"notice" + (tone === "warn" ? " warn" : "")}
         style={{ margin: "18px 0" }}>
      {children}
    </div>
  );
}

