// 내 커스텀 키트 — 수강생 깃허브에 비공개 키트를 만들어 주고, 코덱스 채팅에서 바로 고치고 되돌리게 한다.
//
// 2026-10-17 진현님 지시: "수강생 깃허브에 프로젝트가 추가돼서 그걸로 커스텀 마음대로, 원본은 그대로·커스텀은 따로"
//   + "절대 수강생들 각자 로컬에서 하게 하면 안 돼" (코드를 수강생 PC 에 내려받아 고치지 않는다).
// 2026-10-19 진현님: 비공개로. 같은 날 "너무 어렵다, 수강생이 최대한 쉽게" → 이 판:
//   · 수강생이 하는 일은 "내 커스텀 키트 만들어줘" → 깃허브 화면에서 8자리 코드 넣고 Authorize → "했어요" 뿐.
//     (깃허브 디바이스 로그인. makeit-edu 의 OAuth 앱 '메킷 키트'. 토큰은 프로그램이 직접 받아 저장한다 — 화면·채팅에 안 나온다)
//   · 비공개 저장소는 이 프로그램이 원본 템플릿에서 만든다 (POST /repos/makeit-edu/makeit-middle-kit/generate).
//   · 같은 폴더를 '내 키트' 로 바꾼다 (00_설정/키트저장소.txt 표시). "원본 키트로 써줘" 로 언제든 되돌린다 (로더.키트바꾸기).
//   · 고치기는 코덱스 채팅에서: 코덱스가 파일을 읽고(파일읽기) 바꿀 곳을 주면(고치기) 이 프로그램이 검사한 뒤
//     깃허브의 내 저장소에 바로 커밋한다. 코드는 수강생 PC 에 남지 않는다 (검사용 임시 폴더는 바로 지운다).
//   · 이 파일은 내 키트 폴더에서도 늘 원본 것이 돈다 (로더가 원본에서 받아 덮는다). 수강생이 고쳐도 쓰이지 않는다.
//
//   앱.커스텀.시작({작업폴더})                   → {결과: "코드", 코드, 주소} | "이미 연결" | "멈춤"
//   앱.커스텀.확인({작업폴더})                   → {결과: "됨", 저장소, 새로만듦} | "아직" | "만료" | "거절" | "코드 없음" | "멈춤"
//   앱.커스텀.상태({작업폴더})                   → {연결, 저장소, 지금: "내 키트" | "원본"}
//   앱.커스텀.파일목록({작업폴더})               → 내 키트 파일과 설명
//   앱.커스텀.파일읽기({작업폴더, 파일, 찾기, 줄, 원본})
//   앱.커스텀.고치기({작업폴더, 바꿀것: [{파일, 찾기, 바꾸기} | {파일, 내용} | {파일, 지우기: true}], 설명})
//   앱.커스텀.되돌리기({작업폴더})  ·  앱.커스텀.바꾼기록({작업폴더})
//   토큰 값은 어떤 결과에도 넣지 않는다.

import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

export const 버전 = "2026-10-19c";

const 여기 = dirname(fileURLToPath(import.meta.url));
const 공식저장소 = "makeit-edu/makeit-middle-kit";
// makeit-edu 의 깃허브 OAuth 앱 '메킷 키트' (디바이스 로그인 켬). Client ID 는 비밀값이 아니다.
const 클라이언트ID = "Ov23li5t03Wk3mgpq0BA"; // 2026-10-19 등록 (github.com/settings/applications/3944770, Device Flow 켬, 토큰 만료 끔)
const 권한 = "repo"; // 비공개 저장소를 만들고 고치려면 깃허브에서는 이 범위가 최소다
const 기본이름 = "my-makeit-kit";
const 저장소꼴 = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const 저장소줄 = /let 저장소 ?= ?"([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)";/;
const 토큰꼴 = /^[A-Za-z0-9_]{20,255}$/;
const 설정폴더 = (작업폴더) => join(작업폴더, "애드센스 승인글", "00_설정");
const 토큰파일 = (작업폴더) => join(설정폴더(작업폴더), "깃허브토큰.txt");
const 표시파일 = (작업폴더) => join(설정폴더(작업폴더), "키트저장소.txt");
const 내키트파일 = (작업폴더) => join(설정폴더(작업폴더), "내키트.json");
const 작게 = (s) => String(s || "").toLowerCase();
const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
const 인코딩 = (파일) => String(파일).normalize("NFC").split("/").map(encodeURIComponent).join("/");
const 지금시각 = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);

// 고치지 않는 파일 — 늘 원본이 돌거나(로더·설치·커스텀) 깃허브에서 실행되는 것(.github)
const 막는파일 = [/^앱\/로더\.mjs$/, /^앱\/설치\.mjs$/, /^앱\/커스텀\.mjs$/, /^\.github\//];
const 지우면안됨 = ["앱/목록.json", "앱/AGENTS.md"];
// 코덱스가 고칠 곳을 빨리 찾게 하는 설명 (없는 파일은 그냥 '프로그램 파일')
const 파일설명 = {
  "앱/AGENTS.md": "코덱스 대본 — 코덱스가 수강생에게 말하는 법·일하는 순서",
  "앱/목록.json": "키트 파일 목록 — 새 파일은 고치기가 자동으로 넣는다",
  "앱/승인글.mjs": "애드센스 승인글 흐름(키 설정·제목·글 만들기 실행·날짜 흩기·진단)",
  "99_절대_건들지마세요_프로그램파일/scripts/adsense-create-drafts.mjs": "애드센스 승인글 본문 만들기 — 글 쓰는 지시문(systemPrompt·userPrompt), 이미지 지시(buildImagePrompt)",
  "99_절대_건들지마세요_프로그램파일/scripts/adsense-auto-drafts.mjs": "승인글을 여러 사이트에 나눠 만들기",
  "99_절대_건들지마세요_프로그램파일/scripts/title-files.mjs": "제목 파일 읽기",
  "99_절대_건들지마세요_프로그램파일/scripts/lib/wp.mjs": "워드프레스 연결(임시글 올리기)",
  "앱/네이버.mjs": "네이버 글 흐름(상태·글 만들기·쓰기·진단)",
  "앱/네이버/글만들기.mjs": "네이버 글·사진 만들기 — 글 쓰는 지시문(원고쓰기 안 `const 지시`), 사진 지시(최종그림프롬프트)",
  "앱/네이버/naver-typing.mjs": "네이버 편집기에 글 넣기(타이핑·서식) — 웬만하면 고치지 않는다",
  "앱/네이버/recipe.json": "네이버 편집기 버튼 위치(셀렉터)",
  "앱/메킷애센.mjs": "받은 메킷애센 플러그인 고치기 도구",
};

// ───────── 수강생 폴더의 내 키트 정보 ─────────
async function 첫단어(경로) {
  try { return (await readFile(경로, "utf8")).trim().split(/\s+/)[0] || ""; } catch { return ""; }
}
async function 내키트읽기(작업폴더) {
  let 정보 = {};
  try { 정보 = JSON.parse(await readFile(내키트파일(작업폴더), "utf8")); } catch {}
  let 토큰 = await 첫단어(토큰파일(작업폴더));
  if (!토큰꼴.test(토큰)) 토큰 = "";
  const 저장소 = 저장소꼴.test(String(정보.저장소 || "")) ? 정보.저장소 : "";
  const 켜짐 = 저장소꼴.test(await 첫단어(표시파일(작업폴더)));
  return {저장소, 토큰, 켜짐, 아이디: 정보.아이디 || ""};
}

// ───────── 깃허브 ─────────
async function 깃허브(경로, {토큰 = "", 방법 = "GET", 몸 = null, Accept = "application/vnd.github+json"} = {}) {
  const headers = {Accept, "X-GitHub-Api-Version": "2022-11-28"};
  if (토큰) headers.Authorization = `token ${토큰}`;
  if (몸) headers["Content-Type"] = "application/json";
  const r = await fetch(경로.startsWith("http") ? 경로 : `https://api.github.com${경로}`, {method: 방법, headers, body: 몸 ? JSON.stringify(몸) : undefined, cache: "no-store", signal: AbortSignal.timeout(30000)});
  const 글 = await r.text();
  let json = null;
  try { json = 글 ? JSON.parse(글) : null; } catch {}
  return {상태: r.status, 몸: json, 글};
}
async function 폼보내기(주소, 값들) {
  const r = await fetch(주소, {method: "POST", headers: {Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams(값들).toString(), cache: "no-store", signal: AbortSignal.timeout(20000)});
  let json = null;
  try { json = await r.json(); } catch {}
  return {상태: r.status, 몸: json || {}};
}
// 커밋 sha 시점의 파일 내용 (토큰으로)
async function 파일내용(저장소, 토큰, 파일, ref) {
  const r = await 깃허브(`/repos/${저장소}/contents/${인코딩(파일)}?ref=${encodeURIComponent(ref)}`, {토큰, Accept: "application/vnd.github.raw+json"});
  if (r.상태 === 404) return null;
  if (r.상태 !== 200) { const e = new Error(`파일을 읽지 못함 (${파일}, HTTP ${r.상태})`); e.상태 = r.상태; throw e; }
  return r.글;
}
async function 최신(저장소, 토큰) {
  const ref = await 깃허브(`/repos/${저장소}/git/ref/heads/main`, {토큰});
  if (ref.상태 !== 200) { const e = new Error(`내 키트의 main 을 읽지 못함 (HTTP ${ref.상태})`); e.상태 = ref.상태; throw e; }
  const 커밋 = await 깃허브(`/repos/${저장소}/git/commits/${ref.몸.object.sha}`, {토큰});
  if (커밋.상태 !== 200) throw new Error(`커밋을 읽지 못함 (HTTP ${커밋.상태})`);
  return {sha: ref.몸.object.sha, 트리: 커밋.몸.tree.sha, 부모: (커밋.몸.parents || []).map((p) => p.sha), 메시지: 커밋.몸.message || ""};
}
function 연결안내(상태) {
  if (상태 === 401) return "깃허브 연결이 끊겼어요(연결을 해제했거나 오래 안 썼어요). '내 커스텀 키트 만들어줘' 라고 하면 다시 연결해요. 내 키트는 깃허브에 그대로 있어요.";
  if (상태 === 403 || 상태 === 429) return "깃허브가 잠깐 요청을 막았어요. 1~2분 뒤 다시 해 주세요.";
  if (상태 === 404) return "깃허브에서 내 키트 저장소를 찾지 못했어요. 이름을 바꿨거나 지웠다면 '내 커스텀 키트 만들어줘' 라고 하세요(없으면 새로 만들어요).";
  return "깃허브에 연결하지 못했어요. 인터넷 연결을 확인하고 1~2분 뒤 다시 해 주세요.";
}
const 멈춤 = (원인, 할일 = "인터넷 연결을 확인하고 1~2분 뒤 다시 말해 주세요.", 덧 = {}) => ({결과: "멈춤", 원인, 할일, ...덧});
// 지금 이 키트(임시 폴더의 대본)가 어느 저장소 것인지 — 로더가 대본의 저장소 줄을 맞춰 둔다
async function 이키트저장소() {
  try { const m = 저장소줄.exec(await readFile(join(여기, "AGENTS.md"), "utf8")); if (m?.[1]) return m[1]; } catch {}
  return 공식저장소;
}

// ───────── 1. 연결 — 깃허브 디바이스 로그인 ─────────
export async function 시작({작업폴더} = {}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  const 내 = await 내키트읽기(작업폴더);
  if (내.저장소 && 내.토큰) {
    const r = await 깃허브(`/repos/${내.저장소}`, {토큰: 내.토큰}).catch(() => ({상태: 0}));
    if (r.상태 === 200) return {결과: "이미 연결", 저장소: 내.저장소, 저장소주소: `https://github.com/${내.저장소}`, 지금: 내.켜짐 ? "내 키트" : "원본"};
  }
  if (!클라이언트ID) return 멈춤("내 커스텀 키트 기능이 아직 준비 중이에요", "강의 공지를 확인해 주세요.");
  let r;
  try { r = await 폼보내기("https://github.com/login/device/code", {client_id: 클라이언트ID, scope: 권한}); }
  catch { return 멈춤("깃허브에 연결하지 못했어요"); }
  if (!r.몸.device_code) return 멈춤(`깃허브 로그인을 시작하지 못했어요 (${r.몸.error || r.상태})`, "1~2분 뒤 '내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.");
  globalThis.__메킷깃허브연결 = {작업폴더, 장치: r.몸.device_code, 간격: Number(r.몸.interval) || 5, 만료: Date.now() + (Number(r.몸.expires_in) || 900) * 1000};
  return {결과: "코드", 코드: r.몸.user_code, 주소: r.몸.verification_uri || "https://github.com/login/device", 분: Math.round((Number(r.몸.expires_in) || 900) / 60)};
}

export async function 확인({작업폴더, 기다림초 = 90} = {}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  const 대기 = globalThis.__메킷깃허브연결;
  if (!대기?.장치) return {결과: "코드 없음", 안내: "연결을 처음부터 다시 할게요."};
  const 끝 = Math.min(Date.now() + 기다림초 * 1000, 대기.만료);
  let 간격 = 대기.간격;
  while (Date.now() < 끝) {
    let r;
    try { r = await 폼보내기("https://github.com/login/oauth/access_token", {client_id: 클라이언트ID, device_code: 대기.장치, grant_type: "urn:ietf:params:oauth:grant-type:device_code"}); }
    catch { await 쉬기(간격 * 1000); continue; }
    if (r.몸.access_token) {
      globalThis.__메킷깃허브연결 = null;
      return 토큰으로연결({작업폴더, 토큰: r.몸.access_token});
    }
    const 오류 = r.몸.error;
    if (오류 === "authorization_pending") { await 쉬기(간격 * 1000); continue; }
    if (오류 === "slow_down") { 간격 += 5; await 쉬기(간격 * 1000); continue; }
    globalThis.__메킷깃허브연결 = null;
    if (오류 === "expired_token") return {결과: "만료", 안내: "코드 시간이 지났어요. 새 코드로 다시 할게요."};
    if (오류 === "access_denied") return {결과: "거절", 안내: "깃허브 화면에서 Authorize 대신 취소를 누르셨어요. 다시 하려면 '내 커스텀 키트 만들어줘' 라고 해 주세요."};
    return 멈춤(`깃허브 연결이 안 됐어요 (${오류 || r.상태})`, "1~2분 뒤 '내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.");
  }
  if (Date.now() >= 대기.만료) { globalThis.__메킷깃허브연결 = null; return {결과: "만료", 안내: "코드 시간이 지났어요. 새 코드로 다시 할게요."}; }
  return {결과: "아직", 안내: "아직 깃허브에서 승인이 안 됐어요. 깃허브 화면에서 코드를 넣고 초록 Authorize 버튼까지 눌렀는지 확인해 주세요."};
}

// 토큰을 받은 뒤: 내 아이디 → 내 키트 저장소 찾기(없으면 원본 템플릿으로 비공개 생성) → 이 폴더를 내 키트로
export async function 토큰으로연결({작업폴더, 토큰} = {}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  if (!토큰꼴.test(String(토큰 || ""))) return 멈춤("깃허브 연결 열쇠가 이상해요", "'내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.");
  try {
    const 나 = await 깃허브("/user", {토큰});
    if (나.상태 !== 200) return 멈춤(연결안내(나.상태), "'내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.");
    const 아이디 = 나.몸.login;
    const 전 = await 내키트읽기(작업폴더);
    let 저장소 = "", 새로만듦 = false;
    // 전에 연결한 저장소가 있으면 그것
    if (전.저장소 && 작게(전.저장소.split("/")[0]) === 작게(아이디)) {
      const r = await 깃허브(`/repos/${전.저장소}`, {토큰});
      if (r.상태 === 200) 저장소 = r.몸.full_name;
    }
    // 이름으로 찾기: 원본 템플릿에서 만든 my-makeit-kit(…-2 …) 가 있으면 다시 쓴다
    let 빈이름 = "";
    for (let i = 1; !저장소 && i <= 9; i++) {
      const 이름 = i === 1 ? 기본이름 : `${기본이름}-${i}`;
      const r = await 깃허브(`/repos/${아이디}/${이름}`, {토큰});
      if (r.상태 === 200 && 작게(r.몸?.template_repository?.full_name) === 공식저장소) 저장소 = r.몸.full_name;
      else if (r.상태 === 404 && !빈이름) 빈이름 = 이름;
    }
    // 없으면 만든다 (비공개)
    if (!저장소) {
      if (!빈이름) return 멈춤("내 깃허브에 비슷한 이름의 저장소가 너무 많아요", "깃허브에서 쓰지 않는 my-makeit-kit 저장소를 지우고 다시 말해 주세요.");
      const r = await 깃허브(`/repos/${공식저장소}/generate`, {토큰, 방법: "POST", 몸: {owner: 아이디, name: 빈이름, private: true, include_all_branches: false, description: "내 메킷 키트 (비공개) — 메킷 키트가 원본에서 복사"}});
      if (r.상태 !== 201) return 멈춤(`깃허브에 내 키트를 만들지 못했어요 (HTTP ${r.상태})`, "깃허브에 가입할 때 온 이메일에서 인증(Verify)을 마쳤는지 확인하고, 1~2분 뒤 '내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.");
      저장소 = r.몸.full_name;
      새로만듦 = true;
    }
    // 만들어진 직후에는 파일이 몇 초 늦게 보인다
    let 준비됨 = false;
    for (let i = 0; i < 30 && !준비됨; i++) {
      const r = await 깃허브(`/repos/${저장소}/contents/${인코딩("앱/AGENTS.md")}?ref=main`, {토큰, Accept: "application/vnd.github.raw+json"});
      if (r.상태 === 200) {
        if (!저장소줄.test(r.글)) return {결과: "옛 판", 안내: "예전 원본으로 만든 저장소라 내 커스텀 키트로 쓸 수 없어요. 깃허브에서 그 저장소 이름을 바꾸거나 지우고 다시 말해 주세요.", 저장소};
        준비됨 = true;
      } else await 쉬기(2000);
    }
    if (!준비됨) return 멈춤("내 키트를 만들었는데 아직 파일이 안 보여요", "1~2분 뒤 '내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.", {저장소});
    // 이 폴더를 내 키트로: 대본(내 저장소 것)·표시·토큰을 깐다 (설치는 늘 원본 것)
    const {설치} = await import(`${pathToFileURL(join(여기, "설치.mjs")).href}?t=${Date.now()}`);
    const 설치결과 = await 설치({작업폴더, 저장소, 토큰});
    if (설치결과.결과 !== "설치 끝") return 멈춤("내 키트로 바꾸다가 멈췄어요", "1~2분 뒤 '내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.", {저장소, 설치: 설치결과.결과});
    await mkdir(설정폴더(작업폴더), {recursive: true});
    await writeFile(내키트파일(작업폴더), JSON.stringify({저장소, 아이디, 연결: 지금시각()}, null, 2) + "\n", "utf8");
    return {결과: "됨", 저장소, 저장소주소: `https://github.com/${저장소}`, 새로만듦, 아이디};
  } catch (e) {
    return 멈춤(`내 커스텀 키트를 연결하다 멈췄어요: ${String(e?.message || e).split("\n")[0].slice(0, 120)}`);
  }
}

export async function 상태({작업폴더} = {}) {
  const 내 = await 내키트읽기(작업폴더);
  return {연결: Boolean(내.저장소 && 내.토큰), 저장소: 내.저장소, 저장소주소: 내.저장소 ? `https://github.com/${내.저장소}` : "", 지금: 내.켜짐 ? "내 키트" : "원본"};
}

// ───────── 2. 고치기 ─────────
async function 고칠준비(작업폴더) {
  const 내 = await 내키트읽기(작업폴더);
  if (!내.저장소 || !내.토큰) return {멈춤: {결과: "내 키트 없음", 안내: "아직 내 커스텀 키트가 없어요. 먼저 '내 커스텀 키트 만들어줘' 라고 해 주세요."}};
  return {내};
}
const 파일꼴 = (파일) => typeof 파일 === "string" && 파일.length > 0 && !파일.startsWith("/") && !파일.split("/").includes("..") && !/[\\\0]/.test(파일);

export async function 파일목록({작업폴더} = {}) {
  const {내, 멈춤: 못함} = await 고칠준비(작업폴더);
  if (못함) return 못함;
  try {
    const 목록 = JSON.parse(await 파일내용(내.저장소, 내.토큰, "앱/목록.json", "main"));
    const 파일들 = [...new Set([...(목록.파일 || []), "앱/목록.json"])].sort();
    return {
      저장소: 내.저장소,
      파일: 파일들.map((f) => ({파일: f, 설명: 파일설명[f] || "프로그램 파일", 고치기: 막는파일.some((m) => m.test(f)) ? "안 됨(늘 원본이 돈다)" : "됨"})),
      안내: "글 쓰는 말투·형식은 지시문 파일(설명에 '지시문')을 먼저 보세요. 큰 파일은 파일읽기의 찾기로 필요한 곳만 봅니다.",
    };
  } catch (e) {
    return {결과: "멈춤", 원인: 연결안내(e?.상태 || 0), 할일: ""};
  }
}

export async function 파일읽기({작업폴더, 파일, 찾기 = "", 줄 = null, 원본 = false} = {}) {
  if (!파일꼴(파일)) return {결과: "파일 이름 이상", 안내: "파일목록에 나온 이름 그대로 주세요."};
  let 내용;
  if (원본) {
    // 원본 키트의 같은 파일 (원본 새 내용과 비교할 때). 공개라 토큰이 필요 없다
    const r = await fetch(`https://raw.githubusercontent.com/${공식저장소}/main/${인코딩(파일)}?t=${Date.now()}`, {cache: "no-store", signal: AbortSignal.timeout(20000)});
    if (!r.ok) return {결과: "없음", 안내: `원본에 ${파일} 이 없어요.`};
    내용 = await r.text();
  } else {
    const {내, 멈춤: 못함} = await 고칠준비(작업폴더);
    if (못함) return 못함;
    try { 내용 = await 파일내용(내.저장소, 내.토큰, 파일, "main"); }
    catch (e) { return {결과: "멈춤", 원인: 연결안내(e?.상태 || 0), 할일: ""}; }
    if (내용 === null) return {결과: "없음", 안내: `내 키트에 ${파일} 이 없어요.`};
  }
  const 줄들 = 내용.split("\n");
  const 자르기 = (a, b) => ({시작줄: a + 1, 끝줄: Math.min(b, 줄들.length), 내용: 줄들.slice(a, b).join("\n")});
  if (Array.isArray(줄) && 줄.length === 2) {
    const a = Math.max(0, Number(줄[0]) - 1), b = Math.min(줄들.length, a + 400, Number(줄[1]));
    return {파일, 줄수: 줄들.length, ...자르기(a, b)};
  }
  if (찾기) {
    const 찾은 = [];
    줄들.forEach((l, i) => { if (l.includes(찾기)) 찾은.push(i); });
    return {파일, 줄수: 줄들.length, 찾은곳: 찾은.length, 부분: 찾은.slice(0, 5).map((i) => 자르기(Math.max(0, i - 12), i + 13))};
  }
  if (줄들.length <= 400) return {파일, 줄수: 줄들.length, 시작줄: 1, 내용};
  return {파일, 줄수: 줄들.length, 안내: "큰 파일이라 앞부분만 보여요. 찾기(낱말)나 줄([시작, 끝])로 필요한 곳을 보세요.", ...자르기(0, 80)};
}

// 넣으면 안 되는 값 — 키·토큰·워드프레스 앱 비밀번호, 그리고 이 수강생의 실제 키
async function 비밀값검사(작업폴더, 글) {
  const 꼴들 = [/sk-[A-Za-z0-9_-]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b[A-Za-z0-9]{4}( [A-Za-z0-9]{4}){5}\b/];
  if (꼴들.some((m) => m.test(글))) return true;
  try {
    const 설정 = JSON.parse(await readFile(join(설정폴더(작업폴더), "설정.json"), "utf8"));
    const 값들 = [설정.openai키, ...(설정.사이트 || []).map((s) => s.앱비밀번호)].filter((v) => typeof v === "string" && v.length >= 8);
    if (값들.some((v) => 글.includes(v) || 글.includes(v.replace(/\s/g, "")))) return true;
  } catch {}
  return false;
}

// 바꾼 파일들로 키트가 불러와지는지 (로더와 같은 방식으로 임시 폴더에 풀어 진입 모듈을 import). 끝나면 지운다
async function 불러오기검사(저장소, 토큰, sha, 목록, 바뀐) {
  const 임시 = await mkdtemp(join(tmpdir(), "makeit-check-"));
  try {
    for (const 파일 of 목록.파일 || []) {
      const 내용 = 바뀐.has(파일) ? 바뀐.get(파일) : await 파일내용(저장소, 토큰, 파일, sha);
      if (내용 === null) return `목록에 있는 파일이 없어요: ${파일}`;
      await mkdir(dirname(join(임시, 파일)), {recursive: true});
      await writeFile(join(임시, 파일), 내용, "utf8");
    }
    for (const [이름, 파일] of Object.entries(목록.진입 || {})) {
      if (이름 === "커스텀" || !String(파일).endsWith(".mjs")) continue;
      if (!(목록.파일 || []).includes(파일)) return `진입 ${이름} 의 파일(${파일})이 목록에 없어요`;
      try { await import(`${pathToFileURL(join(임시, 파일)).href}?t=${Date.now()}`); }
      catch (e) { return `${파일}: ${String(e?.message || e).split("\n")[0].slice(0, 160)}`; }
    }
    return "";
  } finally {
    await rm(임시, {recursive: true, force: true}).catch(() => {});
  }
}

export async function 고치기({작업폴더, 바꿀것 = [], 설명 = ""} = {}) {
  const {내, 멈춤: 못함} = await 고칠준비(작업폴더);
  if (못함) return 못함;
  if (!Array.isArray(바꿀것) || !바꿀것.length) return {결과: "바꿀 것 없음", 안내: "바꿀 파일과 내용을 주세요."};
  설명 = String(설명 || "").trim().split("\n")[0].slice(0, 120) || "내 키트 고치기";
  for (let 회 = 0; 회 < 2; 회++) {
    let 지금;
    try { 지금 = await 최신(내.저장소, 내.토큰); } catch (e) { return {결과: "멈춤", 원인: 연결안내(e?.상태 || 0), 할일: ""}; }
    const 바뀐 = new Map(), 지울 = new Set();
    for (const 항목 of 바꿀것) {
      const 파일 = String(항목?.파일 || "").normalize("NFC");
      if (!파일꼴(파일)) return {결과: "파일 이름 이상", 안내: `파일 이름이 이상해요: ${항목?.파일}`};
      if (막는파일.some((m) => m.test(파일))) return {결과: "못 고치는 파일", 안내: `${파일} 은 늘 원본이 도는 파일이라 고쳐도 쓰이지 않아요. 다른 곳을 고쳐 주세요.`};
      if (항목.지우기) {
        if (지우면안됨.includes(파일)) return {결과: "못 지우는 파일", 안내: `${파일} 은 지우면 키트가 멈춰요.`};
        지울.add(파일); continue;
      }
      let 내용;
      if (typeof 항목.내용 === "string") 내용 = 항목.내용;
      else {
        const 지금내용 = 바뀐.has(파일) ? 바뀐.get(파일) : await 파일내용(내.저장소, 내.토큰, 파일, 지금.sha).catch(() => null);
        if (지금내용 === null) return {결과: "없음", 안내: `내 키트에 ${파일} 이 없어요. 새 파일이면 '내용' 으로 통째로 주세요.`};
        const 찾기 = String(항목.찾기 ?? "");
        if (!찾기) return {결과: "찾기 없음", 안내: "바꿀 곳(찾기)을 주세요."};
        const 몇 = 지금내용.split(찾기).length - 1;
        if (몇 === 0) return {결과: "못 찾음", 안내: `${파일} 에서 바꿀 곳을 못 찾았어요. 파일읽기로 지금 내용을 다시 보고 글자 그대로 주세요.`, 파일};
        if (몇 > 1) return {결과: "여러 곳", 안내: `${파일} 에 같은 글이 ${몇} 곳 있어요. 앞뒤 줄을 더 붙여 한 곳만 맞게 주세요.`, 파일};
        내용 = 지금내용.replace(찾기, () => String(항목.바꾸기 ?? ""));
      }
      if (await 비밀값검사(작업폴더, 내용)) return {결과: "비밀값", 안내: "키·비밀번호·토큰 같은 값은 키트에 넣지 않아요. 그 값은 지금처럼 키설정으로만 넣어 주세요."};
      if (파일.endsWith(".json")) { try { JSON.parse(내용); } catch (e) { return {결과: "검사 실패", 안내: `${파일} 의 JSON 모양이 깨졌어요: ${String(e.message).slice(0, 100)}`}; } }
      if (파일 === "앱/AGENTS.md" && (!저장소줄.test(내용) || !/<!-- 키트판 \d+ -->/.test(내용))) return {결과: "검사 실패", 안내: "대본의 준비 코드(저장소 줄)와 키트판 줄은 지우면 안 돼요."};
      바뀐.set(파일, 내용);
    }
    // 목록 맞추기: 새로 생긴 프로그램 파일은 넣고, 지운 파일은 뺀다
    let 목록 = JSON.parse(바뀐.get("앱/목록.json") ?? await 파일내용(내.저장소, 내.토큰, "앱/목록.json", 지금.sha));
    const 파일들 = new Set((목록.파일 || []).map((f) => f.normalize("NFC")));
    let 목록바뀜 = false;
    for (const 파일 of 바뀐.keys()) {
      if (파일들.has(파일) || 파일 === "앱/목록.json") continue;
      if (/^(앱\/|99_절대_건들지마세요_프로그램파일\/scripts\/)/.test(파일) && /\.(mjs|json|md|txt)$/.test(파일)) { 파일들.add(파일); 목록바뀜 = true; }
    }
    for (const 파일 of 지울) if (파일들.delete(파일)) 목록바뀜 = true;
    if (목록바뀜) { 목록 = {...목록, 파일: [...파일들].sort()}; 바뀐.set("앱/목록.json", JSON.stringify(목록, null, 2) + "\n"); }
    // 불러와지는지 검사 (문법 오류·빠진 파일)
    const 문제 = await 불러오기검사(내.저장소, 내.토큰, 지금.sha, 목록, 바뀐);
    if (문제) return {결과: "검사 실패", 안내: `이렇게 바꾸면 키트가 안 돌아요 — ${문제}. 고쳐서 다시 주세요.`};
    // 깃허브에 한 커밋으로
    try {
      const 트리 = [];
      for (const [파일, 내용] of 바뀐) {
        const b = await 깃허브(`/repos/${내.저장소}/git/blobs`, {토큰: 내.토큰, 방법: "POST", 몸: {content: 내용, encoding: "utf-8"}});
        if (b.상태 !== 201) throw Object.assign(new Error(`blob ${b.상태}`), {상태: b.상태});
        트리.push({path: 파일, mode: "100644", type: "blob", sha: b.몸.sha});
      }
      for (const 파일 of 지울) 트리.push({path: 파일, mode: "100644", type: "blob", sha: null});
      const t = await 깃허브(`/repos/${내.저장소}/git/trees`, {토큰: 내.토큰, 방법: "POST", 몸: {base_tree: 지금.트리, tree: 트리}});
      if (t.상태 !== 201) throw Object.assign(new Error(`tree ${t.상태}`), {상태: t.상태});
      const c = await 깃허브(`/repos/${내.저장소}/git/commits`, {토큰: 내.토큰, 방법: "POST", 몸: {message: `[메킷 키트] ${설명}`, tree: t.몸.sha, parents: [지금.sha]}});
      if (c.상태 !== 201) throw Object.assign(new Error(`commit ${c.상태}`), {상태: c.상태});
      const u = await 깃허브(`/repos/${내.저장소}/git/refs/heads/main`, {토큰: 내.토큰, 방법: "PATCH", 몸: {sha: c.몸.sha, force: false}});
      if (u.상태 === 422 && 회 === 0) continue; // 그사이 다른 곳에서 바뀌었으면 한 번 더
      if (u.상태 !== 200) throw Object.assign(new Error(`ref ${u.상태}`), {상태: u.상태});
      return {결과: "됨", 설명, 커밋: c.몸.sha.slice(0, 7), 바꾼파일: [...바뀐.keys(), ...[...지울].map((f) => `${f} (지움)`)], 지금: 내.켜짐 ? "내 키트" : "원본"};
    } catch (e) {
      return {결과: "멈춤", 원인: e?.상태 === 401 || e?.상태 === 404 ? 연결안내(e.상태) : `깃허브에 올리다 멈췄어요 (${String(e?.message || e).slice(0, 80)})`, 할일: "1~2분 뒤 다시 말해 주세요."};
    }
  }
  return {결과: "멈춤", 원인: "그사이 내 키트가 다른 곳에서 바뀌었어요", 할일: "다시 말해 주세요."};
}

export async function 되돌리기({작업폴더} = {}) {
  const {내, 멈춤: 못함} = await 고칠준비(작업폴더);
  if (못함) return 못함;
  try {
    const 지금 = await 최신(내.저장소, 내.토큰);
    // 원본에서 복사한 첫 커밋(부모 없음)까지 오면 더 되돌릴 게 없다
    if (!지금.부모.length) return {결과: "되돌릴 것 없음", 안내: "아직 바꾼 게 없어요."};
    const 부모 = await 깃허브(`/repos/${내.저장소}/git/commits/${지금.부모[0]}`, {토큰: 내.토큰});
    if (부모.상태 !== 200) throw Object.assign(new Error(`parent ${부모.상태}`), {상태: 부모.상태});
    const 원래설명 = 지금.메시지.replace(/^\[메킷 키트\]\s*/, "").split("\n")[0];
    const c = await 깃허브(`/repos/${내.저장소}/git/commits`, {토큰: 내.토큰, 방법: "POST", 몸: {message: `[메킷 키트] 되돌림: ${원래설명}`, tree: 부모.몸.tree.sha, parents: [지금.sha]}});
    if (c.상태 !== 201) throw Object.assign(new Error(`commit ${c.상태}`), {상태: c.상태});
    const u = await 깃허브(`/repos/${내.저장소}/git/refs/heads/main`, {토큰: 내.토큰, 방법: "PATCH", 몸: {sha: c.몸.sha, force: false}});
    if (u.상태 !== 200) throw Object.assign(new Error(`ref ${u.상태}`), {상태: u.상태});
    return {결과: "됨", 되돌린것: 원래설명, 커밋: c.몸.sha.slice(0, 7)};
  } catch (e) {
    return {결과: "멈춤", 원인: e?.상태 === 401 || e?.상태 === 404 ? 연결안내(e.상태) : `되돌리다 멈췄어요 (${String(e?.message || e).slice(0, 80)})`, 할일: "1~2분 뒤 다시 말해 주세요."};
  }
}

export async function 바꾼기록({작업폴더, 몇 = 10} = {}) {
  const {내, 멈춤: 못함} = await 고칠준비(작업폴더);
  if (못함) return 못함;
  const r = await 깃허브(`/repos/${내.저장소}/commits?sha=main&per_page=${Math.min(30, Number(몇) || 10)}`, {토큰: 내.토큰});
  if (r.상태 !== 200) return {결과: "멈춤", 원인: 연결안내(r.상태), 할일: ""};
  const 기록 = (r.몸 || []).filter((c) => (c.parents || []).length > 0).map((c) => ({
    날짜: new Date(new Date(c.commit.author.date).getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16),
    설명: String(c.commit.message || "").replace(/^\[메킷 키트\]\s*/, "").split("\n")[0],
  }));
  return {저장소: 내.저장소, 기록};
}

// ───────── 옛 판 대본이 부르던 이름들 (10/17 크롬 포크 · 10/19 토큰 붙여넣기) ─────────
const 대본바뀜 = {결과: "대본 바뀜", 다음: "내 커스텀 키트 만드는 방식이 바뀌었다 (깃허브 코드 입력 연결, 코덱스 채팅에서 바로 고치기). 작업 폴더의 AGENTS.md 를 다시 읽고 '내 커스텀 키트 만들기' 절 그대로 한다. 수강생에게는 이 문장을 보여 주지 않는다."};
export async function 크롬확장() { return ""; }
export async function 만들기() { return 대본바뀜; }
export async function 연결() { return 대본바뀜; }
// 이 키트가 지금 내 키트(커스텀)로 돌고 있는지 — 대본 안내용
export async function 지금키트() { return {저장소: await 이키트저장소(), 공식: 작게(await 이키트저장소()) === 공식저장소}; }
