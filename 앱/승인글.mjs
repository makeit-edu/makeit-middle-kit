// 앱/승인글.mjs — 코덱스 앱 판 진입 모듈. 로더가 임시 폴더에 풀어 import 한다.
//
// 코드스페이스 판에서 검은 창에 치던 `키설정` · `진단` · "승인글 자동화 시작해" 를
// 코덱스 채팅에서 그대로 하기 위한 함수들. 글을 만드는 프로그램은 새로 짜지 않았다 —
// 코드스페이스 판과 똑같은 `99_절대_건들지마세요_프로그램파일/scripts/*.mjs` 를 Worker 스레드로 돌린다.
// (2026-09-20 실측: node_repl 의 Worker 에는 process.argv/env/stdout 이 다 있어 스크립트를 수정 없이 실행할 수 있다)
//
// 수강생 폴더(작업폴더)에 남는 것: 애드센스 승인글/00_설정/설정.json (키·사이트), 01_제목넣는곳, 02_생성결과_확인용.
// 프로그램은 임시 폴더에만 있다가 지워진다.

import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {Worker} from "node:worker_threads";
import {homedir} from "node:os";

export const 버전 = "2026-09-23a";

const 여기 = dirname(fileURLToPath(import.meta.url));            // <임시>/앱
const 프로그램폴더 = join(여기, "..", "99_절대_건들지마세요_프로그램파일");
const 스크립트 = (이름) => join(프로그램폴더, "scripts", 이름);

const 승인글폴더 = (작업폴더) => join(작업폴더, "애드센스 승인글");
const 설정파일 = (작업폴더) => join(승인글폴더(작업폴더), "00_설정", "설정.json");
const 제목폴더 = (작업폴더) => join(승인글폴더(작업폴더), "01_제목넣는곳");
const 결과폴더 = (작업폴더) => join(승인글폴더(작업폴더), "02_생성결과_확인용");

const 기본수강코드 = ["weolbumakeitmiddle"];

// ───────── 키설정.txt (수강생이 직접 채우는 파일) ─────────
//
// 채팅으로 하나씩 묻는 대신, 수강생이 이 파일에 네 가지(OpenAI 키·사이트 주소·관리자 아이디·앱 비밀번호)를 적어 채팅에 끌어다 놓으면 코덱스가 읽어 확인·저장한다 (2026-09-20 진현님 지시). 수강 코드는 채팅으로, 충전액은 없앰 (2026-09-21).
const 키설정파일 = (작업폴더) => join(승인글폴더(작업폴더), "00_설정", "키설정.txt");
const 키설정템플릿 = `# 아래 순서대로 한 줄에 하나씩 넣고 저장하세요. (이 줄은 지워도 됩니다)
# 1 OpenAI 키  2 사이트 주소  3 워드프레스 관리자 아이디  4 애플리케이션 비밀번호
# 사이트가 더 있으면 주소·아이디·비밀번호 세 줄을 같은 순서로 이어서 적으세요.
# 이 파일은 비밀번호가 들어 있으니 남에게 보내거나 채팅방에 올리지 마세요.
`;

export async function 키설정파일만들기({작업폴더}) {
  const 파일 = 키설정파일(작업폴더);
  await mkdir(dirname(파일), {recursive: true});
  if (!existsSync(파일)) await writeFile(파일, 키설정템플릿, "utf8");
  return 파일;
}

// 두 가지 형식을 다 읽는다.
//   ① 라벨 있음: `수강코드=값` 또는 `수강코드: 값`
//   ② 라벨 없음(2026-09-21 진현님): 값만 한 줄에 하나씩 (빈 줄로 띄어도 됨). 순서는 수강코드 → OpenAI키 → 사이트주소 → 관리자아이디 → 앱비밀번호,
//      사이트가 더 있으면 주소·아이디·비밀번호를 같은 순서로 반복. 순서가 섞여도 값 모양(sk-, 주소, 24자 비밀번호)으로 최대한 알아본다.
const 알려진라벨 = /^(수강코드|OpenAI키|openai키|OPENAI키|오픈AI키|사이트주소\d*|관리자아이디\d*|앱비밀번호\d*|충전한달러|도메인|사이트|아이디|워드프레스아이디|애플리케이션비밀번호|비밀번호)$/;
function 키설정파일읽기(text, 수강코드목록 = 기본수강코드) {
  const 값 = {};
  const 무라벨 = [];
  for (const 원줄 of String(text || "").split(/\r?\n/)) {
    const 줄 = 원줄.trim();
    if (!줄 || 줄.startsWith("#")) continue;
    let i = 줄.indexOf("=");
    if (i < 0) i = 줄.indexOf(":");
    // "https://..." 의 콜론은 라벨이 아니다
    const k = i > 0 ? 줄.slice(0, i).trim().replace(/\s+/g, "") : "";
    if (i > 0 && 알려진라벨.test(k)) {
      값[k] = 줄.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    } else {
      무라벨.push(줄.replace(/^["']|["']$/g, ""));
    }
  }
  if (무라벨.length) {
    // 모양으로 먼저 골라낸다
    const 남은 = [];
    for (const v of 무라벨) {
      const 붙인 = v.replace(/\s+/g, "");
      if (!값.수강코드 && 수강코드목록.includes(v)) { 값.수강코드 = v; continue; }
      if (!값.OpenAI키 && /^sk-[A-Za-z0-9_-]{16,}$/.test(붙인)) { 값.OpenAI키 = 붙인; continue; }
      남은.push(v);
    }
    // 남은 줄: 주소(도메인 모양) → 그 뒤 아이디 → 그 뒤 비밀번호 순으로 사이트 묶음
    let n = 0;
    for (let i = 0; i < 남은.length; i += 1) {
      const v = 남은[i];
      const 주소같음 = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(v.replace(/\s+/g, ""));
      if (주소같음) {
        n += 1;
        const 접미 = n === 1 ? "" : String(n);
        값[`사이트주소${접미}`] = v;
        if (i + 1 < 남은.length) 값[`관리자아이디${접미}`] = 남은[i + 1];
        if (i + 2 < 남은.length) 값[`앱비밀번호${접미}`] = 남은[i + 2];
        i += 2;
      } else {
        // 주소 모양이 아닌 낯선 줄. 수강 코드는 채팅으로 받으므로 (2026-09-21) 여기서 수강 코드로 넘겨짚지 않고 "알 수 없는 줄" 로 돌려준다.
        (값.알수없음 ||= []).push(v);
      }
    }
  }
  return 값;
}

// 수강생이 채팅에 붙여넣거나 끌어다 놓은 txt 내용(`내용`)을 읽어 항목마다 확인하고 설정에 저장한다.
// `내용` 이 없으면 폴더의 키설정.txt 를 읽는다. 받은 내용은 키설정.txt 에도 저장해 둔다 (다음에 고칠 때 참고).
export async function 키설정적용({작업폴더, 내용 = "", 수강코드목록 = 기본수강코드}) {
  const 파일 = await 키설정파일만들기({작업폴더});
  let 원문 = String(내용 || "").trim();
  if (원문) {
    // 붙여넣기 때 섞이는 코드펜스·전각 = 정리
    원문 = 원문.replace(/^```[a-z]*\s*|```$/g, "").replace(/＝/g, "=").replace(/：/g, ":");
    await writeFile(파일, 원문 + "\n", "utf8");
  } else {
    원문 = await readFile(파일, "utf8");
  }
  const 값 = 키설정파일읽기(원문, 수강코드목록);
  const 결과 = {수강코드: "", openai키: "", 사이트: [], 전부됨: false};
  if (값.알수없음?.length) 결과.알수없음 = 값.알수없음; // 무엇인지 몰라 건너뛴 줄 (수강생에게 어느 줄인지 알려 줄 것)

  const 기존 = await 설정읽기(작업폴더);
  // 수강 코드 — 파일에 없어도 이미 저장돼 있으면 그대로 (사이트만 추가하려고 줄 때)
  if (!값.수강코드) 결과.수강코드 = 수강코드목록.includes(기존.수강코드) ? "됨" : "비어 있음";
  else {
    const r = await 수강코드저장({작업폴더, 코드: 값.수강코드, 수강코드목록});
    결과.수강코드 = r.저장 ? "됨" : "틀림";
  }
  // OpenAI 키
  const 키원문 = 값.OpenAI키 || 값.openai키 || 값.OPENAI키 || 값.오픈AI키 || "";
  if (!키원문) 결과.openai키 = 기존.openai키 ? "됨" : "비어 있음";
  else {
    const r = await 키저장({작업폴더, 키: 키원문});
    결과.openai키 = r.저장 ? "됨" : `틀림 (${r.이유})`;
  }
  // 사이트 — 파일에 적힌 순서가 아니라 주소로 대조한다. 이미 있는 주소는 같은 번호, 새 주소는 다음 빈 번호 (최대 10).
  // 그래서 나중에 사이트를 늘릴 때 새 사이트 세 줄만 적어 다시 줘도 되고, 전부 다시 적어 줘도 된다. 파일에 없는 기존 사이트는 그대로 둔다.
  const 파일사이트 = [];
  for (let n = 1; n <= 10; n += 1) {
    const 접미 = n === 1 ? "" : String(n);
    const 주소 = 값[`사이트주소${접미}`] || (n === 1 ? 값.도메인 || 값.사이트 : "") || "";
    const 아이디 = 값[`관리자아이디${접미}`] || (n === 1 ? 값.아이디 || 값.워드프레스아이디 : "") || "";
    const 비번 = 값[`앱비밀번호${접미}`] || (n === 1 ? 값.애플리케이션비밀번호 || 값.비밀번호 : "") || "";
    if (주소 || 아이디 || 비번) 파일사이트.push({주소, 아이디, 비번});
  }
  if (파일사이트.length === 0) {
    if ((기존.사이트 || []).length) for (const s of 기존.사이트) 결과.사이트.push({번호: s.번호, 상태: "연결 됨", 주소: s.주소, 유지: true});
    else 결과.사이트.push({번호: 1, 상태: "비어 있음"});
  }
  const 쓰인번호 = new Set((기존.사이트 || []).map((s) => Number(s.번호)));
  for (const {주소, 아이디, 비번} of 파일사이트) {
    const 같은 = (기존.사이트 || []).find((s) => 주소 && 주소정리(s.주소) === 주소정리(주소));
    let n = 같은 ? Number(같은.번호) : 0;
    if (!n) { n = 1; while (쓰인번호.has(n) && n < 10) n += 1; if (쓰인번호.has(n)) { 결과.사이트.push({번호: 0, 상태: "사이트는 최대 10개까지예요", 주소}); continue; } }
    쓰인번호.add(n);
    if (!주소 || !아이디 || !비번) {
      결과.사이트.push({번호: n, 상태: "세 칸 중 빈 칸이 있음", 주소});
      continue;
    }
    const r = await 사이트저장({작업폴더, 번호: n, 주소, 아이디, 앱비밀번호: 비번});
    if (!r.저장) 결과.사이트.push({번호: n, 상태: `틀림 (${r.이유})`});
    else if (r.연결확인 === "됨") 결과.사이트.push({번호: n, 상태: "연결 됨", 주소: 주소정리(주소)});
    else {
      const 실패줄 = (r.화면 || "").split("\n").find((l) => l.includes("[실패]") || l.includes("[확인 필요]")) || "";
      결과.사이트.push({번호: n, 상태: "연결 안 됨", 주소: 주소정리(주소), 이유: 실패줄.replace(/^\[[^\]]+\]\s*/, "").slice(0, 160)});
    }
  }
  결과.전부됨 = 결과.수강코드 === "됨" && 결과.openai키 === "됨" && 결과.사이트.some((s) => s.상태 === "연결 됨") && !결과.사이트.some((s) => s.상태 !== "연결 됨");
  // 이번 파일에 없어서 그대로 둔 기존 사이트도 목록에 넣는다
  const 최종 = await 설정읽기(작업폴더);
  결과.사이트수 = (최종.사이트 || []).length;
  결과.사이트목록 = (최종.사이트 || []).map((s) => `${s.번호}번 ${s.주소}`);
  결과.파일 = 파일;
  return 결과;
}

// ───────── 설정 ─────────

export async function 설정읽기(작업폴더) {
  try {
    const 값 = JSON.parse(await readFile(설정파일(작업폴더), "utf8"));
    return {수강코드: "", openai키: "", 충전달러: 0, 충전시각: "", 사이트: [], ...값};
  } catch {
    return {수강코드: "", openai키: "", 충전달러: 0, 충전시각: "", 사이트: []};
  }
}

async function 설정쓰기(작업폴더, 설정) {
  await mkdir(dirname(설정파일(작업폴더)), {recursive: true});
  await writeFile(설정파일(작업폴더), JSON.stringify(설정, null, 2) + "\n", "utf8");
}

function 가리기(값) {
  const t = String(값 || "").trim();
  if (!t) return "";
  if (t.length <= 8) return "****";
  return `${t.slice(0, 3)}****${t.slice(-4)}`;
}

// 설정 → 스크립트가 읽는 환경변수 (.env.local 대신)
function 환경변수(작업폴더, 설정) {
  const env = {
    MAKEIT_PROJECT_ROOT: 작업폴더,
    MAKEIT_MIDDLE_LICENSE: 설정.수강코드 || "",
    OPENAI_API_KEY: 설정.openai키 || "",
    OPENAI_BUDGET_USD: 설정.충전달러 > 0 ? String(설정.충전달러) : "",
    OPENAI_BUDGET_SET_AT: 설정.충전시각 || "",
  };
  (설정.사이트 || []).forEach((s, i) => {
    const 번호 = String(s.번호 || i + 1).padStart(2, "0");
    env[`ADSENSE_SITE_${번호}_URL`] = s.주소 || "";
    env[`ADSENSE_SITE_${번호}_USER`] = s.아이디 || "";
    env[`ADSENSE_SITE_${번호}_APP_PASSWORD`] = s.앱비밀번호 || "";
  });
  return env;
}

// 화면에 보여 줄 설정 상태 (비밀값은 가림)
export async function 설정상태(작업폴더, 수강코드목록 = 기본수강코드) {
  const 설정 = await 설정읽기(작업폴더);
  return {
    수강코드: 설정.수강코드 ? (수강코드목록.includes(설정.수강코드) ? "입력됨" : "틀림") : "없음",
    openai키: 설정.openai키 ? `입력됨 ${가리기(설정.openai키)}` : "없음",
    사이트: (설정.사이트 || []).map((s, i) => `사이트${s.번호 || i + 1}: ${s.주소}`),
  };
}

export async function 수강코드저장({작업폴더, 코드, 수강코드목록 = 기본수강코드}) {
  const c = String(코드 || "").trim();
  if (!수강코드목록.includes(c)) return {저장: false, 이유: "수강 코드가 맞지 않습니다. 강의 자료실 공지의 코드를 다시 확인해 주세요."};
  const 설정 = await 설정읽기(작업폴더);
  설정.수강코드 = c;
  await 설정쓰기(작업폴더, 설정);
  return {저장: true};
}

async function 키검사(키) {
  try {
    const r = await fetch("https://api.openai.com/v1/models", {headers: {Authorization: `Bearer ${키}`}, signal: AbortSignal.timeout(10000)});
    if (r.status === 401) return {ok: false, 이유: "키가 맞지 않습니다 (401). 앞뒤가 잘리지 않았는지 확인해 주세요."};
    if (!r.ok) return {ok: false, 이유: `OpenAI 응답 ${r.status}. 잠시 후 다시 해주세요.`};
    return {ok: true};
  } catch {
    return {ok: false, 이유: "OpenAI 에 연결하지 못했습니다. 인터넷을 확인해 주세요."};
  }
}

export async function 키저장({작업폴더, 키}) {
  const k = String(키 || "").trim().replace(/\s+/g, "");
  if (!k.startsWith("sk-") || k.length < 20) return {저장: false, 이유: "sk- 로 시작하는 OpenAI 키가 아닙니다."};
  const 검사 = await 키검사(k);
  if (!검사.ok) return {저장: false, 이유: 검사.이유};
  const 설정 = await 설정읽기(작업폴더);
  설정.openai키 = k;
  await 설정쓰기(작업폴더, 설정);
  return {저장: true, 키: 가리기(k)};
}

export async function 충전액저장({작업폴더, 달러}) {
  const n = Number(String(달러 || "").replace(/[$,\s달러]/g, ""));
  if (!(n > 0 && n < 100000)) return {저장: false, 이유: "숫자만 넣어 주세요. 예: 10"};
  const 설정 = await 설정읽기(작업폴더);
  if (설정.충전달러 !== n) {
    설정.충전달러 = n;
    설정.충전시각 = new Date().toISOString();
  }
  await 설정쓰기(작업폴더, 설정);
  return {저장: true, 충전달러: n};
}

function 주소정리(값) {
  let u = String(값 || "").trim().replace(/\s+/g, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

export async function 사이트저장({작업폴더, 번호 = 1, 주소, 아이디, 앱비밀번호}) {
  const n = Number(번호) || 1;
  const u = 주소정리(주소);
  const id = String(아이디 || "").trim();
  const pw = String(앱비밀번호 || "").trim();
  if (!u) return {저장: false, 이유: "사이트 주소가 비어 있습니다."};
  if (!id) return {저장: false, 이유: "관리자 아이디가 비어 있습니다."};
  if (pw.replace(/\s/g, "").length < 16) return {저장: false, 이유: "애플리케이션 비밀번호가 너무 짧습니다 (보통 24글자, 띄어쓰기 포함)."};
  const 설정 = await 설정읽기(작업폴더);
  설정.사이트 = (설정.사이트 || []).filter((s) => Number(s.번호) !== n);
  설정.사이트.push({번호: n, 주소: u, 아이디: id, 앱비밀번호: pw});
  설정.사이트.sort((a, b) => a.번호 - b.번호);
  await 설정쓰기(작업폴더, 설정);
  // 저장 즉시 실제로 접속해 본다 (코드스페이스 판의 연결 점검 스크립트 그대로)
  const 점검 = await 실행({작업폴더, 스크립트이름: "wordpress-connection-check.mjs", argv: [], 시간초: 60});
  return {저장: true, 연결확인: 점검.종료코드 === 0 ? "됨" : "확인 필요", 화면: 점검.출력};
}

// ───────── 제목 ─────────

function 제목파일(작업폴더, 사이트) {
  return join(제목폴더(작업폴더), `사이트${사이트}제목.txt`);
}

// 수강생이 주는 제목 파일은 제각각이다 — "주제" 기능이 만든 카테고리 형식(설명문·진행 상황·"다음" 같은 잡줄 포함)일 수도,
// 그냥 한 줄에 제목 하나일 수도 있다. 여기서 알아서 골라낸다:
//   1) `1. 제목` / `12) 제목` 처럼 번호가 붙은 줄이 하나라도 있으면 → 번호 줄만 제목으로 (번호는 뗀다). 카테고리 헤더 줄은 함께 남겨 카테고리 매핑을 살린다.
//   2) 번호 줄이 하나도 없으면 → 빈 줄·# 줄을 뺀 나머지 전부를 제목으로.
export function 제목정제(text) {
  const 줄 = String(text || "").replace(/^```[a-z]*\s*|```$/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const 번호줄 = /^(\d{1,4})\s*[.)]\s*(\S.*)$/;
  const 대분류 = /^(\[?\d+\s*\/\s*\d+\]?\s*)?카테고리\s*\d+\s*:/; // "[1/5] 카테고리 1:" 도, 괄호가 빠진 "1/5] 카테고리 1:" 도
  const 소분류 = /^세부\s*카테고리\s*\d+\s*-\s*\d+\s*:/;
  const 번호있음 = 줄.some((l) => 번호줄.test(l));
  const 남김 = [];
  let 제목수 = 0;
  if (번호있음) {
    for (const l of 줄) {
      if (대분류.test(l) || 소분류.test(l)) { 남김.push(l); continue; }
      const m = l.match(번호줄);
      if (m) { 남김.push(l); 제목수 += 1; }
    }
  } else {
    for (const l of 줄) {
      if (l.startsWith("#")) continue;
      남김.push(l); 제목수 += 1;
    }
  }
  const 카테고리수 = 남김.filter((l) => 대분류.test(l)).length;
  return {정제: 남김.join("\n"), 제목수, 카테고리수, 방식: 번호있음 ? "번호 줄만" : "한 줄 하나"};
}

// 제목 받기 — `제목들`(붙여넣은 글) 또는 `파일경로`(첨부 파일) 중 하나를 준다.
export async function 제목추가({작업폴더, 사이트 = 1, 제목들 = "", 파일경로 = ""}) {
  let 원문 = String(제목들 || "");
  if (!원문.trim() && 파일경로) {
    try { 원문 = await readFile(String(파일경로).replace(/^~/, homedir()), "utf8"); } catch (e) { return {추가: 0, 이유: `파일을 읽지 못했습니다: ${파일경로}`}; }
  }
  const {정제, 제목수, 카테고리수, 방식} = 제목정제(원문);
  if (제목수 === 0) return {추가: 0, 이유: "제목을 찾지 못했습니다. 한 줄에 제목 하나, 또는 '1. 제목' 처럼 번호가 붙은 형식이어야 합니다."};
  await mkdir(제목폴더(작업폴더), {recursive: true});
  const 파일 = 제목파일(작업폴더, 사이트);
  const 앞 = existsSync(파일) ? (await readFile(파일, "utf8")).trimEnd() : "";
  await writeFile(파일, (앞 ? 앞 + "\n" : "") + 정제 + "\n", "utf8");
  return {추가: 제목수, 카테고리수, 방식, ...(await 제목상태({작업폴더, 사이트, 워드프레스대조: true}))};
}

function 제목키(t) {
  return String(t || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().normalize("NFC").toLowerCase();
}

// 워드프레스에 이미 올라가 있는 글 제목 전부 (임시글·비공개 포함). 글 만드는 프로그램의 fetchAllPostTitles 와 같은 규칙.
async function 워드프레스제목들({주소, 아이디, 앱비밀번호}) {
  const {wpFetch} = await import(`file://${스크립트("lib/wp.mjs")}`);
  const base = 주소정리(주소);
  const cred = Buffer.from(`${아이디}:${앱비밀번호}`).toString("base64");
  const titles = [];
  for (let page = 1; page <= 30; page += 1) {
    const url = `${base}/wp-json/wp/v2/posts?context=edit&status=draft,pending,future,publish,private&per_page=100&page=${page}&orderby=id&order=asc&_fields=title`;
    let r;
    try { r = await wpFetch(url, {headers: {Authorization: `Basic ${cred}`, Accept: "application/json"}}); } catch (e) { return {titles, 완료: false, 이유: String(e?.message || e)}; }
    if (r.status === 400) break;
    if (!r.ok) return {titles, 완료: false, 이유: `상태 코드 ${r.status}`};
    let data; try { data = await r.json(); } catch { return {titles, 완료: false, 이유: "응답 해석 실패"}; }
    if (!Array.isArray(data) || data.length === 0) break;
    for (const p of data) { const t = String(p?.title?.raw || p?.title?.rendered || "").replace(/<[^>]+>/g, " ").trim(); if (t) titles.push(t); }
    if (data.length < 100) break;
  }
  return {titles, 완료: true};
}

// 제목 상태. `워드프레스대조: true` 면 그 사이트에 이미 있는 글과 제목을 맞춰 보고, 이미 있는 건 "남은수" 에서 뺀다.
export async function 제목상태({작업폴더, 사이트 = 1, 워드프레스대조 = false}) {
  const 파일 = 제목파일(작업폴더, 사이트);
  let 제목들 = [];
  try {
    const {readTitleEntries} = await import(`file://${스크립트("title-files.mjs")}`);
    제목들 = existsSync(파일) ? (readTitleEntries(파일).entries || []).map((e) => e.title) : [];
  } catch {
    if (existsSync(파일)) 제목들 = (await readFile(파일, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  }
  const 전체 = 제목들.length;
  const 쓴키 = new Set();
  try {
    const rows = JSON.parse(await readFile(join(결과폴더(작업폴더), `site-${String(사이트).padStart(2, "0")}`, "draft-history.json"), "utf8"));
    if (Array.isArray(rows)) for (const r of rows) if (r && r.title) 쓴키.add(제목키(r.title));
  } catch {}
  const 만든수 = 쓴키.size;
  let 워드프레스에이미있음 = null, 대조 = "안 함";
  if (워드프레스대조) {
    const 설정 = await 설정읽기(작업폴더);
    const s = (설정.사이트 || []).find((x) => Number(x.번호) === Number(사이트));
    if (s) {
      const r = await 워드프레스제목들(s);
      const wp = new Set(r.titles.map(제목키));
      워드프레스에이미있음 = 제목들.filter((t) => wp.has(제목키(t)) && !쓴키.has(제목키(t))).length;
      for (const t of 제목들) if (wp.has(제목키(t))) 쓴키.add(제목키(t));
      대조 = r.완료 ? `됨 (워드프레스 글 ${r.titles.length}개 확인)` : `일부만 (${r.이유})`;
    } else 대조 = "사이트 정보 없음";
  }
  const 남은수 = 제목들.filter((t) => !쓴키.has(제목키(t))).length;
  return {사이트, 제목수: 전체, 만든수, 워드프레스에이미있음, 대조, 남은수};
}

// ───────── 실행 (코드스페이스 판 스크립트를 Worker 로) ─────────

async function 실행({작업폴더, 스크립트이름, argv = [], 시간초 = 1400}) {
  const 설정 = await 설정읽기(작업폴더);
  const 경로 = 스크립트(스크립트이름);
  if (!existsSync(경로)) return {종료코드: -1, 출력: `프로그램 파일이 없습니다: ${스크립트이름}`};
  let 출력 = "";
  const 종료코드 = await new Promise((res) => {
    let w;
    const 끝 = (c) => { clearTimeout(t); res(c); };
    const t = setTimeout(() => { try { w?.terminate(); } catch {} 출력 += `\n(시간 초과 ${시간초}초 — 다음 호출에서 이어집니다)\n`; res(124); }, 시간초 * 1000);
    try {
      // execArgv 를 비운다 — 부모가 --input-type 같은 옵션으로 떠 있으면 Worker 가 그걸 물려받아 죽는다 (실측)
      w = new Worker(경로, {argv, execArgv: [], env: 환경변수(작업폴더, 설정), stdout: true, stderr: true});
      w.stdout.on("data", (d) => { 출력 += d.toString(); });
      w.stderr.on("data", (d) => { 출력 += d.toString(); });
      w.on("error", (e) => { 출력 += `\n오류: ${e?.message || e}\n`; 끝(1); });
      w.on("exit", (c) => 끝(c));
    } catch (e) {
      출력 += `\n실행 실패: ${e?.message || e}\n`;
      끝(1);
    }
  });
  return {종료코드, 출력: 출력.replace(/\[[0-9;]*[A-Za-z]/g, "")};
}

function 마지막줄들(text, n) {
  const 줄 = String(text || "").split("\n");
  return 줄.slice(Math.max(0, 줄.length - n)).join("\n");
}

// 글 만들기 — 한 번 부르면 글 `개수`개 (대본은 1개씩 반복해서 부른다: 25분 한도 + 글마다 게이지·💰 보고)
// 중복 실행 잠금 — 같은 일이 이미 돌고 있으면 두 번째 호출은 바로 돌려보낸다.
// 2026-09-23 실측: 코덱스가 셸로 글 만들기를 기다리지 못하고 같은 명령을 한 번 더 시작했다 (글 2개가 생길 뻔함).
// 잠금 파일에 프로세스 번호를 적어 두고, 그 프로세스가 죽었거나 20분이 지났으면 낡은 잠금으로 보고 걷어 낸다.
export async function 잠금으로({작업폴더, 이름, 일}) {
  const 파일 = join(작업폴더, "애드센스 승인글", "02_생성결과_확인용", `.${이름}.잠금`);
  try {
    const s = await stat(파일);
    const pid = Number((await readFile(파일, "utf8")).trim()) || 0;
    let 살아있음 = true;
    const 프로세스 = globalThis.process;
    if (pid && 프로세스 && typeof 프로세스.kill === "function") { try { 프로세스.kill(pid, 0); } catch { 살아있음 = false; } }
    if (살아있음 && Date.now() - s.mtimeMs < 20 * 60 * 1000) {
      return {결과: "이미 하는 중", 안내: "앞에서 시작한 작업이 아직 돌고 있어요. 끝날 때까지 기다린 뒤 결과를 보세요. 같은 명령을 다시 실행하지 않는다."};
    }
  } catch {}
  await mkdir(dirname(파일), {recursive: true});
  await writeFile(파일, String(globalThis.process?.pid || 0), "utf8");
  try { return await 일(); } finally { await rm(파일, {force: true}).catch(() => {}); }
}

export async function 글만들기(옵션 = {}) {
  if (!옵션.작업폴더) throw new Error("작업폴더 가 필요합니다");
  return 잠금으로({작업폴더: 옵션.작업폴더, 이름: `승인글-사이트${Number(옵션.사이트) || 1}`, 일: () => 글만들기본체(옵션)});
}

async function 글만들기본체({작업폴더, 사이트 = 1, 개수 = 1, 날짜모드 = "", 시작날짜 = "", 무작위일수 = 0, 시간간격 = 0, 하루개수 = 0, 최소간격시간 = 0}) {
  const 설정 = await 설정읽기(작업폴더);
  const 빠진 = [];
  if (!설정.수강코드) 빠진.push("수강 코드");
  if (!설정.openai키) 빠진.push("OpenAI 키");
  if (!(설정.사이트 || []).some((s) => Number(s.번호) === Number(사이트))) 빠진.push(`사이트${사이트} 워드프레스 정보`);
  if (빠진.length) return {결과: "설정 필요", 빠진};
  const 앞상태 = await 제목상태({작업폴더, 사이트});
  if (앞상태.남은수 === 0) return {결과: "제목 없음", ...앞상태};

  const argv = [`--site=${사이트}`, `--limit=${개수}`];
  if (날짜모드) argv.push(`--date-mode=${날짜모드}`);
  if (하루개수) argv.push(`--per-day=${하루개수}`);
  if (최소간격시간) argv.push(`--min-gap-hours=${최소간격시간}`);
  if (시작날짜) argv.push(`--start-date=${시작날짜}`);
  if (무작위일수) argv.push(`--random-days=${무작위일수}`);
  if (시간간격) argv.push(`--hour-gap=${시간간격}`);
  if (날짜모드 && 날짜모드 !== "now" && 날짜모드 !== "spread") argv.push(`--date-offset=${앞상태.만든수}`); // 글 1개씩 불러도 날짜 순번이 이어지게
  if (!날짜모드 || 날짜모드 === "spread") {
    // 기본(spread): 오늘 이 사이트에서 이미 만든 글 수만큼 슬롯을 건너뛴다 — 1개씩 불러도 하루 3개·최소 3시간 간격이 유지된다
    let 오늘만든 = 0;
    try {
      const {원장읽기} = await import(`file://${스크립트("lib/usage.mjs")}`);
      const 원장 = 원장읽기(join(결과폴더(작업폴더), "사용량.json"));
      const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      오늘만든 = 원장.글.filter((g) => Number(g.site) === Number(사이트) && new Date(new Date(g.때).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) === kst).length;
    } catch {}
    if (오늘만든 > 0) argv.push(`--date-offset=${오늘만든}`);
  }
  const r = await 실행({작업폴더, 스크립트이름: "adsense-create-drafts.mjs", argv});

  const 줄 = r.출력.split("\n");
  const 게이지 = [...줄].reverse().find((l) => /^\[[■□]+\]/.test(l.trim())) || "";
  const 돈 = 줄.filter((l) => l.includes("💰")).map((l) => l.trim());
  const 완료 = 줄.filter((l) => l.includes("✅ 완료")).map((l) => l.trim());
  const 실패 = 줄.filter((l) => /^\s*실패:/.test(l)).map((l) => l.trim());
  const 건너뜀 = 줄.filter((l) => /^\s*건너뜀:/.test(l)).map((l) => l.trim());
  const 뒤상태 = await 제목상태({작업폴더, 사이트});
  const 만든수 = Math.max(뒤상태.만든수 - 앞상태.만든수, 0);
  // 이번에 만든 글의 제목·발행 날짜·편집 링크 (프로그램이 남긴 last-run.json 에서)
  let 이번글 = [];
  try {
    const rows = JSON.parse(await readFile(join(결과폴더(작업폴더), `site-${String(사이트).padStart(2, "0")}`, "last-run.json"), "utf8"));
    이번글 = (Array.isArray(rows) ? rows : []).filter((x) => x && x.ok && !x.skipped).map((x) => {
      const d = x.date ? new Date(x.date) : null;
      const 날짜 = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : String(x.date || "");
      return {제목: x.title, 발행날짜: 날짜, 상태: "임시글", 링크: x.editLink || ""};
    });
  } catch {}
  let 결과 = "됨";
  if (r.종료코드 === 124) 결과 = "시간 초과";
  else if (만든수 === 0 && 실패.length) 결과 = "실패";
  else if (만든수 === 0 && 건너뜀.length) 결과 = "건너뜀";
  else if (만든수 === 0) 결과 = "안 만들어짐";
  // 실패했으면 "수강생이 할 일" 을 붙인다 (첫 실패 줄 기준). 종류가 "프로그램" 이면 문의 대상.
  const 할일 = 결과 === "실패" && 실패.length ? 처방또는프로그램(실패[0]) : (결과 === "시간 초과" ? 처방또는프로그램("시간 초과") : null);
  return {
    결과,
    이번에만든수: 만든수,
    게이지,
    돈,
    완료,
    실패,
    할일,
    건너뜀,
    이번글,
    남은제목: 뒤상태.남은수,
    지금까지만든수: 뒤상태.만든수,
    다음: 뒤상태.남은수 > 0 ? `앱.승인글.글만들기({ 작업폴더, 사이트: ${사이트}, 개수: 1 })` : "",
    화면: 마지막줄들(r.출력, 40),
  };
}

// 임시글 날짜 다시 흩기 — 이미 만들어진 임시글(아직 공개 안 된 것)의 발행일을 하루 N개·최소 M시간 간격·무작위 시각으로 다시 잡는다.
// 2026-09-21: 옛 판으로 만들어 12시대에 몰린 글 10개를 되돌리는 용도. 공개된 글은 건드리지 않는다.
export async function 날짜재배치({작업폴더, 사이트 = 1, 하루개수 = 3, 최소간격시간 = 3}) {
  const 설정 = await 설정읽기(작업폴더);
  const s = (설정.사이트 || []).find((x) => Number(x.번호) === Number(사이트));
  if (!s) return {결과: "설정 필요", 빠진: [`사이트${사이트} 워드프레스 정보`]};
  const {wpFetch} = await import(`file://${스크립트("lib/wp.mjs")}`);
  const base = 주소정리(s.주소);
  const cred = Buffer.from(`${s.아이디}:${s.앱비밀번호}`).toString("base64");
  const 헤더 = {Authorization: `Basic ${cred}`, Accept: "application/json"};
  const 글들 = [];
  for (let page = 1; page <= 30; page += 1) {
    const r = await wpFetch(`${base}/wp-json/wp/v2/posts?context=edit&status=draft,pending,future&per_page=100&page=${page}&orderby=id&order=asc&_fields=id,title,date_gmt,status`, {headers: 헤더});
    if (r.status === 400) break;
    if (!r.ok) return {결과: "실패", 이유: `워드프레스 응답 ${r.status}`};
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    글들.push(...data);
    if (data.length < 100) break;
  }
  const 대상 = 글들.filter((p) => p.status === "draft" || p.status === "pending" || p.status === "future");
  대상.sort((a, b) => a.id - b.id);
  const KST = 9 * 3600 * 1000;
  const per = Math.max(1, 하루개수), gapMs = (Math.max(1, 최소간격시간) + 1) * 3600 * 1000;
  const now = Date.now(), 최소 = now + 10 * 60 * 1000;
  const kstNow = new Date(now + KST);
  const dayStart = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - KST;
  const slot = (day, k) => dayStart + day * 86400000 + 8 * 3600 * 1000 + k * gapMs;
  let skipped = 0;
  for (let k = 0; k < per; k += 1) if (slot(0, k) < 최소) skipped += 1;
  const 바뀜 = [];
  for (let n = 0; n < 대상.length; n += 1) {
    const i = n + skipped;
    const t = slot(Math.floor(i / per), i % per) + Math.floor(Math.random() * 60) * 60000;
    const iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, "");
    const r = await wpFetch(`${base}/wp-json/wp/v2/posts/${대상[n].id}`, {method: "POST", headers: {...헤더, "Content-Type": "application/json"}, body: JSON.stringify({date_gmt: iso, status: 대상[n].status === "future" ? "future" : "draft"})});
    const 제목 = String(대상[n].title?.raw || 대상[n].title?.rendered || "").replace(/<[^>]+>/g, "");
    const kst = new Date(t + KST).toISOString().replace("T", " ").slice(0, 16);
    바뀜.push({제목, 발행날짜: kst, 됨: r.ok});
  }
  return {결과: "됨", 재배치: 바뀜.length, 글: 바뀜};
}

// 진단 — 설정 상태 + 사이트 연결 + 지금까지 만든 글·쓴 돈
// ───────── 처방 — 오류 문구를 "수강생이 지금 할 일" 로 바꾼다 (2026-09-21 진현님: 수강생이 진단 결과로 스스로 고치게) ─────────
// 종류: 내설정(키설정·수강코드) · 사이트(워드프레스 쪽) · OpenAI · 잠시(기다리면 됨) · 프로그램(처방 목록에 없음 → 문의)
const 처방표 = [
  {종류: "OpenAI", 패턴: /insufficient_quota|exceeded your current quota|billing hard limit|quota|no credits remaining|add credits|credit balance/i,
    원인: "OpenAI 크레딧이 없어요", 할일: "platform.openai.com → Settings → Billing 에서 크레딧을 충전(5달러부터)한 뒤, 다시 '승인글 자동화 시작해' 라고 하세요."},
  {종류: "내설정", 패턴: /Incorrect API key|invalid_api_key|키가 맞지 않습니다|OpenAI[^\n]{0,40}\b401\b/i,
    원인: "OpenAI 키가 틀렸어요", 할일: "platform.openai.com → API keys 에서 키를 새로 만들어 키설정.txt 첫 줄(sk-…)을 바꾸고 다시 끌어다 놓으세요."},
  {종류: "OpenAI", 패턴: /model_not_found|does not have access to model|model[^\n]{0,40}not found|not supported/i,
    원인: "이 OpenAI 계정이 아직 이 모델을 못 써요", 할일: "platform.openai.com → Billing 에 결제 수단을 등록하고 5달러 이상 충전하면 풀려요. 그 뒤 다시 시작하세요."},
  {종류: "잠시", 패턴: /rate limit|rate_limit|Too Many Requests|OpenAI[^\n]{0,40}\b429\b/i,
    원인: "OpenAI 에 요청이 잠깐 몰렸어요", 할일: "2~3분 뒤에 다시 '승인글 자동화 시작해' 라고 하세요."},
  {종류: "잠시", 패턴: /OpenAI[^\n]{0,160}(\b5\d\d\b|server_error|overloaded|had an error|응답을 해석하지 못함)|보충 본문이 중간에 끊겼/i,
    원인: "OpenAI 서버가 잠시 불안정해요", 할일: "10분 뒤 다시 '승인글 자동화 시작해' 라고 하세요. 만들다 만 글은 없고, 안 쓴 제목부터 이어서 만들어요."},
  {종류: "내설정", 패턴: /상태 코드 401|워드프레스[^\n]{0,60}\b401\b|rest_not_logged_in|incorrect_password|invalid_username|아이디 또는 애플리케이션 비밀번호/i,
    원인: "워드프레스 아이디나 애플리케이션 비밀번호가 틀렸어요", 할일: "워드프레스 관리자 → 사용자 → 프로필 → 애플리케이션 비밀번호에서 '새로 추가' 한 뒤, 키설정.txt 의 비밀번호 줄을 새 것으로 바꾸고 다시 끌어다 놓으세요. 아이디 대신 로그인 이메일을 넣어도 돼요."},
  {종류: "사이트", 패턴: /상태 코드 403|워드프레스[^\n]{0,60}\b403\b|rest_forbidden|rest_cannot_(create|edit|publish|assign)|잠시 접속을 막았/i,
    원인: "사이트가 접속을 막았어요 (연속 실패 잠금이나 보안 플러그인)", 할일: "20~30분 뒤에 다시 하세요. 계속 그러면 워드프레스 관리자 → 플러그인에서 보안 플러그인(Wordfence, iThemes, All In One Security 등)의 'REST API 제한'을 끄고, 이 아이디의 역할이 '관리자'인지 확인하세요."},
  {종류: "사이트", 패턴: /상태 코드 404|rest_no_route|REST API 주소를 찾지 못|워드프레스[^\n]{0,60}\b404\b/i,
    원인: "워드프레스 주소는 맞는데 글쓰기 통로(REST API)가 안 열려 있어요", 할일: "워드프레스 관리자 → 설정 → 고유주소에서 '글 이름'을 고르고 저장한 뒤 다시 하세요. 그래도 안 되면 주소 뒤에 /wp-json/ 을 붙여 브라우저에서 열리는지 확인하세요."},
  {종류: "내설정", 패턴: /ENOTFOUND|getaddrinfo|fetch failed|ECONNREFUSED|certificate|CERT_|사이트 주소를 확인|연결 안 됨/i,
    원인: "사이트 주소가 틀렸거나 인터넷이 안 돼요", 할일: "키설정.txt 의 주소 줄이 https:// 로 시작하는 전체 주소인지, 그 주소를 브라우저에 쳐서 열리는지 확인하세요. 열리면 인터넷 연결을 확인하고 다시 하세요."},
  {종류: "사이트", 패턴: /카테고리 (생성|조회) 실패|rest_cannot_create_term|term/i,
    원인: "이 아이디로는 카테고리를 만들 수 없어요", 할일: "워드프레스 관리자 → 사용자에서 이 아이디의 역할을 '관리자'로 바꾸세요 (편집자·기여자는 안 돼요). 그 뒤 다시 하세요."},
  {종류: "사이트", 패턴: /대표이미지 업로드 실패|이미지 정보 저장 실패|media|upload_max|파일 크기/i,
    원인: "워드프레스가 이미지 업로드를 막았어요", 할일: "워드프레스 관리자 → 미디어 → 새로 추가에서 사진을 하나 직접 올려 보세요. 안 올라가면 호스팅 용량이나 업로드 제한 문제라 호스팅 업체에 문의하세요. 올라가면 다시 시작하세요."},
  {종류: "사이트", 패턴: /워드프레스[^\n]{0,80}\b5\d\d\b|Internal Server Error|Bad Gateway|Service Unavailable/i,
    원인: "워드프레스 서버가 오류를 냈어요 (플러그인 충돌이나 호스팅 문제)", 할일: "워드프레스 관리자에서 글을 하나 직접 임시저장해 보세요. 그것도 안 되면 호스팅 업체에 문의하세요. 되면 10분 뒤 다시 '승인글 자동화 시작해' 라고 하세요."},
  {종류: "사이트", 패턴: /rankmath/i,
    원인: "랭크매스(Rank Math) 플러그인이 없거나 꺼져 있어요", 할일: "글은 만들어졌어요. 워드프레스 → 플러그인에서 Rank Math SEO 를 설치·활성화하면 다음 글부터 키워드가 들어가요."},
  {종류: "잠시", 패턴: /시간 초과|timeout|timed out|ETIMEDOUT|ECONNRESET/i,
    원인: "응답이 너무 늦어 중간에 끊겼어요", 할일: "10분 뒤 다시 '승인글 자동화 시작해' 라고 하세요. 이미 만든 글은 그대로 있고 안 쓴 제목부터 이어서 만들어요."},
];
const 프로그램처방 = {종류: "프로그램", 원인: "처방 목록에 없는 오류예요", 할일: "프로그램 쪽 문제일 수 있어요. 이 화면을 글자로 복사해 강의 문의 채널에 올려 주세요. 고쳐지면 따로 설치할 것 없이 새 채팅에서 '승인글 자동화 시작해' 라고만 하면 돼요."};

// 오류 문구 → {종류, 원인, 할일}. 모르는 문구면 null.
export function 처방(문구) {
  const t = String(문구 || "");
  for (const p of 처방표) if (p.패턴.test(t)) return {종류: p.종류, 원인: p.원인, 할일: p.할일};
  return null;
}
function 처방또는프로그램(문구) {
  return {...(처방(문구) || 프로그램처방), 원문: String(문구 || "").replace(/^\[[^\]]+\]\s*/, "").slice(0, 200)};
}

export async function 진단({작업폴더, 수강코드목록 = 기본수강코드}) {
  const 상태 = await 설정상태(작업폴더, 수강코드목록);
  const 설정 = await 설정읽기(작업폴더);
  const 제목 = [];
  for (const s of 설정.사이트 || []) 제목.push(await 제목상태({작업폴더, 사이트: s.번호}));
  let 돈 = null;
  try {
    const {예산상태} = await import(`file://${스크립트("lib/usage.mjs")}`);
    const 원장경로 = join(결과폴더(작업폴더), "사용량.json");
    const {원장읽기} = await import(`file://${스크립트("lib/usage.mjs")}`);
    const 원장 = 원장읽기(원장경로);
    const p = 예산상태({env: 환경변수(작업폴더, 설정), 원장});
    돈 = `전체 ${p.전체.글수}개 · 약 ${Math.round(p.전체.krw).toLocaleString("ko-KR")}원`;
  } catch (e) {
    돈 = "사용량 기록 없음";
  }
  let 연결 = "사이트 정보 없음";
  if ((설정.사이트 || []).length) {
    const 점검 = await 실행({작업폴더, 스크립트이름: "wordpress-connection-check.mjs", argv: [], 시간초: 90});
    연결 = 마지막줄들(점검.출력, 15);
  }
  // 수강생이 지금 할 일 — 설정·제목·사이트 연결에서 모아 준다. "프로그램" 이 하나라도 있으면 문의 대상.
  const 할일 = [];
  if (상태.수강코드 !== "입력됨") 할일.push({종류: "내설정", 원인: `수강 코드가 ${상태.수강코드}`, 할일: "채팅에 강의 자료실 공지의 수강 코드를 알려 주세요."});
  if (상태.openai키 === "없음") 할일.push({종류: "내설정", 원인: "OpenAI 키가 없어요", 할일: "키설정.txt 를 채워 채팅에 끌어다 놓으세요."});
  if (!(상태.사이트 || []).length) 할일.push({종류: "내설정", 원인: "워드프레스 사이트가 등록돼 있지 않아요", 할일: "키설정.txt 에 사이트 주소 · 관리자 아이디 · 앱 비밀번호를 적어 채팅에 끌어다 놓으세요."});
  (설정.사이트 || []).forEach((s, i) => {
    const t = 제목[i];
    if (t && t.제목수 > 0 && t.남은수 === 0) 할일.push({종류: "내설정", 원인: `${s.번호}번 사이트의 제목이 다 떨어졌어요`, 할일: "새 제목 파일(txt)을 채팅에 끌어다 놓으세요."});
    if (t && t.제목수 === 0) 할일.push({종류: "내설정", 원인: `${s.번호}번 사이트에 아직 제목이 없어요`, 할일: "제목 파일(txt)을 채팅에 끌어다 놓으세요."});
  });
  for (const 줄 of String(연결).split("\n")) {
    if (/^\[(실패|확인 필요)\]/.test(줄.trim())) 할일.push(처방또는프로그램(줄.trim()));
  }
  const 판정 = 할일.some((x) => x.종류 === "프로그램") ? "프로그램 문제 가능 — 문의" : 할일.length ? "수강생이 고칠 수 있음" : "이상 없음";
  return {설정: 상태, 제목, 돈, 워드프레스연결: 연결, 할일, 판정};
}

// 대본 최신화 — 로더가 임시폴더에 받아 둔 앱/AGENTS.md 를 작업폴더와 전역 ~/.codex/AGENTS.md(마커 사이)에 덮어쓴다.
// 설치를 다시 하지 않아도 다음 채팅부터 새 대본이 적용된다. 실패해도 본 작업은 계속.
// 대본의 판 번호. 1주차 저장소 대본은 판 1, 2주차 저장소(승인글+네이버) 대본은 판 2.
// 더 높은 판이 이미 깔려 있으면 낮은 판으로 덮지 않는다 (2주차 설치 뒤 1주차 채팅이 돌아도 네이버 대본이 사라지지 않게).
function 대본판(글) {
  const m = /<!-- 키트판 (\d+) -->/.exec(String(글 || ""));
  return m ? Number(m[1]) : String(글 || "").includes("메킷 키트") ? 1 : 0;
}
async function 대본최신화(작업폴더) {
  try {
    const 대본 = await readFile(join(여기, "AGENTS.md"), "utf8");
    if (!대본.includes("메킷 키트")) return "건너뜀";
    let 폴더대본 = "";
    try { 폴더대본 = await readFile(join(작업폴더, "AGENTS.md"), "utf8"); } catch {}
    if (대본판(폴더대본) > 대본판(대본)) return "더 높은 판이 깔려 있어 그대로 둠";
    await writeFile(join(작업폴더, "AGENTS.md"), 대본, "utf8");
    const 시작표 = "<!-- 메킷키트 시작 (설치.mjs 가 관리. 손으로 고치지 마세요) -->";
    const 끝표 = "<!-- 메킷키트 끝 -->";
    const 전역파일 = join(homedir(), ".codex", "AGENTS.md");
    let 기존 = "";
    try { 기존 = await readFile(전역파일, "utf8"); } catch {}
    const 덩어리 = `${시작표}\n${대본.trim()}\n${끝표}`;
    const a = 기존.indexOf(시작표), b = 기존.indexOf(끝표);
    if (a >= 0 && b > a && 대본판(기존.slice(a, b)) > 대본판(대본)) return "갱신 (전역은 더 높은 판이라 그대로 둠)";
    const 새것 = a >= 0 && b > a ? 기존.slice(0, a) + 덩어리 + 기존.slice(b + 끝표.length) : (기존.trim() ? 기존.trimEnd() + "\n\n" : "") + 덩어리 + "\n";
    if (새것 !== 기존) {
      await mkdir(join(homedir(), ".codex"), {recursive: true});
      await writeFile(전역파일, 새것, "utf8");
    }
    return "갱신";
  } catch (e) {
    return "실패: " + String(e?.message || e).slice(0, 60);
  }
}

// 준비 — 대본이 첫 호출에서 부른다. 폴더를 만들고 상태를 돌려준다.
export async function 준비({작업폴더, 수강코드목록 = 기본수강코드}) {
  for (const d of ["00_설정", "01_제목넣는곳", "02_생성결과_확인용"]) await mkdir(join(승인글폴더(작업폴더), d), {recursive: true});
  const 대본 = await 대본최신화(작업폴더);
  await 키설정파일만들기({작업폴더});
  const 상태 = await 설정상태(작업폴더, 수강코드목록);
  const 설정 = await 설정읽기(작업폴더);
  const 제목 = [];
  for (const s of 설정.사이트 || []) 제목.push(await 제목상태({작업폴더, 사이트: s.번호}));
  if (제목.length === 0) 제목.push(await 제목상태({작업폴더, 사이트: 1}));
  const 키설정끝 = Boolean(설정.수강코드 && 설정.openai키 && (설정.사이트 || []).length > 0);
  return {버전, 대본, 키설정끝, 사이트수: (설정.사이트 || []).length, 사이트목록: (설정.사이트 || []).map((s) => `${s.번호}번 ${s.주소}`), 키설정파일: "애드센스 승인글/00_설정/키설정.txt", 설정: 상태, 제목};
}
