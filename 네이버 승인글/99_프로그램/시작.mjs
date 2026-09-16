// 시작.mjs — 이 파일은 절대 바뀌지 않는다. 수강생은 이 폴더를 딱 한 번만 받으면 된다.
//
// 하는 일
//   1. GitHub 에서 최신 naver-typing.mjs · recipe.json 을 받아 이 폴더에 덮어쓴다. (강사가 고치면 자동 반영)
//   2. 인터넷이 안 되거나 저장소가 막혀 있으면 지금 있는 파일을 그대로 쓴다.
//   3. 최신 프로그램을 불러서 실행한다.
//
// Codex REPL 에서 쓰는 법 (AGENTS.md 에 있는 그대로)
//   const 시작 = await import(path.resolve("네이버 승인글/99_프로그램/시작.mjs"));
//   const 결과 = await 시작.실행({ agent, 원고: "원고1.json" });

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));

// 원격 위치. 저장소 이름이 바뀌지 않는 한 이 줄은 그대로다.
const 원격폴더 = "https://raw.githubusercontent.com/makeit-edu/makeit-middle-kit/main/"
  + encodeURIComponent("네이버 승인글") + "/" + encodeURIComponent("99_프로그램") + "/";
const 갱신대상 = ["naver-typing.mjs", "recipe.json", "글만들기.mjs"];

// raw 주소가 먼저, 안 되면 GitHub API 로 한 번 더. (raw 는 새 파일이 몇 분 늦게 뜰 때가 있다 — 2026-09-16 실측)
const API폴더 = "https://api.github.com/repos/makeit-edu/makeit-middle-kit/contents/"
  + encodeURIComponent("네이버 승인글") + "/" + encodeURIComponent("99_프로그램") + "/";

// 파일 안의 버전 문자열. naver-typing.mjs 는 `export const 버전 = "..."`, recipe.json 은 `"버전": "..."`.
function 버전읽기(내용) {
  const m = /버전"?\s*[=:]\s*"([^"]+)"/.exec(내용 || "");
  return m ? m[1] : "";
}

async function 한번받기(주소, 추가 = {}) {
  const r = await fetch(주소, { ...추가, signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// raw 먼저, 그 판이 로컬보다 낮으면(캐시가 옛 판을 준 것) API 로 한 번 더.
// raw 는 5분짜리 CDN 캐시가 있어 방금 올린 판이 늦게 뜬다 (2026-09-16 실측: 옛 판이 새 로컬을 덮어쓴 사고).
async function 받기(이름, 로컬버전) {
  const raw = 원격폴더 + encodeURIComponent(이름) + "?t=" + Date.now();
  const api = API폴더 + encodeURIComponent(이름) + "?ref=main";
  let 마지막오류 = null, 후보 = null;
  try {
    후보 = await 한번받기(raw);
    if (버전읽기(후보) >= 로컬버전) return 후보;
  } catch (e) { 마지막오류 = e; }
  try {
    const 것 = await 한번받기(api, { headers: { Accept: "application/vnd.github.raw" } });
    if (!후보 || 버전읽기(것) >= 버전읽기(후보)) 후보 = 것;
  } catch (e) { 마지막오류 = e; }
  if (후보 == null) throw 마지막오류 || new Error("못 받음");
  return 후보;
}

// 원격 판이 로컬과 같거나 더 새 것일 때만 덮어쓴다. 실패는 기록만 하고 계속 간다.
export async function 갱신() {
  const 기록 = {};
  for (const 이름 of 갱신대상) {
    const 파일 = path.join(여기, 이름);
    let 옛것 = "";
    try { 옛것 = await readFile(파일, "utf8"); } catch {}
    const 로컬버전 = 버전읽기(옛것);
    try {
      const 새것 = await 받기(이름, 로컬버전);
      if (이름.endsWith(".json")) JSON.parse(새것); // 깨진 JSON 은 받지 않는다
      const 원격버전 = 버전읽기(새것);
      if (옛것 === 새것) { 기록[이름] = `최신 그대로 (${로컬버전})`; continue; }
      if (옛것 && 원격버전 < 로컬버전) { 기록[이름] = `원격(${원격버전})이 로컬(${로컬버전})보다 옛 판 → 로컬 유지`; continue; }
      await writeFile(파일, 새것, "utf8");
      기록[이름] = 옛것 ? `새 판으로 바꿈 (${로컬버전} → ${원격버전})` : `새로 받음 (${원격버전})`;
    } catch (e) {
      기록[이름] = `원격 실패(${String(e?.message || e).slice(0, 40)}) → 지금 파일(${로컬버전}) 사용`;
    }
  }
  return 기록;
}

export async function 실행(옵션 = {}) {
  const 갱신기록 = await 갱신();
  // 캐시를 피하려고 매번 다른 주소로 불러온다. 같은 REPL 세션에서 두 번 돌려도 최신이 잡힌다.
  const 주소 = pathToFileURL(path.join(여기, "naver-typing.mjs")).href + "?t=" + Date.now();
  const 모듈 = await import(주소);
  const 점검 = 모듈.점검 ? 모듈.점검() : null;
  const 결과 = await 모듈.실행(옵션);
  return { 갱신: 갱신기록, 점검, ...결과 };
}

export async function 클라이언트경로() {
  await 갱신();
  const 주소 = pathToFileURL(path.join(여기, "naver-typing.mjs")).href + "?t=" + Date.now();
  return (await import(주소)).클라이언트경로();
}

// ── 수강생 대화 흐름용 ────────────────────────────────────────────
// 1단계: OpenAI 키. 프로젝트 폴더 안 00_설정/openai키.txt 에 한 번만 저장한다. (GitHub 에 올라가지 않는다)
const 프로젝트 = path.resolve(여기, "..");
const 키파일 = path.join(프로젝트, "00_설정", "openai키.txt");

export async function 키있음() {
  try { const k = (await readFile(키파일, "utf8")).trim(); return k.startsWith("sk-") && k.length > 20; } catch { return false; }
}
export async function 키저장(키) {
  const k = String(키 || "").trim();
  if (!k.startsWith("sk-") || k.length < 20) return { 저장: false, 이유: "sk- 로 시작하는 OpenAI 키가 아닙니다" };
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(키파일), { recursive: true });
  await writeFile(키파일, k + "\n", "utf8");
  return { 저장: true, 위치: 키파일 };
}
async function 키읽기() {
  if (!(await 키있음())) throw new Error("OpenAI 키가 저장돼 있지 않습니다. 먼저 키를 저장하세요");
  return (await readFile(키파일, "utf8")).trim();
}

// 2단계: 네이버 로그인 확인. 크롬에 글쓰기 주소를 열어 보고 로그인 화면으로 튕기면 false. 확인용 탭은 닫는다.
export async function 로그인확인({ agent }) {
  if (!agent) throw new Error("agent 가 필요합니다 (REPL 최상위에서 setupBrowserRuntime 으로 만든 것)");
  const chrome = await agent.browsers.get("chrome");
  const tab = await chrome.tabs.new();
  await tab.goto("https://blog.naver.com/GoBlogWrite.naver");
  await new Promise((r) => setTimeout(r, 5000));
  const 주소 = String(await Promise.resolve(tab.url()).catch(() => ""));
  try { await tab.close(); } catch {}
  const 로그인 = !/nid\.naver\.com/.test(주소) && /blog\.naver\.com/.test(주소);
  return { 로그인, 주소: 주소.slice(0, 80), 다음: 로그인 ? "네이버 준비 완료. 키워드를 받으세요" : "크롬에서 네이버에 로그인하라고 안내하고, 됐다고 하면 다시 확인하세요" };
}

// 3a단계: 키워드(또는 벤치마크 글 주소)로 글과 사진을 만들어 01_원고넣는곳/02_사진넣는곳 에 넣는다.
export async function 글만들기({ 키워드, 벤치마크URL, 사진수 = 3 }) {
  await 갱신();
  const 키 = await 키읽기();
  const 주소 = pathToFileURL(path.join(여기, "글만들기.mjs")).href + "?t=" + Date.now();
  const 글 = await import(주소);
  const 이름 = "원고_" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".json";
  const 결과 = await 글.만들기({ 키, 키워드, 벤치마크URL, 원고이름: 이름, 사진수, 사진접두: 이름.replace(".json", "_") });
  return { ...결과, 다음: `이제 시작.실행({ agent, 원고: "${이름}" }) 으로 네이버에 쓰세요` };
}

// 3b단계는 실행({ agent, 원고 }) 그대로다.
