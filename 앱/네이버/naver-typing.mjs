// 네이버 블로그 스마트에디터에 글을 '사람이 치듯' 넣는 프로그램
//
// 이 파일은 Codex 의 Node REPL(MCP node_repl) 안에서 돈다. 크롬은 Codex 의 크롬 플러그인(browser-client)으로 붙는다.
//
//   앱 판(2026-09-23~): 로더가 GitHub 에서 이 파일을 임시 폴더로 받아 오고, 앱/네이버.mjs 가 부른다.
//   const 결과 = await 실행({ agent, 원고: "<원고.json 절대경로>", 데이터폴더: "<수강생 폴더>/네이버 승인글" });
//   프로그램은 수강생 PC 에 남지 않는다. 수강생 폴더에는 원고·사진(데이터)만 남는다.
//
// 원칙
//   · 로그인 · 2차인증 · 발행은 사람이 한다. 이 프로그램은 편집기 안만 건드리고 임시저장까지만 한다.
//   · 클릭은 전부 '좌표로 진짜 마우스 클릭'(tab.ax.click) 이다. 셀렉터로 요소 위치를 재서 그 자리를 누른다.
//     Codex 의 frameLocator().click() 은 이 iframe 편집기에서 실제 클릭이 안 일어난다 (2026-09-16 실측).
//   · 글자는 tab.ax.typeText, 키는 tab.ax.pressKey 로 넣는다. 둘 다 브라우저가 진짜 키보드 입력으로 만든다.
//     raw CDP 의 Input.* 는 Codex 가 막는다. 페이지 안 JS 로 넣는 글자는 네이버가 거른다 (2026-09-15 실측).
//   · 화면 읽기는 frameLocator("body").evaluate 로 한다. Codex 의 evaluate 는 읽기 전용이라 클릭 같은 부작용은 무시된다.
//   · 셀렉터와 순서는 recipe.json 에 있다. 네이버가 화면을 바꾸면 그 파일만 고친다.
//   · 판단하지 않는다. 안 되면 어디서 멈췄는지 그대로 돌려준다.
//
// Playwright 로 직접 돌릴 때(코치 점검용)는 어댑터가 tab.ax 를 page.mouse / page.keyboard 로 흉내 낸다.

import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 이 파일을 고칠 때마다 올린다 (앱/배포.sh 가 커밋에 고정해 배포한다).
export const 버전 = "2026-09-28a";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
// 수강생 데이터 폴더(원고·사진). 앱 판에서는 실행() 이 옵션.데이터폴더 로 바꾼다. 프로그램 폴더(임시)와 다르다.
let 프로젝트 = path.resolve(여기, "..");
const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
const 랜덤 = (기본) => 기본 + Math.floor(Math.random() * 기본);

// ── Codex 플러그인 위치 ─────────────────────────────────────────
// 주의: Codex 의 Node REPL 은 빈 vm 컨텍스트라 `process` 전역이 없다 (2026-09-16 실측). 그래서 process 는 직접 쓰지 않는다.
function 코덱스홈() {
  const env = globalThis.process?.env || {};
  return env.CODEX_HOME || path.join(homedir(), ".codex");
}

export function 클라이언트경로() {
  const 후보 = [];
  try {
    const home = 코덱스홈();
    const 캐시 = path.join(home, "plugins", "cache", "openai-bundled", "chrome");
    if (existsSync(캐시)) {
      for (const v of readdirSync(캐시).sort().reverse()) 후보.push(path.join(캐시, v, "scripts", "browser-client.mjs"));
    }
    후보.push(path.join(home, ".tmp", "bundled-marketplaces", "openai-bundled", "plugins", "chrome", "scripts", "browser-client.mjs"));
  } catch (e) {
    throw new Error(`Codex 홈 폴더를 못 읽었습니다: ${e?.message || e}`);
  }
  후보.push("/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/chrome/scripts/browser-client.mjs");
  const 있는것 = 후보.find((p) => existsSync(p));
  if (!있는것) throw new Error(`Codex 크롬 플러그인을 못 찾았습니다. 찾아본 곳: ${후보.join(" , ")}`);
  return 있는것;
}

export function 점검() {
  const 있음 = (이름) => typeof globalThis[이름] !== "undefined";
  let 플러그인 = null, 플러그인오류 = null;
  try { 플러그인 = 클라이언트경로(); } catch (e) { 플러그인오류 = String(e?.message || e); }
  const 원고폴더 = path.join(프로젝트, "01_원고넣는곳");
  return {
    버전,
    전역: { process: 있음("process"), setTimeout: 있음("setTimeout"), fetch: 있음("fetch"), nodeRepl: 있음("nodeRepl") },
    플러그인, 플러그인오류,
    프로젝트폴더: 프로젝트,
    원고목록: existsSync(원고폴더) ? readdirSync(원고폴더).filter((f) => f.endsWith(".json")) : [],
    레시피: existsSync(path.join(여기, "recipe.json")),
  };
}

// 사진 자리 고르기 — 글 모델이 사진을 글 끝에 몰아 넣을 때가 있다 (2026-09-23 실측: 사진 3장이 전부 맨 아래에 들어감).
// 모델이 어디에 두든 사진 순서는 그대로 두고, 소제목 아래 첫 문단 뒤에 고르게 다시 놓는다.
// 소제목이 사진보다 적으면 남는 사진은 다른 문단 뒤에 고르게 놓는다. (글만들기.mjs 와 naver-typing.mjs 에 같은 함수가 있다. 고치면 둘 다)
export function 사진고르게(블록들) {
  const 사진 = (블록들 || []).filter((b) => b && b.종류 === "사진");
  if (!사진.length) return 블록들 || [];
  const 나머지 = 블록들.filter((b) => b && b.종류 !== "사진");
  const 고르게 = (후보, n) => (후보.length && n > 0 ? Array.from({ length: n }, (_, k) => 후보[Math.floor(((k + 0.5) * 후보.length) / n)]) : []);
  // 자리 = 이 번호의 블록 '뒤'
  const 소제목뒤 = [];
  나머지.forEach((b, i) => { if (b.종류 === "소제목") 소제목뒤.push(나머지[i + 1] && 나머지[i + 1].종류 === "문단" ? i + 1 : i); });
  let 자리 = 고르게(소제목뒤, Math.min(소제목뒤.length, 사진.length));
  if (자리.length < 사진.length) {
    const 문단뒤 = 나머지.map((b, i) => (b.종류 === "문단" && i > 0 && i < 나머지.length - 1 && !자리.includes(i) ? i : -1)).filter((i) => i >= 0);
    자리 = 자리.concat(고르게(문단뒤, Math.min(문단뒤.length, 사진.length - 자리.length)));
  }
  자리 = [...new Set(자리)].sort((a, b) => a - b);
  const 결과 = [];
  let k = 0;
  나머지.forEach((b, i) => { 결과.push(b); if (자리.includes(i) && k < 사진.length) 결과.push(사진[k++]); });
  while (k < 사진.length) 결과.push(사진[k++]);
  return 결과;
}

// ── 레시피 · 원고 읽기 ────────────────────────────────────────────
async function 레시피읽기(원격주소) {
  // 원격과 로컬을 둘 다 읽어 '버전' 이 더 큰 쪽을 쓴다. (raw 캐시가 옛 판을 줄 때가 있다)
  let 로컬 = null;
  try { 로컬 = JSON.parse(await readFile(path.join(여기, "recipe.json"), "utf8")); } catch {}
  let 원격 = null;
  if (원격주소) {
    try {
      const r = await fetch(원격주소 + "?t=" + Date.now(), { signal: AbortSignal.timeout(4000), cache: "no-store" });
      if (r.ok) 원격 = await r.json();
    } catch {}
  }
  if (!로컬 && !원격) throw new Error("recipe.json 을 원격에서도 로컬에서도 못 읽었습니다");
  if (원격 && (!로컬 || String(원격.버전 || "") >= String(로컬.버전 || ""))) return { 레시피: 원격, 출처: "원격" };
  return { 레시피: 로컬, 출처: "로컬" };
}

async function 원고읽기(이름) {
  const p = path.isAbsolute(이름) ? 이름 : path.join(프로젝트, "01_원고넣는곳", 이름);
  if (!existsSync(p)) throw new Error(`원고 파일이 없습니다: ${p}`);
  return JSON.parse(await readFile(p, "utf8"));
}

// 사진은 원고 파일과 같은 폴더(03_쓴글/날짜_키워드/)에서 먼저 찾고, 없으면 02_사진넣는곳 에서 찾는다.
function 사진경로(파일, 원고폴더) {
  const 후보 = path.isAbsolute(파일) ? [파일] : [원고폴더 && path.join(원고폴더, 파일), path.join(프로젝트, "02_사진넣는곳", 파일)].filter(Boolean);
  const p = 후보.find((x) => existsSync(x));
  if (!p) throw new Error(`사진 파일이 없습니다: ${후보.join(" , ")}`);
  return p;
}

// ── 본체 ──────────────────────────────────────────────────────────
export async function 실행(옵션 = {}) {
  const 기록 = [];
  const 적기 = (단계, 내용) => { 기록.push({ 단계, ...내용 }); };
  const 시작 = Date.now();

  try {
    // 0. 준비
    if (옵션.데이터폴더) 프로젝트 = 옵션.데이터폴더;
    // 레시피는 이 파일과 함께 GitHub 의 같은 커밋에서 받아 온 것을 쓴다 (따로 원격을 다시 읽지 않는다)
    const { 레시피: R, 출처 } = await 레시피읽기(옵션.레시피주소 ?? null);
    적기("레시피", { 출처, 버전: R.버전, 프로그램: 버전 });
    const 원고이름 = 옵션.원고 || "원고1.json";
    const 원고 = await 원고읽기(원고이름);
    원고.블록 = 사진고르게(원고.블록); // 예전에 만든 원고도 사진이 끝에 몰려 있으면 고르게 (이어쓰기 번호도 매번 같게 나온다)
    const 원고폴더 = path.isAbsolute(원고이름) ? path.dirname(원고이름) : null;
    const 딜레이 = 옵션.딜레이 ?? R.타이핑딜레이 ?? 35;
    const 단계 = 옵션.단계 || "전부";

    // 1. 브라우저 — agent 는 REPL 최상위에서 만들어 넘겨받는다 (플러그인이 globalThis.nodeRepl 을 최상위에서만 본다)
    let agent = 옵션.agent;
    if (!agent) {
      const { setupBrowserRuntime } = await import(클라이언트경로());
      agent = await setupBrowserRuntime();
    }
    // Codex 플러그인은 CDP·파일 업로드 전에 해당 문서를 '읽었다' 는 표시를 요구한다. 내용은 쓰지 않는다.
    if (agent.documentation && typeof agent.documentation.get === "function") {
      for (const 문서 of ["confirmations", "capabilities/tab/cdp", "accessibility", "file-uploads"]) {
        try { await agent.documentation.get(문서); } catch {}
      }
    }
    const chrome = await agent.browsers.get("chrome");

    // 2. 탭 — 이어쓰기면 이 세션이 연 글쓰기 탭을 다시 잡는다. 아니면 열려 있는 글쓰기 탭을 잡고, 못 잡으면 새 탭으로 연다
    let tab = null;
    let 이어쓰기 = false;
    const 시작블록 = Number(옵션.시작블록 || 0);
    if (시작블록 > 0) {
      // 첫 호출에서 쓰던 탭을 기억해 두었다가 그대로 쓴다 (2026-09-23 실측: 이어 쓸 때 탭 목록에서 글쓰기 탭을 못 찾아 멈춤).
      try {
        const 전탭 = globalThis.__메킷네이버탭;
        if (전탭 && /blog\.naver\.com/.test(String(await Promise.resolve(전탭.url())))) tab = 전탭;
      } catch {}
      if (!tab) try {
        const 내탭들 = await chrome.tabs.list();
        for (const t of 내탭들) {
          const u = String(await Promise.resolve(t.url()).catch(() => ""));
          if (R.글쓰기주소패턴.some((p) => new RegExp(p).test(u))) { tab = t; break; }
        }
      } catch {}
      // 시작블록이 있으면 무조건 이어쓰기다. 제목·첫 칸을 다시 치면 글이 중복된다 (2026-09-17 실측: 제목이 두 번 들어감).
      이어쓰기 = true;
      if (tab) 적기("탭잡기", { 방법: `이어쓰기 — 이 세션의 글쓰기 탭에서 블록${시작블록 + 1}부터` });
      else 적기("탭잡기", { 안내: "이 세션 탭 목록에 없어 열린 글쓰기 탭을 다시 잡습니다" });
    }
    // 다시쓰기(점검에서 문제가 나와 같은 탭에서 처음부터 다시 쓰기) — 기억해 둔 탭을 쓴다. 같은 임시저장 글이 고쳐진다.
    if (옵션.다시쓰기 && !tab) {
      try { const 전탭 = globalThis.__메킷네이버탭; if (전탭 && /blog\.naver\.com/.test(String(await Promise.resolve(전탭.url())))) tab = 전탭; } catch {}
      if (tab) 적기("탭잡기", { 방법: "다시쓰기 — 같은 글쓰기 탭" });
    }
    // 이어쓰기가 아니면 수강생이 열어 둔 헌 글쓰기 탭은 잡지 않고 항상 새 탭을 연다.
    // 2026-09-23 실측: 앞선 실패로 남은 글쓰기 탭을 잡았더니 편집기를 못 읽었다 (새 탭은 3초 만에 편집기가 잡힘).
    const 탭들 = tab || (!옵션.열린탭쓰기 && !이어쓰기) ? [] : await chrome.user.openTabs();
    const 대상 = 탭들.find((t) => R.글쓰기주소패턴.some((p) => new RegExp(p).test(t.url || "")));
    if (대상) {
      try { tab = await chrome.user.claimTab(대상); 적기("탭잡기", { 방법: "열린 탭 잡음", 주소: (대상.url || "").slice(0, 80) }); }
      catch (e) { 적기("탭잡기", { 열린탭못잡음: String(e?.message || e).slice(0, 120) }); }
    }
    if (!tab && 이어쓰기) { 적기("탭잡기", { 실패: "이어 쓸 글쓰기 탭이 없습니다. 크롬에서 글쓰기 탭이 닫혔는지 확인하세요" }); return 마무리(); }
    if (!tab) {
      tab = await chrome.tabs.new();
      await tab.goto(R.글쓰기주소 || "https://blog.naver.com/GoBlogWrite.naver");
      await 쉬기(5000);
      const 지금주소 = await Promise.resolve(tab.url()).catch(() => "");
      적기("탭잡기", { 방법: 대상 ? "새 탭으로 다시 열음" : "글쓰기 탭이 없어 새 탭으로 열음", 주소: String(지금주소).slice(0, 80) });
      if (/nid\.naver\.com/.test(String(지금주소))) { 적기("로그인", { 실패: "네이버 로그인이 안 돼 있습니다. 크롬에서 로그인한 뒤 다시 실행하세요" }); return 마무리(); }
    }
    // Codex 는 에이전트가 연 탭을 턴이 끝나면 자동으로 닫는다. 이어쓰기 도중 탭이 사라져 "Tab not found" 가 났다 (2026-09-17 실측).
    // '다음 턴에도 쓸 탭' 으로 표시해 두면 남는다.
    try { if (typeof tab.markHandoff === "function") await tab.markHandoff(); } catch {}
    globalThis.__메킷네이버탭 = tab;
    const pw = tab.playwright;
    const ax = tab.ax;
    if (!ax || typeof ax.typeText !== "function" || typeof ax.click !== "function") { 적기("입력", { 실패: "이 브라우저 연결에는 ax 입력 API 가 없습니다" }); return 마무리(); }
    // 코덱스 크롬 확장 26.915(2026-09-18) 부터 typeText·pressKey 가 (대상요소번호, 값) 두 인자가 됐다. null 이면 지금 커서가 있는 칸에 넣는다.
    // 옛 판은 (값) 하나. 글자만 넘기면 새 판은 그 글자를 '요소 이름' 으로 읽어 "Could not prepare accessibility element 추석지원" 이 난다 (2026-09-23 실측).
    // 함수 인자 개수로 판을 가리지 않는다 (감싼 함수는 length 가 0 이라 틀린다). 새 방식으로 먼저 넣어 보고, 모양이 안 맞다는 오류면 옛 방식으로.
    // 한 번 맞는 방식을 찾으면 그 뒤로는 그 방식만 쓴다. 확장이 또 바뀌어도 둘 중 하나로 돈다.
    let 입력방식 = null; // "새" | "옛"
    const 모양오류 = (e) => /Could not prepare accessibility element|is stale or missing|element_index|Expected (number|string)|invalid_type|Invalid (input|arguments)|must be a|received (null|undefined)/i.test(String(e?.message || e));
    const 두방식 = async (새로, 옛로) => {
      if (입력방식 === "새") return 새로();
      if (입력방식 === "옛") return 옛로();
      try { await 새로(); 입력방식 = "새"; }
      catch (e) {
        if (!모양오류(e)) throw e;
        await 옛로(); 입력방식 = "옛";
      }
      적기("입력방식", { 확장판: 입력방식 === "새" ? "새 판 (요소번호, 값)" : "옛 판 (값)" });
    };
    const 글넣기 = (글) => 두방식(() => ax.typeText(null, 글), () => ax.typeText(글));
    const 키넣기 = (키) => 두방식(() => ax.pressKey(null, 키), () => ax.pressKey(키));
    const F = pw.frameLocator(R.프레임);
    const 키이름 = (k) => (k === "Enter" ? "Return" : k);

    // ── 도구들 (F, ax, pw 를 닫아 쓴다) ──
    const 프레임위치 = async () => {
      try { return await pw.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left, y: r.top, w: innerWidth, h: innerHeight }; }, R.프레임); }
      catch { return { x: 0, y: 0, w: 1400, h: 900 }; }
    };
    // 요소의 화면 좌표(프레임 오프셋 포함). 화면 밖이면 스크롤해서 다시 잰다.
    // 네이버 편집기는 위쪽 툴바(약 150px)가 고정이라, 그 아래 ~ 화면 하단 사이에 있어야 진짜 클릭이 닿는다.
    // 화면 밖이면 그 방향으로 스크롤하며 최대 6번 다시 잰다 (2026-09-17 실측: 두 번째 표에서 "outside the active tab content viewport").
    const 가운데 = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; };
    // 글 끝 자리 — 마지막 글자 바로 오른쪽. 가운데를 누르면 긴 줄은 글 한가운데에 커서가 선다.
    // 맥 크롬은 End 키로 커서가 줄 끝에 가지 않는다. 그래서 가운데 클릭 → End → Enter 가 긴 소제목을 가운데서 쪼갰다 (2026-09-23 실측: 17자 소제목이 사라지고 다음 문단이 소제목 안으로 들어감).
    // 코덱스의 화면 읽기에는 createTreeWalker·Range 가 없다 (2026-09-23 실측: "createTreeWalker is not a function"). 줄 속 글자 조각(span)의 끝으로 잰다.
    const 글끝 = (el) => {
      const b = el.getBoundingClientRect();
      let e = null;
      try {
        const 조각 = el.querySelectorAll("span");
        for (let i = 조각.length - 1; i >= 0 && !e; i--) {
          const r = 조각[i].getBoundingClientRect();
          if (r.width > 0 && String(조각[i].innerText || 조각[i].textContent || "").trim()) e = r;
        }
      } catch {}
      if (!e) return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
      return { x: Math.min(b.right - 3, e.right + 8), y: e.bottom - Math.min(12, e.height / 2), w: b.width, h: b.height };
    };
    // 화면 내리기 — 필요한 픽셀만큼만.
    // 코덱스 크롬 확장의 ax.scroll 세 번째 값은 '화면 한 장' 단위다 (확장 26.924 코드: 화면 높이 × 장수 만큼 휠).
    // 예전엔 1 을 줘서 한 번에 한 화면씩 넘어갔고, 화면이 작은 윈도우 노트북에서는 요소가 위아래로 왔다 갔다만 하다 화면 밖에 남았다
    // (2026-09-28 윈도우 실측: 표 칸을 못 눌러 표가 빈 채로 남고, 다음 문단이 표 첫 칸에 들어가고, 뒤 소제목까지 줄줄이 깨짐).
    // 그래서 장수를 소수로 준다 (예: 230px 내리기 = 230 / 화면높이 장). 안 되면 픽셀 단위 cua.scroll 로.
    const 화면내리기 = async (델타, f) => {
      if (!(Math.abs(델타) >= 1)) return "안 움직임";
      const 점 = [Math.round(f.w / 2), Math.round(f.h / 2)];
      const 장 = Math.round(Math.min(3, Math.abs(델타) / Math.max(300, f.h)) * 1000) / 1000;
      try { await ax.scroll(점, 델타 > 0 ? "down" : "up", Math.max(0.05, 장)); return "ax"; } catch {}
      try { if (tab.cua && typeof tab.cua.scroll === "function") { await tab.cua.scroll({ x: 점[0], y: 점[1], scrollX: 0, scrollY: Math.round(델타) }); return "cua"; } } catch {}
      return "실패";
    };
    const 좌표 = async (loc, 측정 = 가운데) => {
      const 재기 = () => loc.evaluate(측정);
      let r = await 재기();
      let f = await 프레임위치();
      // 화면 아래쪽에는 "전체 글감 | 검색" 막대가 늘 떠 있다. 그 아래(가려진 곳)를 누르면 글감 검색칸이 눌려 글자가 그리로 들어간다 (2026-09-23 실측).
      // 그래서 누를 자리는 그 막대보다 30px 위까지만 인정하고, 더 아래면 스크롤해서 올린다.
      let 막대위 = f.h;
      try { 막대위 = await F.locator(".se-floating-material-container").first().evaluate((el) => { const b = el.getBoundingClientRect(); return b.height > 0 ? b.top : 1e9; }, undefined); } catch {}
      const 위한계 = 160, 아래한계 = () => Math.min(f.h - 40, 막대위 - 30);
      // 위쪽 도구 모음(문단 서식·인용구·표·사진·저장 버튼)은 화면에 붙어 있어 스크롤해도 제자리다. 그런데 150px 안쪽이라 '위로 가려졌다' 로 보고
      // 누를 때마다 위로 6번씩 스크롤했다. 글 쓰는 도중 화면이 맨 위로 튀었다 내려오던 원인 (2026-09-23 진현님 영상: 소제목마다 반복).
      // 그래서 붙어 있는 것(fixed·sticky 안에 든 것)은 스크롤하지 않고, 스크롤해도 자리가 안 바뀌면 바로 멈춘다.
      // 붙어 있는지는 위쪽(도구 모음 자리)에 있는 것만 본다. 아래로 벗어난 본문 요소는 무조건 내린다.
      const 붙음 = r.y < 위한계 ? await loc.evaluate((el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") return true; } return false; }).catch(() => false) : false;
      // 누를 자리를 위한계~아래한계 사이 한가운데로 가져온다. 두 번 연속 안 움직이면(문서 맨 끝·맨 위) 그만.
      let 안움직임 = 0;
      for (let i = 0; !붙음 && i < 6 && (r.y < 위한계 || r.y > 아래한계()); i++) {
        const 전y = r.y;
        await 화면내리기(r.y - (위한계 + 아래한계()) / 2, f);
        await 쉬기(400);
        r = await 재기(); f = await 프레임위치();
        if (Math.abs(r.y - 전y) < 2) { if (++안움직임 >= 2) break; } else 안움직임 = 0;
      }
      if (r.y < 0 || r.y > f.h) throw new Error(`요소를 화면 안으로 못 가져옴 (y=${Math.round(r.y)}, 화면높이=${f.h})`);
      return { x: Math.round(f.x + r.x), y: Math.round(f.y + r.y), w: r.w, h: r.h };
    };
    const 좌표클릭 = async (loc, 옵션 = {}) => {
      const p = await 좌표(loc);
      if (!(p.w > 0 && p.h > 0)) throw new Error("요소가 화면에 없음(크기 0)");
      await ax.click([p.x, p.y], 옵션.clickCount ? { clickCount: 옵션.clickCount } : undefined);
      return p;
    };
    let 맥 = null;
    const 맥인가 = async () => { if (맥 === null) 맥 = /Mac/i.test(String(await pw.evaluate(() => navigator.platform).catch(() => ""))); return 맥; };
    // 줄 끝에 커서를 둔다 (글을 이어 치거나 Enter 로 새 줄을 만들기 전에)
    const 끝클릭 = async (loc) => {
      // 끝 자리를 못 재면 예전처럼 가운데를 누른다 (멈추지 않게)
      const p = await 좌표(loc, 글끝).catch(() => 좌표(loc));
      if (!(p.w > 0 && p.h > 0)) throw new Error("요소가 화면에 없음(크기 0)");
      await ax.click([p.x, p.y]);
      await 쉬기(150);
      // 윈도우는 End 로 한 번 더 확실히 줄 끝에. 맥은 End 가 커서는 안 옮기고 화면만 맨 아래로 튀게 해서 누르지 않는다.
      if (!(await 맥인가())) await 키("End");
      return p;
    };
    // 여러 후보 셀렉터 중 화면에 있는 첫 번째
    const 찾기 = async (후보들) => {
      for (const s of 후보들) {
        const loc = F.locator(s).first();
        try { if ((await loc.count()) > 0) return { loc, 셀렉터: s }; } catch {}
      }
      return null;
    };
    const 버튼클릭 = async (후보들, 이름) => {
      const b = await 찾기(후보들);
      if (!b) throw new Error(`${이름} 버튼 못 찾음`);
      await 좌표클릭(b.loc);
      return b.셀렉터;
    };
    // 어절(띄어쓰기) 단위로 톡톡 친다. 글자마다 치면 한 글자에 한 번씩 브라우저를 왕복해서 2,500자에 3분 넘게 걸린다 (2026-09-17 실측).
    // 긴 어절은 4자씩 끊는다. 화면에서는 여전히 사람이 치는 것처럼 보인다.
    const 타이핑 = async (문장) => {
      const 조각들 = [];
      for (const 어절 of String(문장).split(/(?<=\s)/)) {
        for (let i = 0; i < 어절.length; i += 4) 조각들.push(어절.slice(i, i + 4));
      }
      for (const 조각 of 조각들) {
        await 글넣기(조각);
        // 조각을 넣은 뒤 글감 창이 떴으면 그 조각은 검색칸으로 들어간 것이다. 끄고 커서를 되돌린 뒤 그 조각만 다시 넣는다 (최대 2번).
        for (let 재시도 = 0; 재시도 < 2 && (await 글감끄기(`'${조각}' 입력`)); 재시도++) await 글넣기(조각);
        await 쉬기(랜덤(딜레이));
      }
    };
    const 시간예산초 = 옵션.시간예산초 ?? R.시간예산초 ?? 180;
    const 시간초과 = () => (Date.now() - 시작) / 1000 > 시간예산초;
    const 키 = async (이름) => { await 키넣기(키이름(이름)); };
    const 에디터상태 = async () => {
      const body = F.locator("body").first();
      try {
        if ((await body.count()) === 0) return { 에디터: false };
        return await body.evaluate((el) => {
          const d = el.ownerDocument;
          if (!d.querySelector(".se-documentTitle") && !d.querySelector(".se-content")) return { 에디터: false };
          return {
            에디터: true,
            제목: (d.querySelector(".se-documentTitle") || {}).innerText?.trim().slice(0, 60) || "",
            본문글자수: [...d.querySelectorAll(".se-component.se-text")].map((e) => (e.innerText || "").replace(/\s/g, "").length).reduce((a, b) => a + b, 0),
            컴포넌트: [...d.querySelectorAll(".se-component")].map((c) => (c.className.match(/se-\w+/g) || [])[1] || "?"),
            소제목: [...d.querySelectorAll(".se-component.se-sectionTitle")].map((e) => (e.innerText || "").trim().slice(0, 30)),
            인용구: [...d.querySelectorAll(".se-quotation")].map((e) => (e.innerText || "").trim().split("\n")[0].slice(0, 40)),
            표칸: [...d.querySelectorAll(".se-table td")].map((t) => (t.innerText || "").trim()).filter(Boolean),
            이미지: d.querySelectorAll(".se-component.se-image").length,
            구분선: d.querySelectorAll(".se-component.se-horizontalLine").length,
            팝업: !!d.body.innerText.includes("작성 중인 글"),
          };
        });
      } catch (e) { return { 에디터: false, 오류: String(e?.message || e).slice(0, 120) }; }
    };
    // '작성 중인 글' 팝업이 있으면 정해진 버튼을 진짜 클릭으로 누른다
    const 팝업정리 = async () => {
      const 글 = F.locator("text=작성 중인 글");
      if ((await 글.count().catch(() => 0)) === 0) return "팝업 없음";
      const 버튼들 = F.locator(`button:has-text("${R.작성중팝업버튼}")`);
      const n = await 버튼들.count();
      for (let i = 0; i < n; i++) {
        const p = await 좌표(버튼들.nth(i)).catch(() => null);
        if (p && p.w > 40 && p.h > 20 && p.y > 150) { await ax.click([p.x, p.y]); await 쉬기(1200); return `팝업 → '${R.작성중팝업버튼}' 누름`; }
      }
      return "팝업 있는데 버튼 못 찾음";
    };
    // 글감 검색 창 — 커서가 글감 검색칸으로 가면 그 뒤 글자가 전부 거기로 들어간다 (2026-09-23 실측).
    // 주의: 화면 아래 "전체 글감 | 검색" 막대는 닫혀 있어도 늘 보인다. 그래서 '검색칸이 보인다' 는 열림이 아니다.
    // 열림 = 커서가 검색칸에 있다 또는 큰 글감 창(책·음악 탭, 높이 150px 넘는 판)이 떠 있다. 닫을 때는 X 를 누른다 (진현님 지시). 글감 버튼은 누르지 않는다(누르면 열린다).
    const 글감상태 = () => F.locator("body").first().evaluate((el) => {
      const d = el.ownerDocument, a = d.activeElement;
      const 보임 = (e) => { const r = e.getBoundingClientRect(); return e.getClientRects().length > 0 && r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
      const 입력 = d.querySelector(".se-flayer-unified-search-input");
      const 판 = [...d.querySelectorAll(".se-floating-material-container *, [class*=material-panel], [class*=flayer-unified-result], [class*=flayer-unified-content]")].find((e) => 보임(e) && e.getBoundingClientRect().height > 150);
      const 열림 = a === 입력 || !!판;
      let X = null;
      if (열림) {
        const 후보 = [...d.querySelectorAll(".se-floating-material-container button, [class*=flayer] button")].filter(보임);
        const 닫기 = 후보.find((b) => /close|닫기/i.test(String(b.className) + " " + (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + (b.innerText || "")));
        if (닫기) { const r = 닫기.getBoundingClientRect(); X = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      }
      return { 열림, 판: !!판, 검색칸커서: a === 입력, X };
    }).catch(() => ({ 열림: false }));
    let 글감끈횟수 = 0;
    const 글감끄기 = async (이름) => {
      const 전 = await 글감상태();
      if (!전.열림) return false;
      글감끈횟수 += 1;
      적기("글감창", { 경고: `${이름} 에서 글감 창이 떠서 껐습니다`, 큰창: 전.판, 검색칸커서: 전.검색칸커서, X찾음: !!전.X });
      if (전.X) { const f = await 프레임위치(); await ax.click([Math.round(f.x + 전.X.x), Math.round(f.y + 전.X.y)]); await 쉬기(500); }
      if ((await 글감상태()).열림) { await 키("Escape"); await 쉬기(400); }
      // 커서를 글 끝으로 되돌린다 (좌표클릭은 글감 막대 위쪽만 누른다)
      const 마지막 = F.locator(".se-component.se-text .se-text-paragraph, .se-component.se-sectionTitle .se-text-paragraph, .se-quotation .se-text-paragraph").last();
      if ((await 마지막.count().catch(() => 0)) > 0) { try { await 끝클릭(마지막); } catch {} }
      await 쉬기(300);
      if ((await 글감상태()).열림) 적기("글감창", { 경고: `${이름}: 껐는데도 글감 창이 남아 있습니다` });
      return true;
    };
    const 글감닫기 = (이름, 때) => 글감끄기(`${이름} ${때}`);
    // 표·인용구를 넣기 전에 빈 줄을 하나 더 만들어 두고(Enter → 위로), 넣은 뒤에는 그 부품 바로 아래 빈 줄을 눌러 커서를 옮긴다.
    // 2026-09-23 실측: 숨은 "본문 추가" 버튼을 못 눌러 커서가 표 마지막 칸에 남았고, 뒤 문단·소제목이 전부 그 칸 안으로 들어갔다.
    const 빈줄만들기 = async () => { await 키("Enter"); await 쉬기(250); await 키("Up"); await 쉬기(250); };
    const 아래로나가기 = async (부품) => {
      await 키("Escape"); await 쉬기(300);
      const 다음줄 = F.locator(`.se-component.${부품} + .se-component.se-text .se-text-paragraph`).last();
      if ((await 다음줄.count().catch(() => 0)) > 0) { await 끝클릭(다음줄); await 쉬기(250); return "아래 빈 줄"; }
      return `본문 추가: ${await 본문추가하기()}`;
    };
    // 문단이 표·인용구 안으로 잘못 들어갔는지 확인 (들어갔으면 기록)
    const 들어간곳 = (앞) => F.locator("body").first().evaluate((el, 앞) => [...el.ownerDocument.querySelectorAll(".se-component")]
      .filter((c) => (c.innerText || "").replace(/\s+/g, "").includes(앞))
      .map((c) => (String(c.className).match(/se-(text|table|quotation|sectionTitle)\b/) || [])[1] || "?"), 앞).catch(() => []);
    // 지금 커서 줄의 서식 — 도구 모음 "문단 서식" 버튼에 "본문"/"소제목" 이 표시된다.
    // 2026-09-23 실측: 소제목 뒤 Enter 한 줄이 소제목 서식으로 남아 다음 문단이 소제목 안으로 들어갔다. 문단 쓰기 전에 본문으로 돌린다.
    const 현재서식 = async () => {
      const b = await 찾기(R.문단서식버튼);
      if (!b) return "";
      return b.loc.evaluate((el) => (el.innerText || "").trim().split("\n")[0].trim()).catch(() => "");
    };
    const 본문서식으로 = async () => {
      const 전 = await 현재서식();
      if (!전 || 전 === "본문") return 전 || "모름";
      await 버튼클릭(R.문단서식버튼, "문단 서식"); await 쉬기(700);
      const 자리 = await F.locator("body").first().evaluate((el) => {
        const 후보 = [...el.ownerDocument.querySelectorAll("button, li")].filter((e) => (e.innerText || "").trim() === "본문" && e.getBoundingClientRect().height > 0);
        const b = 후보[0]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }).catch(() => null);
      if (자리) { const f = await 프레임위치(); await ax.click([Math.round(f.x + 자리.x), Math.round(f.y + 자리.y)]); await 쉬기(500); }
      else { await 키("Escape"); await 쉬기(300); }
      const 후 = await 현재서식();
      적기("서식", { 바꿈: `${전} → ${후}` });
      return 후;
    };
    const 본문추가하기 = async () => {
      const b = await 찾기(R.본문추가버튼);
      if (!b) return "버튼 없음";
      const p = await 좌표(b.loc).catch(() => null);
      if (!p || !(p.w > 0 && p.h > 0)) return "버튼 숨김 → 건너뜀";
      await ax.click([p.x, p.y]); await 쉬기(800); return "누름";
    };

    // 3. 편집기가 뜰 때까지 기다린다 (최대 20초). 새 탭은 5초 안에 편집기가 안 뜰 때가 있다 (2026-09-23 실측: "편집기 프레임을 못 찾았습니다").
    for (let i = 0; i < 20; i++) { if ((await 에디터상태()).에디터) break; await 쉬기(1000); }
    // 팝업 → 시작 상태
    if (!이어쓰기) 적기("팝업", { 결과: await 팝업정리() });
    await 쉬기(600);
    const 전 = await 에디터상태();
    if (!전.에디터) { 적기("에디터", { 실패: "편집기 프레임을 못 찾았습니다. 화면이 다 떴는지 확인하세요", 상세: 전.오류, 주소: String(await Promise.resolve(tab.url()).catch(() => "")).slice(0, 100) }); return 마무리(); }
    if (전.팝업) { 적기("에디터", { 실패: "'작성 중인 글' 팝업이 안 닫혔습니다" }); return 마무리(); }
    적기("시작상태", 전);

    // 이어쓰기면 제목·첫 칸은 건너뛰고 글 끝에 커서를 둔다
    if (이어쓰기) {
      const 추가 = await 본문추가하기();
      if (추가 !== "누름") {
        const 마지막문단 = F.locator(R.본문문단).last();
        // 끝 줄을 못 눌러도 멈추지 않는다 (앞 호출이 끝난 자리에 커서가 그대로 있다)
        if ((await 마지막문단.count()) > 0) {
          try { await 끝클릭(마지막문단); await 키("Enter"); }
          catch (e) { 적기("이어쓰기", { 경고: `끝 줄을 못 눌러 커서 자리 그대로 이어 씀: ${String(e?.message || e).slice(0, 80)}` }); }
        }
      }
      await 쉬기(400);
    }

    // 다시쓰기면 본문·제목을 비운다 (전체 선택 → 지우기)
    if (옵션.다시쓰기 && !이어쓰기) {
      const 플랫폼 = await pw.evaluate(() => navigator.platform).catch(() => "");
      const 전체 = /Mac/i.test(String(플랫폼)) ? "super+a" : "ctrl+a";
      const 본문첫 = F.locator(R.본문문단).first();
      if ((await 본문첫.count().catch(() => 0)) > 0) {
        await 좌표클릭(본문첫); await 쉬기(300);
        for (let i = 0; i < 2; i++) { await 키(전체); await 쉬기(300); await 키("Delete"); await 쉬기(600); }
      }
      const 제목칸 = await 찾기(R.제목칸);
      if (제목칸) { await 좌표클릭(제목칸.loc); await 쉬기(300); await 키(전체); await 쉬기(200); await 키("Delete"); await 쉬기(400); }
      const 비운뒤 = await 에디터상태();
      적기("다시쓰기", { 남은본문글자: 비운뒤.본문글자수, 남은제목: 비운뒤.제목, 남은부품: (비운뒤.컴포넌트 || []).length });
      // 빈 칸에는 회색 안내 글자("제목", 본문 안내 문구)가 보인다 (2026-09-23 실측: 비운 뒤 제목 "제목", 본문 17자). 그건 남은 글이 아니다.
      const 남은제목 = String(비운뒤.제목 || "").replace(/\s+/g, "");
      if ((비운뒤.본문글자수 || 0) > 60 || (남은제목 && 남은제목 !== "제목" && 원고.제목.replace(/\s+/g, "").startsWith(남은제목.slice(0, 6)))) { 적기("다시쓰기", { 실패: "본문을 비우지 못했습니다" }); return 마무리(); }
    }

    // 4. 제목
    if (!이어쓰기) {
      const t = await 찾기(R.제목칸);
      if (!t) { 적기("제목", { 실패: "제목 칸을 못 찾음", 시도: R.제목칸 }); return 마무리(); }
      await 좌표클릭(t.loc);
      await 쉬기(400);
      await 타이핑(원고.제목);
      await 쉬기(500);
      const 후 = await 에디터상태();
      const 들어감 = 후.제목.includes(원고.제목.slice(0, 8));
      적기("제목", { 셀렉터: t.셀렉터, 넣은것: 원고.제목, 화면: 후.제목, 들어감 });
      if (!들어감) { 적기("제목", { 실패: "제목이 화면에 안 들어갔습니다. 크롬 창이 가려져 있거나 다른 창이 앞에 있는지 확인하세요" }); return 마무리(); }
      if (단계 === "제목만") return 마무리();
    }

    // 5. 본문 첫 칸 클릭
    if (!이어쓰기) {
      const 본문 = await 찾기(R.본문칸);
      if (!본문) { 적기("본문", { 실패: "본문 칸을 못 찾음" }); return 마무리(); }
      await 좌표클릭(본문.loc);
      await 쉬기(400);
    }

    // 6. 블록 순서대로 (시간 예산을 넘기면 임시저장하고 '이어서' 로 넘긴다 — REPL 한 번 실행에 시간 한도가 있다)
    let 이어서 = null;
    for (const [i, 블록] of (원고.블록 || []).entries()) {
      if (i < 시작블록) continue;
      if (시간초과()) { 이어서 = { 원고: 옵션.원고 || "원고1.json", 시작블록: i }; break; }
      const 이름 = `블록${i + 1}·${블록.종류}`;
      try { await 글감닫기(이름, "쓰기 전에"); } catch (e) { 적기(이름, { 경고: `글감 확인 실패: ${String(e?.message || e).slice(0, 80)}` }); }
      try {
        if (블록.종류 === "문단") {
          await 본문서식으로();
          for (const 줄 of 블록.글) { if (줄) await 타이핑(줄); await 키("Enter"); await 쉬기(랜덤(150)); }
          const 첫줄 = String((블록.글 || []).find(Boolean) || "").replace(/\s+/g, "").slice(0, 12);
          const 곳 = 첫줄 ? await 들어간곳(첫줄) : [];
          if (곳.length && !곳.includes("text")) 적기(이름, { 경고: `문단이 ${곳.join(",")} 안으로 들어갔습니다`, 첫줄 });
          else 적기(이름, { 줄수: 블록.글.length });

        } else if (블록.종류 === "소제목") {
          // 소제목 위아래로 빈 줄 하나씩 (2026-09-23 진현님 지시). 앞 블록이 끝나면 커서는 빈 줄에 있으니 Enter 한 번이면 위 빈 줄이 생긴다.
          if (i > 0) { await 본문서식으로(); await 키("Enter"); await 쉬기(250); }
          await 타이핑(블록.글);
          await 쉬기(1000);
          const 앞머리 = 블록.글.slice(0, 12);
          const 이미소제목 = async () => (await 에디터상태()).소제목.some((s) => s.includes(앞머리));
          let 방법 = "";
          if (await 이미소제목()) {
            방법 = "이미 소제목 블록";
          } else {
            const 줄 = F.locator(R.본문문단, { hasText: 앞머리 }).last();
            if ((await 줄.count()) === 0) throw new Error(`친 줄을 화면에서 못 찾음: ${앞머리}`);
            await 좌표클릭(줄, { clickCount: 3 });
            await 쉬기(600);
            await 버튼클릭(R.문단서식버튼, "문단 서식");
            await 쉬기(900);
            await 버튼클릭(R.소제목옵션, "소제목 선택지");
            await 쉬기(700);
            await 키("Escape");
            await 쉬기(200);
            방법 = "문단서식 → 소제목";
          }
          // 소제목 글 끝에 커서를 두고 Enter 로 새 줄을 만든다. 그 뒤 소제목이 통째로 남았는지 본다.
          // 가운데서 Enter 가 들어가 둘로 쪼개졌으면 Backspace 로 다시 붙이고 끝에서 한 번 더 한다.
          const 온글 = 블록.글.replace(/\s+/g, "");
          const 온전 = () => F.locator("body").first().evaluate((el, 온글) => [...el.ownerDocument.querySelectorAll(".se-component.se-sectionTitle")]
            .some((c) => (c.innerText || "").replace(/\s+/g, "").includes(온글)), 온글).catch(() => true);
          const 소제목줄 = () => F.locator(".se-component.se-sectionTitle .se-text-paragraph", { hasText: 앞머리 }).last();
          const 끝에서엔터 = async () => {
            if ((await 소제목줄().count()) > 0) await 끝클릭(소제목줄());
            await 쉬기(300);
            await 키("Enter");
            await 쉬기(500);
          };
          await 끝에서엔터();
          let 고침 = "";
          if (!(await 온전())) {
            await 키("Backspace"); await 쉬기(500);
            await 끝에서엔터();
            고침 = (await 온전()) ? "쪼개진 소제목을 붙여 다시 줄바꿈" : "소제목이 쪼개졌는데 못 붙임";
          }
          // 아래 빈 줄: 새 줄을 본문으로 돌리고 Enter 한 번
          await 본문서식으로(); await 키("Enter"); await 쉬기(250);
          const 후 = await 에디터상태();
          적기(이름, { 글: 블록.글, 방법, 소제목목록: 후.소제목, 컴포넌트: 후.컴포넌트, ...(고침 ? { [고침.includes("못") ? "경고" : "고침"]: 고침 } : {}) });

        } else if (블록.종류 === "인용구") {
          await 빈줄만들기();
          await 버튼클릭(R.인용구버튼, "인용구");
          await 쉬기(1300);
          await 타이핑(블록.글);
          await 쉬기(600);
          const 나감 = await 아래로나가기("se-quotation");
          const 후 = await 에디터상태();
          적기(이름, { 글: 블록.글.slice(0, 30), 인용구목록: 후.인용구, 나감 });

        } else if (블록.종류 === "표") {
          await 빈줄만들기();
          await 버튼클릭(R.표버튼, "표");
          await 쉬기(1800);
          // 방금 만든 표 = 문서의 마지막 표. 첫 표를 잡으면 두 번째 표부터 엉뚱한 곳(화면 밖)을 누른다 (2026-09-17 실측).
          const 표들 = F.locator(R.표컨테이너 || ".se-component.se-table");
          if ((await 표들.count()) === 0) throw new Error("표가 안 생김");
          const 칸 = 표들.last().locator(R.표칸 || "td");
          const 칸수 = await 칸.count();
          for (let k = 0; k < 블록.칸.length && k < 칸수; k++) {
            await 좌표클릭(칸.nth(k));
            await 쉬기(300);
            await 타이핑(블록.칸[k]);
            await 쉬기(200);
          }
          const 나감 = await 아래로나가기("se-table");
          const 후 = await 에디터상태();
          적기(이름, { 표칸수: 칸수, 넣은칸: 블록.칸.length, 화면칸: 후.표칸, 나감 });

        } else if (블록.종류 === "구분선") {
          await 버튼클릭(R.구분선버튼, "구분선");
          await 쉬기(1300);
          await 본문추가하기();
          const 후 = await 에디터상태();
          적기(이름, { 구분선수: 후.구분선 });

        } else if (블록.종류 === "사진") {
          const 파일 = 사진경로(블록.파일, 원고폴더);
          const b = await 찾기(R.사진버튼);
          if (!b) throw new Error("사진 버튼 못 찾음");
          try {
            // 좌표(스크롤 포함)를 먼저 재고, 선택창 대기를 건 '직후' 클릭한다. Codex 의 대기는 3초라 그 안에 눌러야 한다.
            // 대기 약속에 바로 catch 를 붙인다. 안 붙이면 거부가 '처리 안 됨' 이 되어 REPL 커널이 리셋된다 (2026-09-17 실측).
            const p = await 좌표(b.loc);
            if (!(p.w > 0 && p.h > 0)) throw new Error("사진 버튼이 화면에 없음");
            const 대기 = pw.waitForEvent("filechooser", { timeoutMs: 10000 }).then((c) => ({ 선택창: c }), (e) => ({ 오류: e }));
            await ax.click([p.x, p.y]);
            const 결과 = await 대기;
            if (결과.오류) throw new Error("파일 선택창이 안 열림: " + String(결과.오류?.message || 결과.오류).slice(0, 80));
            await 결과.선택창.setFiles([파일]);
            // 업로드가 끝나 이미지 블록이 하나 늘 때까지 기다린다 (최대 12초)
            const 전이미지 = (await 에디터상태()).이미지;
            for (let t = 0; t < 12; t++) { await 쉬기(1000); if ((await 에디터상태()).이미지 > 전이미지) break; }
            await 쉬기(800);
            await 본문추가하기();
            const 후 = await 에디터상태();
            적기(이름, { 파일: path.basename(파일), 이미지수: 후.이미지 });
          } catch (e) {
            // 사진만 실패하면 글은 계속 쓴다. 가장 흔한 원인은 크롬 확장 설정이다.
            await 키("Escape").catch(() => {});
            적기(이름, { 사진건너뜀: String(e?.message || e).slice(0, 100), 안내: "크롬 주소창에 chrome://extensions → ChatGPT 확장 '세부정보' → '파일 URL에 대한 액세스 허용' 을 켜고 다시 하면 사진이 들어갑니다" });
          }

        } else {
          적기(이름, { 건너뜀: `모르는 종류: ${블록.종류}` });
        }
        await 글감닫기(이름, "쓴 직후");
      } catch (e) {
        // 블록 하나가 안 되면 그 블록만 건너뛰고 글은 끝까지 쓴다. 열린 메뉴·선택 상태는 Escape 로 정리한다.
        적기(이름, { 건너뜀: String(e?.message || e).slice(0, 300) });
        // 표·인용구에서 멈추면 커서가 그 안에 남아 뒤 글이 전부 그 안으로 들어간다 (2026-09-28 윈도우 실측: 다음 문단이 표 첫 칸에 들어감).
        // 그 부품 바로 아래 줄로 커서를 빼낸다.
        try {
          await 키("Escape"); await 쉬기(300);
          const 부품 = 블록.종류 === "표" ? "se-table" : 블록.종류 === "인용구" ? "se-quotation" : "";
          const 복구 = 부품 && (await F.locator(`.se-component.${부품}`).count().catch(() => 0)) > 0 ? await 아래로나가기(부품) : await 본문추가하기();
          적기(이름, { 복구 });
        } catch (e2) { 적기(이름, { 복구못함: String(e2?.message || e2).slice(0, 120) }); }
        if (옵션.실패시멈춤 === true) return 마무리();
      }
    }

    // 7. 임시저장 — 발행은 절대 안 한다
    {
      const 저장 = await 찾기(R.저장버튼);
      if (!저장) { 적기("임시저장", { 실패: "저장 버튼 못 찾음" }); return 마무리(); }
      const 전 = await 에디터상태();
      await 좌표클릭(저장.loc);
      await 쉬기(3000);
      적기("임시저장", { 셀렉터: 저장.셀렉터, 저장직전: 전 });
    }
    if (이어서) { 적기("이어서", { ...이어서, 남은블록: (원고.블록 || []).length - 이어서.시작블록 }); return 마무리(이어서); }
    // 8. 점검 — 원고와 네이버 화면을 대조한다 (2026-09-23 진현님 지시: 다 쓰고 잘못된 곳이 있는지 보고 고치기)
    try {
      const 사진확인 = !기록.some((r) => r.사진건너뜀);
      const 요약 = { 제목: 원고.제목, 사진확인, 블록: (원고.블록 || []).map((b) => ({ 종류: b.종류, 글: b.글, 칸: b.칸 })) };
      const 결과 = await F.locator("body").first().evaluate((el, 원) => {
        const d = el.ownerDocument, 정 = (t) => String(t || "").replace(/\s+/g, ""), 줄 = (t) => [].concat(t || []).join(" ");
        const 문제 = [];
        const 제목 = 정((d.querySelector(".se-documentTitle") || {}).innerText);
        if (!제목.startsWith(정(원.제목).slice(0, 10))) 문제.push("제목이 원고와 다릅니다");
        const 종류 = (c) => (String(c.className).match(/se-(text|table|quotation|sectionTitle|image|horizontalLine)\b/) || [])[1] || "?";
        const 부품 = [...d.querySelectorAll(".se-component")].filter((c) => !c.classList.contains("se-documentTitle")).map((c) => ({ c, 종류: 종류(c), 글: 정(c.innerText) }));
        const 곳 = (앞) => 부품.filter((p) => p.글.includes(앞)).map((p) => p.종류);
        for (const b of 원.블록) {
          const 보기 = 줄(b.글).slice(0, 18);
          if (b.종류 === "소제목") { const g = 곳(정(줄(b.글)).slice(0, 10)); if (!g.includes("sectionTitle")) 문제.push(`소제목 "${보기}" 이 ${g.length ? "소제목 서식이 아니에요" : "빠졌어요"}`); }
          else if (b.종류 === "인용구") { const g = 곳(정(줄(b.글)).slice(0, 10)); if (!g.includes("quotation")) 문제.push(`인용구 "${보기}" 이 ${g.length ? "인용구가 아니에요" : "빠졌어요"}`); }
          else if (b.종류 === "문단") { const 첫 = 정([].concat(b.글 || []).find(Boolean)).slice(0, 12); if (!첫) continue; const g = 곳(첫); if (!g.length) 문제.push(`문단 "${보기}" 이 빠졌어요`); else if (!g.includes("text")) 문제.push(`문단 "${보기}" 이 ${g[0] === "table" ? "표" : g[0] === "quotation" ? "인용구" : g[0] === "sectionTitle" ? "소제목" : g[0]} 안에 들어갔어요`); }
        }
        const 표들 = 부품.filter((p) => p.종류 === "table");
        원.블록.filter((b) => b.종류 === "표").forEach((b, i) => {
          const t = 표들[i];
          if (!t) { 문제.push(`표 ${i + 1}개째가 빠졌어요`); return; }
          const 칸 = [...t.c.querySelectorAll("td")].map((td) => 정(td.innerText));
          if ((b.칸 || []).some((v, k) => 칸[k] !== 정(v))) 문제.push(`표 ${i + 1}개째 칸 내용이 원고와 달라요`);
        });
        if (원.사진확인) { const 원사진 = 원.블록.filter((b) => b.종류 === "사진").length, 화면사진 = 부품.filter((p) => p.종류 === "image").length; if (화면사진 < 원사진) 문제.push(`사진이 ${원사진}장 중 ${화면사진}장만 들어갔어요`); }
        return { 문제 };
      }, 요약);
      적기("점검", { 문제: 결과.문제 || [] });
    } catch (e) { 적기("점검", { 문제: [], 점검못함: String(e?.message || e).slice(0, 120) }); }
    return 마무리();
  } catch (e) {
    적기("오류", { 내용: String(e?.message || e), 어디서: (e?.stack || "").split("\n").slice(0, 3).join(" | ") });
    return 마무리();
  }

  function 마무리(이어서 = null) {
    const 마지막 = 기록[기록.length - 1] || {};
    const 성공 = !기록.some((r) => r.실패 || r.단계 === "오류");
    const 건너뛴것 = 기록.filter((r) => r.건너뜀 || r.사진건너뜀).map((r) => r.단계);
    if (성공 && 이어서) {
      return {
        결과: "이어서 필요",
        이어서,
        걸린시간초: Math.round((Date.now() - 시작) / 1000),
        기록,
        다음: `아직 안 끝났습니다. 묻지 말고 같은 원고로 시작블록 ${이어서.시작블록} 부터 이어서 실행하세요.`,
      };
    }
    return {
      결과: !성공 ? `멈춤 — ${마지막.단계}` : 건너뛴것.length ? `끝까지 됨 (건너뜀: ${건너뛴것.join(", ")})` : "끝까지 됨",
      걸린시간초: Math.round((Date.now() - 시작) / 1000),
      기록,
      다음: !성공
        ? "위 기록의 '실패' 항목을 그대로 코치에게 보내세요."
        : 건너뛴것.length
          ? "글은 다 들어갔고 위 블록만 빠졌습니다. 네이버 화면에서 확인하고, 괜찮으면 직접 '발행' 을 누르세요. 빠진 블록은 코치에게 알려 주세요."
          : "네이버 화면에서 글을 확인하고, 괜찮으면 직접 '발행' 을 누르세요.",
    };
  }
}
