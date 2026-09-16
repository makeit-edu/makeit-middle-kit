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
const 갱신대상 = ["naver-typing.mjs", "recipe.json"];

// raw 주소가 먼저, 안 되면 GitHub API 로 한 번 더. (raw 는 새 파일이 몇 분 늦게 뜰 때가 있다 — 2026-09-16 실측)
const API폴더 = "https://api.github.com/repos/makeit-edu/makeit-middle-kit/contents/"
  + encodeURIComponent("네이버 승인글") + "/" + encodeURIComponent("99_프로그램") + "/";

async function 받기(이름) {
  const 시도 = [
    // raw 는 몇 분짜리 캐시가 있어 옛 판을 줄 때가 있다. 매번 다른 쿼리를 붙여 캐시를 비켜 간다.
    [원격폴더 + encodeURIComponent(이름) + "?t=" + Date.now(), {}],
    [API폴더 + encodeURIComponent(이름) + "?ref=main", { headers: { Accept: "application/vnd.github.raw" } }],
  ];
  let 마지막오류 = null;
  for (const [주소, 추가] of 시도) {
    try {
      const r = await fetch(주소, { ...추가, signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (r.ok) return r.text();
      마지막오류 = new Error(`HTTP ${r.status}`);
    } catch (e) { 마지막오류 = e; }
  }
  throw 마지막오류;
}

// 최신판으로 덮어쓴다. 내용이 같으면 건드리지 않는다. 실패는 기록만 하고 계속 간다.
export async function 갱신() {
  const 기록 = {};
  for (const 이름 of 갱신대상) {
    const 파일 = path.join(여기, 이름);
    try {
      const 새것 = await 받기(이름);
      if (이름.endsWith(".json")) JSON.parse(새것); // 깨진 JSON 은 받지 않는다
      let 옛것 = "";
      try { 옛것 = await readFile(파일, "utf8"); } catch {}
      if (옛것 === 새것) { 기록[이름] = "최신 그대로"; continue; }
      await writeFile(파일, 새것, "utf8");
      기록[이름] = 옛것 ? "새 판으로 바꿈" : "새로 받음";
    } catch (e) {
      기록[이름] = `원격 실패(${String(e?.message || e).slice(0, 40)}) → 지금 파일 사용`;
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
