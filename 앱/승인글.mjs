// 앱/승인글.mjs — 코덱스 앱 판 진입 모듈. 로더가 임시 폴더에 풀어 import 한다.
//
// 코드스페이스 판에서 검은 창에 치던 `키설정` · `진단` · "승인글 자동화 시작해" 를
// 코덱스 채팅에서 그대로 하기 위한 함수들. 글을 만드는 프로그램은 새로 짜지 않았다 —
// 코드스페이스 판과 똑같은 `99_절대_건들지마세요_프로그램파일/scripts/*.mjs` 를 Worker 스레드로 돌린다.
// (2026-09-20 실측: node_repl 의 Worker 에는 process.argv/env/stdout 이 다 있어 스크립트를 수정 없이 실행할 수 있다)
//
// 수강생 폴더(작업폴더)에 남는 것: 애드센스 승인글/00_설정/설정.json (키·사이트), 01_제목넣는곳, 02_생성결과_확인용.
// 프로그램은 임시 폴더에만 있다가 지워진다.

import {mkdir, readFile, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {Worker} from "node:worker_threads";

export const 버전 = "2026-09-21a";

const 여기 = dirname(fileURLToPath(import.meta.url));            // <임시>/앱
const 프로그램폴더 = join(여기, "..", "99_절대_건들지마세요_프로그램파일");
const 스크립트 = (이름) => join(프로그램폴더, "scripts", 이름);

const 승인글폴더 = (작업폴더) => join(작업폴더, "애드센스 승인글");
const 설정파일 = (작업폴더) => join(승인글폴더(작업폴더), "00_설정", "설정.json");
const 제목폴더 = (작업폴더) => join(승인글폴더(작업폴더), "01_제목넣는곳");
const 결과폴더 = (작업폴더) => join(승인글폴더(작업폴더), "02_생성결과_확인용");

const 기본수강코드 = ["weolbumakeitmiddle"];

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
    충전액: 설정.충전달러 > 0 ? `${설정.충전달러}달러` : "없음",
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

export async function 제목추가({작업폴더, 사이트 = 1, 제목들}) {
  const 줄들 = (Array.isArray(제목들) ? 제목들 : String(제목들 || "").split(/\r?\n/))
    .map((t) => String(t).trim())
    .filter((t) => t && !t.startsWith("#"));
  if (줄들.length === 0) return {추가: 0, 이유: "제목이 비어 있습니다."};
  await mkdir(제목폴더(작업폴더), {recursive: true});
  const 파일 = 제목파일(작업폴더, 사이트);
  const 앞 = existsSync(파일) ? (await readFile(파일, "utf8")).trimEnd() : "";
  await writeFile(파일, (앞 ? 앞 + "\n" : "") + 줄들.join("\n") + "\n", "utf8");
  return {추가: 줄들.length, ...(await 제목상태({작업폴더, 사이트}))};
}

export async function 제목상태({작업폴더, 사이트 = 1}) {
  const 파일 = 제목파일(작업폴더, 사이트);
  let 전체 = 0;
  try {
    const {readTitleEntries} = await import(`file://${스크립트("title-files.mjs")}`);
    전체 = existsSync(파일) ? (readTitleEntries(파일).entries || []).length : 0;
  } catch {
    if (existsSync(파일)) 전체 = (await readFile(파일, "utf8")).split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  }
  let 만든수 = 0;
  try {
    const rows = JSON.parse(await readFile(join(결과폴더(작업폴더), `site-${String(사이트).padStart(2, "0")}`, "draft-history.json"), "utf8"));
    if (Array.isArray(rows)) 만든수 = rows.filter((r) => r && r.title).length;
  } catch {}
  return {사이트, 제목수: 전체, 만든수, 남은수: Math.max(전체 - 만든수, 0)};
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
export async function 글만들기({작업폴더, 사이트 = 1, 개수 = 1, 날짜모드 = "", 시작날짜 = "", 무작위일수 = 0, 시간간격 = 0}) {
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
  if (시작날짜) argv.push(`--start-date=${시작날짜}`);
  if (무작위일수) argv.push(`--random-days=${무작위일수}`);
  if (시간간격) argv.push(`--hour-gap=${시간간격}`);
  if (날짜모드 && 날짜모드 !== "now") argv.push(`--date-offset=${앞상태.만든수}`); // 글 1개씩 불러도 날짜 순번이 이어지게
  const r = await 실행({작업폴더, 스크립트이름: "adsense-create-drafts.mjs", argv});

  const 줄 = r.출력.split("\n");
  const 게이지 = [...줄].reverse().find((l) => /^\[[■□]+\]/.test(l.trim())) || "";
  const 돈 = 줄.filter((l) => l.includes("💰")).map((l) => l.trim());
  const 완료 = 줄.filter((l) => l.includes("✅ 완료")).map((l) => l.trim());
  const 실패 = 줄.filter((l) => /^\s*실패:/.test(l)).map((l) => l.trim());
  const 건너뜀 = 줄.filter((l) => /^\s*건너뜀:/.test(l)).map((l) => l.trim());
  const 뒤상태 = await 제목상태({작업폴더, 사이트});
  const 만든수 = Math.max(뒤상태.만든수 - 앞상태.만든수, 0);
  let 결과 = "됨";
  if (r.종료코드 === 124) 결과 = "시간 초과";
  else if (만든수 === 0 && 실패.length) 결과 = "실패";
  else if (만든수 === 0 && 건너뜀.length) 결과 = "건너뜀";
  else if (만든수 === 0) 결과 = "안 만들어짐";
  return {
    결과,
    이번에만든수: 만든수,
    게이지,
    돈,
    완료,
    실패,
    건너뜀,
    남은제목: 뒤상태.남은수,
    지금까지만든수: 뒤상태.만든수,
    다음: 뒤상태.남은수 > 0 ? `앱.승인글.글만들기({ 작업폴더, 사이트: ${사이트}, 개수: 1 })` : "",
    화면: 마지막줄들(r.출력, 40),
  };
}

// 진단 — 설정 상태 + 사이트 연결 + 지금까지 만든 글·쓴 돈
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
    돈 = p.있음
      ? `전체 ${p.전체.글수}개 · 약 ${Math.round(p.전체.krw).toLocaleString("ko-KR")}원 · 충전 ${p.예산usd}달러 중 ${p.쓴퍼센트}% 씀 · 남은 돈 약 ${p.남은krw.toLocaleString("ko-KR")}원 (${p.남은퍼센트}%)`
      : `전체 ${p.전체.글수}개 · 약 ${Math.round(p.전체.krw).toLocaleString("ko-KR")}원 · 남은 돈은 충전 금액을 넣으면 보여 드려요`;
  } catch (e) {
    돈 = "사용량 기록 없음";
  }
  let 연결 = "사이트 정보 없음";
  if ((설정.사이트 || []).length) {
    const 점검 = await 실행({작업폴더, 스크립트이름: "wordpress-connection-check.mjs", argv: [], 시간초: 90});
    연결 = 마지막줄들(점검.출력, 15);
  }
  return {설정: 상태, 제목, 돈, 워드프레스연결: 연결};
}

// 준비 — 대본이 첫 호출에서 부른다. 폴더를 만들고 상태를 돌려준다.
export async function 준비({작업폴더, 수강코드목록 = 기본수강코드}) {
  for (const d of ["00_설정", "01_제목넣는곳", "02_생성결과_확인용"]) await mkdir(join(승인글폴더(작업폴더), d), {recursive: true});
  const 상태 = await 설정상태(작업폴더, 수강코드목록);
  const 설정 = await 설정읽기(작업폴더);
  const 제목 = [];
  for (const s of 설정.사이트 || []) 제목.push(await 제목상태({작업폴더, 사이트: s.번호}));
  if (제목.length === 0) 제목.push(await 제목상태({작업폴더, 사이트: 1}));
  return {버전, 설정: 상태, 제목};
}
