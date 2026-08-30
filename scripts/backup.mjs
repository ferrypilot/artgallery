// scripts/backup.mjs
//
// 전시를 통째로 내 PC 에 내려받습니다. 결과 폴더는 그대로 전시장입니다.
//
//   npm run backup                          기본 위치(backup/전시-날짜)
//   npm run backup -- --check               안 받은 게 몇 편인지만 보기
//   npm run backup -- --out "D:\전시"       이번만 다른 곳에
//
// 늘 같은 곳에 두려면 .env.local 에 한 줄 적어두세요. 구글 드라이브
// 폴더를 적으면 받는 즉시 클라우드로 올라갑니다.
//
//   BACKUP_DIR=G:\내 드라이브\전시보관
//
// 만들어지는 것
//
//   <out>/
//   ├─ exhibition.html          전시장
//   ├─ theme.css                화면 표준 — 글꼴·색
//   ├─ exhibition.json          걸린 작품 목록 (src 가 상대 경로로 바뀝니다)
//   ├─ vendor/three.min.js      3D 라이브러리
//   ├─ students/<이름>/*.mp4    학생별 영상 전부
//   ├─ archive.json             누가·언제·무엇을 만들었는지 전부
//   └─ 읽어보세요.txt            몇 달 뒤 이 폴더를 다시 열 사람을 위해
//
// 이 폴더에서 `npx serve .` 하면 인터넷 없이 열립니다. — OFFLINE.md
//
// ── 왜 학생별로 전부 받는가 ────────────────────────────────
// 예전에는 전시장에 **걸린** 작품만 받았습니다. 그런데 학생이 만든 영상
// 대부분은 아직 걸려 있지 않습니다(고르는 중이거나, 자리가 열 개뿐이라).
// 그것들은 백업에 담기지 않았고, Supabase 가 멈추면 그대로 사라졌습니다.
// 무료 플랜은 오래 놀리면 프로젝트를 재우고, 저장 1GB 를 넘겨도 막힙니다.
//
// 지금은 만든 것을 전부 받습니다. 이 폴더 하나가 학기 전체의 사본입니다.
//
// SUPABASE_SERVICE_ROLE_KEY 가 있으면 학생 전원의 것을 받습니다. 없으면
// 공개 전시장에 걸린 것만 받고 그렇다고 알려줍니다 — 조용히 절반만
// 받아두면 백업이 있다고 믿게 되는 쪽이 더 위험합니다.

import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync,
         copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- 인자 ---------- */
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const stamp = new Date().toISOString().slice(0, 10);

/* ---------- .env.local 에서 Supabase 주소 읽기 ---------- */
function env() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) die(".env.local 이 없습니다.");
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** 중단 사유를 담은 오류. main() 이 받아서 깔끔하게 끝냅니다.
 *
 *  process.exit() 를 바로 부르면 안 됩니다. fetch 핸들이 살아 있는 상태에서
 *  강제 종료하면 Windows 에서 libuv 가 죽습니다
 *  (Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)). */
class Stop extends Error {}
function die(msg) { throw new Stop(msg); }

async function main() {

const E = env();

/* ---------- 어디에 저장할까 ----------
   찾는 순서: --out 인자 → .env.local 의 BACKUP_DIR → 프로젝트의 backup/
   BACKUP_DIR 을 구글 드라이브 폴더로 두면(드라이브 데스크톱이 만드는
   G:\내 드라이브\... 같은 경로) 받는 즉시 클라우드로 올라갑니다.
   한글과 공백이 든 경로도 그대로 됩니다 — 따옴표로 감싸기만 하세요. */
const told = (outArg >= 0 && argv[outArg + 1]) ? argv[outArg + 1] : (E.BACKUP_DIR || "");
const BASE = told || join(ROOT, "backup");
// --out 으로 정확한 폴더를 지정했으면 그대로 쓰고, 아니면 날짜 폴더를 만듭니다.
const OUT = resolve(outArg >= 0 && argv[outArg + 1] ? BASE
                                                    : join(BASE, `전시-${stamp}`));

/* 저장할 곳이 정말 있는지는 **지정했을 때만** 봅니다.
   기본 위치(프로젝트의 backup/)는 첫 실행 때 없는 것이 정상이라 그냥
   만들면 됩니다. 반면 사람이 적어준 경로가 없다는 것은 오타이거나
   구글 드라이브가 꺼져 있다는 뜻이고, 그때는 만들어 버리면 안 됩니다 —
   드라이브가 꺼진 채로 로컬에 엉뚱한 폴더가 생기고, 올라간 줄 알게 됩니다. */
if (told && !existsSync(dirname(OUT))) {
  die(`저장할 곳이 없습니다: ${dirname(OUT)}
` +
      `  경로를 다시 보세요. 구글 드라이브라면 드라이브 데스크톱이 켜져 있어야 합니다.`);
}

const URL_ = E.NEXT_PUBLIC_SUPABASE_URL;
const KEY = E.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) die(".env.local 에 Supabase 주소와 키가 없습니다.");

/* ---------- 목록 받기 ---------- */
// 앱 서버가 떠 있지 않아도 되도록 Supabase 를 직접 부릅니다.
const SVC = E.SUPABASE_SERVICE_ROLE_KEY || "";
const AUTH = SVC
  ? { apikey: SVC, Authorization: `Bearer ${SVC}` }     // 전원 · 비공개 포함
  : { apikey: KEY, Authorization: `Bearer ${KEY}` };    // 공개된 것만

async function get(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: AUTH });
  if (!r.ok) die(`${path} 을 받지 못했습니다 (HTTP ${r.status}) — ${await r.text()}`);
  return r.json();
}

console.log(SVC ? "전원의 작업을 받습니다." :
  "⚠ SUPABASE_SERVICE_ROLE_KEY 가 없어 공개 전시장에 걸린 것만 받습니다.");
console.log("목록을 받는 중…");

const select = "handle,title,owner_name,theme,layout," +
  "works(slot,title,note,kind,media_url,scale),guestbook(visitor_name,message,created_at)";
const rows = await get(`galleries?select=${encodeURIComponent(select)}&order=created_at`);
if (!Array.isArray(rows)) die("전시장 목록의 모양이 예상과 다릅니다.");

// 걸리지 않은 것까지 포함한 전체 생성 기록. 키가 없으면 건너뜁니다.
let gens = [], who = new Map();
if (SVC) {
  gens = await get("generations?select=id,user_id,status,prompt,prompt_ko,model," +
                   "duration,resolution,media_url,cost_usd,created_at&order=created_at");
  gens = gens.filter((g) => g.status === "done" && g.media_url);
  const profs = await get("profiles?select=id,email,display_name");
  for (const p of profs) {
    who.set(p.id, p.display_name || (p.email ?? "").split("@")[0] || p.id.slice(0, 8));
  }
}
if (!rows.length && !gens.length) die("받을 것이 없습니다.");

/* ---------- 폴더 ---------- */
mkdirSync(join(OUT, "students"), { recursive: true });
mkdirSync(join(OUT, "vendor"), { recursive: true });

/* ---------- 어디에 저장할지 정하기 ----------
   같은 영상을 두 번 받지 않습니다. 전시장에 걸린 것도 결국 누군가의
   생성물이라, 학생 폴더에 한 벌만 두고 전시 목록이 그쪽을 가리킵니다. */
const place = new Map();          // media_url → 폴더 안의 상대 경로

/** 폴더·파일 이름으로 쓸 수 있게 다듬습니다. 한글은 그대로 둡니다. */
function safe(s) {
  // 윈도우에서 폴더 이름에 쓸 수 없는 글자 — 역슬래시를 빠뜨리면
  // 이름에 그것이 섞였을 때 엉뚱한 하위 폴더가 생깁니다.
  const BAD = /[\/:*?"<>|]/g;
  return String(s ?? "").replace(BAD, "_").replace(/\s+/g, " ").trim() || "이름없음";
}
function stampOf(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "언제인지모름";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
         `${p(d.getHours())}${p(d.getMinutes())}`;
}

for (const g of gens) {
  const folder = safe(who.get(g.user_id) || g.user_id.slice(0, 8));
  const name = `${stampOf(g.created_at)}_${g.duration}초_${g.resolution}_` +
               `${g.id.slice(0, 8)}.mp4`;
  place.set(g.media_url, `students/${folder}/${name}`);
}
// 전시장 대표 이미지. 이것도 받아두지 않으면 오프라인으로 열었을 때
// 로비 카드가 깨진 그림으로 나옵니다 — 주소가 인터넷을 가리키니까요.
const covers = new Map();          // handle → 폴더 안의 상대 경로
for (const g of rows) {
  const url = g.theme && g.theme.cover;
  if (typeof url === "string" && url) {
    covers.set(g.handle, `covers/${safe(g.handle)}.jpg`);
    place.set(url, `covers/${safe(g.handle)}.jpg`);
  }
}

// 생성 기록이 없는 작품(손으로 넣었거나 키가 없을 때)은 전시장 이름으로
for (const g of rows) {
  for (const w of g.works ?? []) {
    if (!w.media_url || place.has(w.media_url)) continue;
    const ext = (w.media_url.split("?")[0].match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? "mp4")
      .toLowerCase();
    place.set(w.media_url,
      `students/${safe(g.owner_name || g.handle)}/` +
      `${safe(g.handle)}-${String(w.slot).padStart(2, "0")}.${ext}`);
  }
}

/* ---------- 받을 것이 있는지만 보기 (--check) ----------
   백업은 손으로 합니다. 예약해 두면 노트북이 닫혀 있거나 드라이브 로그인이
   풀렸을 때 조용히 멈추는데, 로그를 아무도 보지 않아서 몇 달 뒤에야
   압니다. 손으로 하면 적어도 돌렸는지 아닌지는 압니다.

   대신 수동의 약점은 잊는 것입니다. "백업하세요" 라는 알림은 무시되지만
   "안 받은 게 12편입니다" 는 무시하기 어렵습니다. 그 숫자를 내주는
   것이 이 갈래입니다. 받지는 않습니다. */
if (argv.includes("--check")) {
  let need = 0, have = 0;
  for (const [, rel] of place) {
    const f = join(OUT, rel);
    if (existsSync(f) && statSync(f).size > 0) have++; else need++;
  }
  const 지난것 = (() => {
    const base = told ? dirname(OUT) : join(ROOT, "backup");
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort().slice(-3);
  })();

  console.log("");
  console.log(`  저장 위치   ${OUT}`);
  console.log(`  이미 받은 것 ${have}편`);
  console.log(need
    ? `  아직 없는 것 ${need}편  ← npm run backup 을 돌리세요`
    : `  아직 없는 것 없음 · 최신입니다`);
  if (지난것.length) console.log(`  지난 폴더   ${지난것.join(", ")}`);
  console.log("");
  return;                                   // 받지 않고 끝냅니다
}

/* ---------- 내려받기 ---------- */
let saved = 0, failed = 0, skipped = 0, bytes = 0;
const ok = new Set();

console.log(`영상 ${place.size}편을 받습니다…`);
for (const [url, rel] of place) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });

  // 같은 폴더로 다시 돌리면 이미 받은 것은 건너뜁니다. 큰 전시를 나눠서
  // 받거나, 중간에 끊겼을 때 처음부터 다시 받지 않으려는 것입니다.
  if (existsSync(dest) && statSync(dest).size > 0) {
    ok.add(url); skipped++; continue;
  }

  process.stdout.write(`  ${rel} … `);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(dest, buf);
    bytes += buf.length; saved++; ok.add(url);
    console.log(`${(buf.length / 1048576).toFixed(1)}MB`);
  } catch (e) {
    failed++;
    console.log(`실패 (${e.message})`);
  }
}

/* ---------- 전시 목록 ---------- */
const galleries = rows.map((g) => ({
  handle: g.handle,
  name: g.owner_name || g.handle,
  title: g.title,
  // 대표 이미지는 받아둔 파일을 가리키게 바꿉니다. 못 받았으면 아예
  // 빼서, 전시장이 예전처럼 방 그림을 그리게 둡니다.
  theme: (() => {
    const t = { ...(g.theme ?? {}) };
    const url = t.cover;
    if (typeof url === "string") {
      if (ok.has(url)) t.cover = covers.get(g.handle);
      else delete t.cover;
    }
    return t;
  })(),
  // 놓아둔 가구도 함께 챙깁니다. 없으면 오프라인 전시장이 텅 빈 방이 됩니다.
  layout: Array.isArray(g.layout) ? g.layout : [],
  guestbook: (g.guestbook ?? [])
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((e) => ({ name: e.visitor_name, msg: e.message })),
  works: (g.works ?? [])
    .sort((a, b) => a.slot - b.slot)
    // 받지 못한 작품은 뺍니다. 깨진 링크를 남기면 전시장에 빈 검은 액자가
    // 걸립니다. 빈 자리로 두는 편이 낫습니다.
    .filter((w) => w.media_url && ok.has(w.media_url))
    .map((w) => ({ slot: w.slot, src: place.get(w.media_url),
                   title: w.title, note: w.note, kind: w.kind,
                   scale: w.scale ?? 1 })),
}));

/* ---------- archive.json ----------
   전시에 쓰이지는 않습니다. 나중에 "이 영상이 누구 것이었지" 를 답하고,
   되돌릴 일이 생겼을 때 근거가 되는 기록입니다. */
writeFileSync(join(OUT, "archive.json"), JSON.stringify({
  _읽어보세요: "학생별 영상과 그 내력입니다. 전시장은 exhibition.json 이 씁니다.",
  generatedAt: new Date().toISOString(),
  전원: !!SVC,
  students: [...new Set(gens.map((g) => who.get(g.user_id) || g.user_id))].map((name) => ({
    name,
    videos: gens
      .filter((g) => (who.get(g.user_id) || g.user_id) === name && ok.has(g.media_url))
      .map((g) => ({
        file: place.get(g.media_url),
        madeAt: g.created_at,
        promptKo: g.prompt_ko,
        prompt: g.prompt,
        model: g.model, duration: g.duration, resolution: g.resolution,
        costUsd: Number(g.cost_usd ?? 0),
        hungAt: rows.flatMap((r) => (r.works ?? [])
          .filter((w) => w.media_url === g.media_url)
          .map((w) => `${r.handle} ${w.slot}번`))[0] ?? null,
      })),
  })),
  galleries,
}, null, 2), "utf8");

/* ---------- 열기.mjs ----------
   전시 당일에 인터넷이 없을 수 있습니다. `npx serve .` 는 그때 패키지를
   내려받으려다 실패합니다 — 정작 필요한 순간에.

   그래서 Node 에 원래 들어 있는 것만으로 된 작은 서버를 함께 넣습니다.
   설치할 것이 하나도 없고, `node 열기.mjs` 한 줄이면 열립니다. */
writeFileSync(join(OUT, "열기.mjs"),
`// 이 폴더를 전시장으로 엽니다.  실행:  node 열기.mjs
//
// 인터넷도, 설치할 것도 필요 없습니다. Node 만 있으면 됩니다.
// (exhibition.html 을 더블클릭하면 안 되는 이유: file:// 로는 브라우저가
//  같은 폴더의 목록 파일조차 읽지 못하게 막습니다.)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.argv[2]) || 8080;

const TYPE = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".mp4": "video/mp4",
  ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/exhibition.html";
    // 폴더 밖으로 나가는 경로는 막습니다
    // 위와 같은 이유로 역슬래시가 든 정규식을 쓰지 않습니다.
    const file = join(ROOT, normalize(p).split("..").join(""));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("no"); return; }

    const info = await stat(file);
    const body = await readFile(file);
    const type = TYPE[extname(file).toLowerCase()] ?? "application/octet-stream";

    // 영상은 브라우저가 구간으로 나눠 요청합니다. 이걸 받아주지 않으면
    // 어떤 브라우저에서는 재생 막대가 움직이지 않습니다.
    const range = req.headers.range;
    if (range && type.startsWith("video/")) {
      // 정규식을 쓰지 않습니다. 이 파일은 다른 파일 안에서 글자로 만들어져
      // 나오는데, 역슬래시가 그 과정에서 사라져 \d 가 d 로 바뀝니다.
      // 실제로 그렇게 되어 구간을 무시하고 파일 전체를 보냈습니다.
      const eq = range.indexOf("=");
      const dash = range.indexOf("-", eq + 1);
      const head = range.slice(eq + 1, dash).trim();
      const tail = range.slice(dash + 1).trim();
      const start = head ? Number(head) : 0;
      const end = tail ? Math.min(Number(tail), info.size - 1) : info.size - 1;
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": \`bytes \${start}-\${end}/\${info.size}\`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": info.size });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("없는 파일입니다");
  }
}).listen(PORT, () => {
  console.log("");
  console.log("  전시장이 열렸습니다.  브라우저에서 아래 주소를 여세요.");
  console.log("");
  console.log("      http://localhost:" + PORT);
  console.log("");
  console.log("  끝내려면 이 창에서 Ctrl+C 를 누르세요.");
});
`, "utf8");

/* ---------- 읽어보세요.txt ---------- */
writeFileSync(join(OUT, "읽어보세요.txt"),
`Art Gallery — 보관본 (${stamp})

이 폴더 하나가 전시의 사본입니다. 인터넷도 서버도 필요 없습니다.

  전시장을 열려면
    이 폴더에서 터미널을 열고
      node 열기.mjs
    그리고 브라우저에서  http://localhost:8080  을 여세요.

    인터넷도, 설치할 것도 필요 없습니다. Node 만 있으면 됩니다.
    주소가 겹치면 뒤에 다른 번호를 주세요:  node 열기.mjs 8090

    ※ exhibition.html 을 더블클릭하면 안 됩니다. file:// 로는
       브라우저가 같은 폴더의 목록 파일조차 읽지 못하게 막습니다.

  학생별 영상
    students/<이름>/ 아래에 있습니다. 파일 이름은
    만든날짜-시각_길이_화질_번호.mp4 입니다.
    전시장에 걸지 않은 것까지 전부 들어 있습니다.

  archive.json
    누가 언제 무엇을 만들었는지, 어떤 프롬프트였는지, 얼마가 들었는지.

  exhibition.json
    전시장에 걸린 작품 목록. 전시장 화면이 이 파일을 읽습니다.
`, "utf8");

/* ---------- exhibition.json ---------- */
writeFileSync(join(OUT, "exhibition.json"), JSON.stringify({
  _읽어보세요: "exhibition.html 과 같은 폴더에 두세요. 인터넷 없이 열립니다.",
  generatedAt: new Date().toISOString(),
  galleries,
}, null, 2), "utf8");

/* ---------- 전시장 + three.js ---------- */
// exhibition.html 은 three.js 를 CDN 에서 받습니다. 그대로 복사하면
// 인터넷 없는 자리에서 화면이 통째로 비어 버립니다. 라이브러리를 같이
// 받아서 태그를 상대 경로로 바꿉니다.
const THREE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
process.stdout.write("  three.min.js … ");
try {
  const r = await fetch(THREE_CDN);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  writeFileSync(join(OUT, "vendor", "three.min.js"),
                Buffer.from(await r.arrayBuffer()));
  console.log("받음");
} catch (e) {
  console.log(`실패 (${e.message}) — 이 폴더는 인터넷이 있어야 열립니다`);
}

let html = readFileSync(join(ROOT, "public", "exhibition.html"), "utf8");
html = html.replace(THREE_CDN, "vendor/three.min.js");
writeFileSync(join(OUT, "exhibition.html"), html, "utf8");

// 화면 표준(글꼴·색·모서리). exhibition.html 이 상대 경로로 찾으므로
// 같은 폴더에 있어야 합니다. 빠지면 색과 글꼴이 통째로 풀립니다.
//
// 이 파일 안의 구글 폰트 @import 는 인터넷이 없으면 조용히 실패하고,
// 그때는 맑은 고딕으로 떨어집니다. 화면은 그대로 읽힙니다.
copyFileSync(join(ROOT, "public", "theme.css"), join(OUT, "theme.css"));
// 로비 바탕 그림. 빠뜨리면 오프라인 전시의 로비만 허옇게 뜹니다.
copyFileSync(join(ROOT, "public", "school-bg.jpg"), join(OUT, "school-bg.jpg"));

/* ---------- 마무리 ---------- */
console.log("");
// 건너뛴 것을 빼놓으면 "0편" 으로 보여서 백업이 안 된 것처럼 읽힙니다.
console.log(`전시장 ${galleries.length}곳 · 영상 ${ok.size}편 보관 ` +
            `(새로 ${saved}편 ${(bytes / 1048576).toFixed(1)}MB` +
            `${skipped ? ` · 이미 있어 건너뜀 ${skipped}편` : ""}` +
            `${failed ? ` · 실패 ${failed}편` : ""})`);
console.log(`저장 위치: ${OUT}`);
console.log("");
console.log("여는 법:");
console.log(`  cd "${OUT}"`);
console.log("  node 열기.mjs");
console.log("  → http://localhost:8080");
console.log("");
console.log("인터넷도 설치할 것도 필요 없습니다. HTML 을 더블클릭하지는 마세요 —");
console.log("file:// 로는 브라우저가 목록 파일을 읽지 못합니다.");

}  // main

try {
  await main();
} catch (e) {
  console.error("\n중단: " + (e instanceof Stop ? e.message : (e?.stack ?? e)) + "\n");
  // exit() 대신 코드만 세워두고 자연스럽게 끝냅니다.
  process.exitCode = 1;
}
