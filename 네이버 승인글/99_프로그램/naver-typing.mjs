// 네이버 블로그 스마트에디터에 글을 '사람이 치듯' 넣는 프로그램
//
// 이 파일은 Codex 앱의 Node REPL 안에서만 돈다. 일반 node 로는 돌지 않는다.
// Codex 가 번들한 크롬 플러그인(browser-client)이 REPL 세션에만 붙기 때문이다.
//
//   const 모듈 = await import("<이 파일 절대경로>");
//   const 결과 = await 모듈.실행({ 원고: "원고1.json" });
//
// 원칙
//   · 로그인 · 2차인증 · 발행은 사람이 한다. 이 프로그램은 편집기 안만 건드리고 임시저장까지만 한다.
//   · 글자는 전부 CDP(Input.insertText / dispatchKeyEvent)로 넣는다.
//     페이지 안 자바스크립트로 넣는 글자는 네이버가 전부 거른다 (2026-09-15 실측).
//     CDP 입력은 브라우저가 진짜 키보드 입력으로 만들어 넣으므로 통과한다 (같은 날 실측).
//   · 버튼은 전부 진짜 마우스 클릭(locator.click)이다.
//   · 셀렉터와 순서는 recipe.json 에 있다. 네이버가 화면을 바꾸면 그 파일만 고친다.
//   · 판단하지 않는다. 안 되면 어디서 멈췄는지 그대로 돌려준다.

import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 프로젝트 = path.resolve(여기, "..");
const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
const 랜덤 = (기본) => 기본 + Math.floor(Math.random() * 기본);

// Codex 앱이 플러그인을 두는 자리. 맥·윈도우 모두 CODEX_HOME(기본 ~/.codex) 아래 같은 경로다.
// 캐시 폴더(버전별)가 있으면 그중 최신을, 없으면 번들 폴더를 쓴다.
//
// 주의: Codex 의 Node REPL 은 빈 vm 컨텍스트라 `process` 전역이 없다 (2026-09-16 실측, "process is not defined").
// setTimeout · fetch · console · AbortSignal 은 있다. 그래서 process 는 절대 직접 쓰지 않는다.
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
      for (const v of readdirSync(캐시).sort().reverse()) {
        후보.push(path.join(캐시, v, "scripts", "browser-client.mjs"));
      }
    }
    후보.push(path.join(home, ".tmp", "bundled-marketplaces", "openai-bundled", "plugins", "chrome", "scripts", "browser-client.mjs"));
  } catch (e) {
    throw new Error(`Codex 홈 폴더를 못 읽었습니다: ${e?.message || e}`);
  }
  // 맥 ChatGPT 앱은 번들 안에도 같은 파일을 둔다. 마지막 보루.
  후보.push("/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/chrome/scripts/browser-client.mjs");
  const 있는것 = 후보.find((p) => existsSync(p));
  if (!있는것) throw new Error(`Codex 크롬 플러그인을 못 찾았습니다. 찾아본 곳: ${후보.join(" , ")}`);
  return 있는것;
}

// 실행 전에 환경을 훑어본다. 어디서 막히는지 한 번에 보려고 만든 것. 판단은 안 한다.
export function 점검() {
  const 있음 = (이름) => typeof globalThis[이름] !== "undefined";
  let 플러그인 = null, 플러그인오류 = null;
  try { 플러그인 = 클라이언트경로(); } catch (e) { 플러그인오류 = String(e?.message || e); }
  const 원고폴더 = path.join(프로젝트, "01_원고넣는곳");
  return {
    전역: { process: 있음("process"), setTimeout: 있음("setTimeout"), fetch: 있음("fetch"), AbortSignal: 있음("AbortSignal"), nodeRepl: 있음("nodeRepl") },
    플러그인, 플러그인오류,
    프로젝트폴더: 프로젝트,
    원고목록: existsSync(원고폴더) ? readdirSync(원고폴더).filter((f) => f.endsWith(".json")) : [],
    레시피: existsSync(path.join(여기, "recipe.json")),
  };
}

// ── 레시피 · 원고 읽기 ────────────────────────────────────────────
async function 레시피읽기(원격주소) {
  // 원격과 로컬을 둘 다 읽어 '버전' 이 더 큰 쪽을 쓴다.
  // (GitHub raw 캐시가 몇 분 옛 판을 주는 일이 있어서, 원격 무조건 우선은 위험하다 — 2026-09-16 실측)
  let 로컬 = null;
  try { 로컬 = JSON.parse(await readFile(path.join(여기, "recipe.json"), "utf8")); } catch {}
  let 원격 = null;
  if (원격주소) {
    try {
      const r = await fetch(원격주소, { signal: AbortSignal.timeout(4000), cache: "no-store" });
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

function 사진경로(파일) {
  const p = path.isAbsolute(파일) ? 파일 : path.join(프로젝트, "02_사진넣는곳", 파일);
  if (!existsSync(p)) throw new Error(`사진 파일이 없습니다: ${p}`);
  return p;
}

// ── 입력 도구: 글자는 CDP 로, 버튼은 진짜 클릭으로 ─────────────────
const 키표 = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Escape: { code: "Escape", vk: 27 },
  Tab: { code: "Tab", vk: 9 },
  End: { code: "End", vk: 35 },
};

async function 키(cdp, 이름) {
  const k = 키표[이름];
  const 공통 = { key: 이름, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...공통, ...(k.text ? { text: k.text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...공통 });
}

// 한 글자씩 넣는다. 화면에서 글자가 하나씩 찍힌다.
async function 타이핑(cdp, 문장, 딜레이) {
  for (const 글자 of 문장) {
    await cdp.send("Input.insertText", { text: 글자 });
    await 쉬기(랜덤(딜레이));
  }
}

// 에디터 iframe 안을 들여다본다. 같은 도메인이라 contentDocument 로 바로 닿는다.
async function 에디터상태(pw, 프레임셀렉터) {
  return pw.evaluate((sel) => {
    const fr = document.querySelector(sel);
    const d = fr && fr.contentDocument;
    if (!d) return { 에디터: false };
    const 컴포 = [...d.querySelectorAll(".se-component")].map((c) => (c.className.match(/se-\w+/g) || [])[1] || "?");
    return {
      에디터: true,
      제목: (d.querySelector(".se-documentTitle") || {}).innerText?.trim().slice(0, 60) || "",
      본문글자수: ((d.querySelector(".se-component.se-text") || {}).innerText || "").replace(/\s/g, "").length,
      컴포넌트: 컴포,
      소제목: [...d.querySelectorAll(".se-component.se-sectionTitle")].map((e) => (e.innerText || "").trim().slice(0, 30)),
      인용구: [...d.querySelectorAll(".se-quotation")].map((e) => (e.innerText || "").trim().split("\n")[0].slice(0, 40)),
      표칸: [...d.querySelectorAll(".se-table td")].map((t) => (t.innerText || "").trim()).filter(Boolean),
      이미지: d.querySelectorAll(".se-component.se-image").length,
      구분선: d.querySelectorAll(".se-component.se-horizontalLine").length,
    };
  }, 프레임셀렉터);
}

// "작성 중인 글이 있습니다" 팝업이 뜨면 정해진 버튼을 누른다. 팝업 버튼은 JS 클릭으로도 눌린다(실측).
async function 팝업정리(pw, 프레임셀렉터, 버튼글자) {
  return pw.evaluate(({ sel, btn }) => {
    const d = document.querySelector(sel)?.contentDocument;
    if (!d) return "에디터 없음";
    const 팝 = [...d.querySelectorAll("[class*=popup],[class*=layer]")]
      .find((e) => e.offsetParent && (e.innerText || "").includes("작성 중인 글"));
    if (!팝) return "팝업 없음";
    const b = [...팝.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === btn);
    if (b) { b.click(); return `팝업 → '${btn}' 누름`; }
    return "팝업 있는데 버튼 못 찾음";
  }, { sel: 프레임셀렉터, btn: 버튼글자 });
}

// 여러 후보 셀렉터 중 화면에 있는 첫 번째를 고른다. 네이버가 클래스명을 바꿔도 하나는 살아남게.
async function 찾기(F, 후보들) {
  for (const s of 후보들) {
    const loc = F.locator(s).first();
    try { if ((await loc.count()) > 0) return { loc, 셀렉터: s }; } catch {}
  }
  return null;
}

// ── 본체 ──────────────────────────────────────────────────────────
export async function 실행(옵션 = {}) {
  const 기록 = [];
  const 적기 = (단계, 내용) => { 기록.push({ 단계, ...내용 }); };
  const 시작 = Date.now();

  try {
    // 0. 준비
    const { 레시피: R, 출처 } = await 레시피읽기(옵션.레시피주소 ?? R_기본주소);
    적기("레시피", { 출처, 버전: R.버전 });
    const 원고 = await 원고읽기(옵션.원고 || "원고1.json");
    const 딜레이 = 옵션.딜레이 ?? R.타이핑딜레이 ?? 35;
    const 단계 = 옵션.단계 || "전부";

    // 1. 브라우저에 붙기 — 이미 열려 있는 네이버 글쓰기 탭을 그대로 잡는다
    //
    // 브라우저 연결(setupBrowserRuntime)은 REPL 최상위에서 해서 agent 를 넘겨받는 것이 원칙이다.
    // 플러그인이 globalThis.nodeRepl 을 검사하는데, 그 전역은 REPL 최상위 코드에만 주어지고
    // 이 파일처럼 ~/.codex 밖에서 import 된 모듈 안에서는 보이지 않는다 (2026-09-16 실측).
    let agent = 옵션.agent;
    if (!agent) {
      const { setupBrowserRuntime } = await import(클라이언트경로());
      agent = await setupBrowserRuntime();
    }
    const chrome = await agent.browsers.get("chrome");

    const 탭들 = await chrome.user.openTabs();
    const 대상 = 탭들.find((t) => R.글쓰기주소패턴.some((p) => new RegExp(p).test(t.url || "")));
    if (!대상) {
      적기("탭찾기", { 실패: "네이버 글쓰기 화면이 열린 탭이 없습니다", 열린탭: 탭들.map((t) => (t.url || "").slice(0, 60)) });
      return 마무리();
    }
    const tab = await chrome.user.claimTab(대상);
    const pw = tab.playwright;
    const cdp = await tab.capabilities.get("cdp");
    const F = pw.frameLocator(R.프레임);
    적기("탭잡기", { 주소: (대상.url || "").slice(0, 80) });

    // 2. 팝업 정리 → 시작 전 상태
    적기("팝업", { 결과: await 팝업정리(pw, R.프레임, R.작성중팝업버튼) });
    await 쉬기(1200);
    const 전 = await 에디터상태(pw, R.프레임);
    if (!전.에디터) { 적기("에디터", { 실패: "편집기 프레임을 못 찾았습니다. 화면이 다 떴는지 확인하세요" }); return 마무리(); }
    적기("시작상태", 전);

    // 3. 제목
    {
      const t = await 찾기(F, R.제목칸);
      if (!t) { 적기("제목", { 실패: "제목 칸을 못 찾음", 시도: R.제목칸 }); return 마무리(); }
      await t.loc.click();
      await 쉬기(400);
      await 타이핑(cdp, 원고.제목, 딜레이);
      await 쉬기(500);
      const 후 = await 에디터상태(pw, R.프레임);
      적기("제목", { 셀렉터: t.셀렉터, 넣은것: 원고.제목, 화면: 후.제목, 들어감: 후.제목.includes(원고.제목.slice(0, 8)) });
      if (단계 === "제목만") return 마무리();
    }

    // 4. 본문 블록 — 원고 순서대로
    {
      const 본문 = await 찾기(F, R.본문칸);
      if (!본문) { 적기("본문", { 실패: "본문 칸을 못 찾음" }); return 마무리(); }
      await 본문.loc.click();
      await 쉬기(400);
    }

    // 인용구·표·구분선·사진 뒤에 '본문 추가' 버튼이 보이면 누른다. 이미 본문 칸이 생겨 버튼이 숨어 있으면 건너뛴다 (2026-09-16 실측).
    async function 본문추가하기() {
      const b = await 찾기(F, R.본문추가버튼);
      if (!b) return "버튼 없음";
      if (!(await b.loc.isVisible().catch(() => false))) return "버튼 숨김 → 건너뜀";
      await b.loc.click({ timeout: 5000 });
      await 쉬기(800);
      return "누름";
    }

    for (const [i, 블록] of (원고.블록 || []).entries()) {
      const 이름 = `블록${i + 1}·${블록.종류}`;
      try {
        if (블록.종류 === "문단") {
          for (const 줄 of 블록.글) {
            if (줄) await 타이핑(cdp, 줄, 딜레이);
            await 키(cdp, "Enter");
            await 쉬기(랜덤(150));
          }
          적기(이름, { 줄수: 블록.글.length });

        } else if (블록.종류 === "소제목") {
          // 줄을 치고 → 그 줄을 3번 클릭해 잡고 → 문단서식 → 소제목
          // 단, 네이버가 새 줄을 처음부터 소제목 블록으로 만들어 주는 경우가 있다 (2026-09-16 실측).
          // 그때는 서식 단계를 건너뛴다.
          await 타이핑(cdp, 블록.글, 딜레이);
          await 쉬기(1000); // 네이버가 블록을 바꿀 시간을 준다
          const 앞머리 = 블록.글.slice(0, 12);
          const 이미소제목 = async () => (await 에디터상태(pw, R.프레임)).소제목.some((s) => s.includes(앞머리));
          let 방법 = "";
          if (await 이미소제목()) {
            방법 = "이미 소제목 블록";
          } else {
            const 줄 = F.locator(R.본문문단, { hasText: 앞머리 }).last();
            let 잡음 = false;
            try { await 줄.click({ clickCount: 3, timeout: 5000 }); 잡음 = true; } catch {}
            if (!잡음 && (await 이미소제목())) {
              방법 = "이미 소제목 블록(늦게 바뀜)";
            } else {
              if (!잡음) throw new Error(`친 줄을 화면에서 못 찾음: ${앞머리}`);
              await 쉬기(500);
              const 서식 = await 찾기(F, R.문단서식버튼);
              if (!서식) throw new Error("문단 서식 버튼 못 찾음");
              await 서식.loc.click();
              await 쉬기(900);
              const 옵션버튼 = await 찾기(F, R.소제목옵션);
              if (!옵션버튼) throw new Error("소제목 선택지 못 찾음");
              await 옵션버튼.loc.click();
              await 쉬기(700);
              await 키(cdp, "Escape");
              await 쉬기(200);
              방법 = "문단서식 → 소제목";
            }
          }
          // 소제목 블록 끝에 커서를 두고 다음 줄로 (End → Enter 하면 새 본문 문단이 생긴다 — 2026-09-16 실측)
          await F.locator(".se-component.se-sectionTitle .se-text-paragraph", { hasText: 앞머리 }).last().click({ timeout: 5000 });
          await 쉬기(300);
          // 소제목 줄 끝에서 다음 줄로
          await 키(cdp, "End");
          await 키(cdp, "Enter");
          await 쉬기(400);
          const 후 = await 에디터상태(pw, R.프레임);
          적기(이름, { 글: 블록.글, 방법, 소제목목록: 후.소제목, 컴포넌트: 후.컴포넌트 });

        } else if (블록.종류 === "인용구") {
          const b = await 찾기(F, R.인용구버튼);
          if (!b) throw new Error("인용구 버튼 못 찾음");
          await b.loc.click();
          await 쉬기(1300);
          await 타이핑(cdp, 블록.글, 딜레이);
          await 쉬기(600);
          await 키(cdp, "Escape");
          await 쉬기(300);
          await 본문추가하기();
          const 후 = await 에디터상태(pw, R.프레임);
          적기(이름, { 글: 블록.글.slice(0, 30), 인용구목록: 후.인용구 });

        } else if (블록.종류 === "표") {
          const b = await 찾기(F, R.표버튼);
          if (!b) throw new Error("표 버튼 못 찾음");
          await b.loc.click();
          await 쉬기(1800);
          const 칸 = F.locator(R.표칸);
          const 칸수 = await 칸.count();
          for (let k = 0; k < 블록.칸.length && k < 칸수; k++) {
            await 칸.nth(k).click();
            await 쉬기(300);
            await 타이핑(cdp, 블록.칸[k], 딜레이);
            await 쉬기(200);
          }
          await 키(cdp, "Escape");
          await 쉬기(300);
          await 본문추가하기();
          const 후 = await 에디터상태(pw, R.프레임);
          적기(이름, { 표칸수: 칸수, 넣은칸: 블록.칸.length, 화면칸: 후.표칸 });

        } else if (블록.종류 === "구분선") {
          const b = await 찾기(F, R.구분선버튼);
          if (!b) throw new Error("구분선 버튼 못 찾음");
          await b.loc.click();
          await 쉬기(1300);
          await 본문추가하기();
          const 후 = await 에디터상태(pw, R.프레임);
          적기(이름, { 구분선수: 후.구분선 });

        } else if (블록.종류 === "사진") {
          const 파일 = 사진경로(블록.파일);
          const b = await 찾기(F, R.사진버튼);
          if (!b) throw new Error("사진 버튼 못 찾음");
          const 대기 = pw.waitForEvent("filechooser", { timeoutMs: 10000 });
          await b.loc.click();
          const 선택창 = await 대기;
          await 선택창.setFiles([파일]);
          await 쉬기(7000); // 네이버 서버 업로드 대기
          await 본문추가하기();
          const 후 = await 에디터상태(pw, R.프레임);
          적기(이름, { 파일: path.basename(파일), 이미지수: 후.이미지 });

        } else {
          적기(이름, { 건너뜀: `모르는 종류: ${블록.종류}` });
        }
      } catch (e) {
        적기(이름, { 실패: String(e?.message || e) });
        if (옵션.실패시멈춤 !== false) return 마무리();
      }
    }

    // 5. 임시저장 — 발행은 절대 안 한다
    {
      const 저장 = await 찾기(F, R.저장버튼);
      if (!저장) { 적기("임시저장", { 실패: "저장 버튼 못 찾음" }); return 마무리(); }
      const 전 = await 에디터상태(pw, R.프레임);
      await 저장.loc.click();
      await 쉬기(3500);
      적기("임시저장", { 셀렉터: 저장.셀렉터, 저장직전: 전 });
    }

    return 마무리();
  } catch (e) {
    적기("오류", { 내용: String(e?.message || e), 어디서: (e?.stack || "").split("\n").slice(0, 3).join(" | ") });
    return 마무리();
  }

  function 마무리() {
    const 마지막 = 기록[기록.length - 1] || {};
    const 성공 = !기록.some((r) => r.실패 || r.단계 === "오류");
    return {
      결과: 성공 ? "끝까지 됨" : `멈춤 — ${마지막.단계}`,
      걸린시간초: Math.round((Date.now() - 시작) / 1000),
      기록,
      다음: 성공
        ? "네이버 화면에서 글을 확인하고, 괜찮으면 직접 '발행' 을 누르세요."
        : "위 기록의 '실패' 항목을 그대로 코치에게 보내세요.",
    };
  }
}

// 원격 레시피 기본 주소 — 저장소에 올라가면 여기서 최신판을 받는다. 없으면 로컬 recipe.json 을 쓴다.
const R_기본주소 = "https://raw.githubusercontent.com/makeit-edu/makeit-middle-kit/main/%EB%84%A4%EC%9D%B4%EB%B2%84%20%EC%8A%B9%EC%9D%B8%EA%B8%80/99_%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8/recipe.json";
