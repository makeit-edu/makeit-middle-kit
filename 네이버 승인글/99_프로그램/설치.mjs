// 설치.mjs — 수강생 작업 폴더에 필요한 파일을 GitHub 에서 받아 넣는다. 수강생이 파일을 직접 받을 일이 없게 하는 파일.
//
// 코덱스 REPL 에서 (수강생 멘트 1):
//   const fs = await import("node:fs/promises"); const path = await import("node:path");
//   const r = await fetch("https://raw.githubusercontent.com/makeit-edu/makeit-middle-kit/main/%EB%84%A4%EC%9D%B4%EB%B2%84%20%EC%8A%B9%EC%9D%B8%EA%B8%80/99_%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8/%EC%84%A4%EC%B9%98.mjs?t=" + Date.now());
//   await fs.writeFile(path.resolve("설치.mjs"), await r.text());
//   nodeRepl.write(JSON.stringify(await (await import(path.resolve("설치.mjs"))).설치(), null, 1));

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const 저장소 = "https://raw.githubusercontent.com/makeit-edu/makeit-middle-kit/main/";
const 폴더 = "네이버 승인글";

// [저장소 안 경로, 수강생 폴더 안 경로]
const 파일들 = [
  ["네이버 승인글/AGENTS.루트.md", "AGENTS.md"],                      // 코덱스가 자동으로 읽는 대본 (작업 폴더 맨 위)
  ["네이버 승인글/AGENTS.md", "네이버 승인글/AGENTS.md"],
  ["네이버 승인글/99_프로그램/시작.mjs", "네이버 승인글/99_프로그램/시작.mjs"],
  ["네이버 승인글/99_프로그램/naver-typing.mjs", "네이버 승인글/99_프로그램/naver-typing.mjs"],
  ["네이버 승인글/99_프로그램/recipe.json", "네이버 승인글/99_프로그램/recipe.json"],
  ["네이버 승인글/99_프로그램/글만들기.mjs", "네이버 승인글/99_프로그램/글만들기.mjs"],
  ["네이버 승인글/01_원고넣는곳/원고1.json", "네이버 승인글/01_원고넣는곳/원고1.json"],
  ["네이버 승인글/02_사진넣는곳/예시.png", "네이버 승인글/02_사진넣는곳/예시.png"],
];

export async function 설치(뿌리 = path.resolve(".")) {
  const 기록 = {};
  for (const [원격경로, 로컬경로] of 파일들) {
    try {
      const 주소 = 저장소 + 원격경로.split("/").map(encodeURIComponent).join("/") + "?t=" + Date.now();
      const r = await fetch(주소, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!r.ok) { 기록[로컬경로] = `실패 HTTP ${r.status}`; continue; }
      const 목적지 = path.join(뿌리, 로컬경로);
      await mkdir(path.dirname(목적지), { recursive: true });
      await writeFile(목적지, Buffer.from(await r.arrayBuffer()));
      기록[로컬경로] = "받음";
    } catch (e) {
      기록[로컬경로] = "실패: " + String(e?.message || e).slice(0, 60);
    }
  }
  for (const d of ["00_설정", "01_원고넣는곳", "02_사진넣는곳"]) await mkdir(path.join(뿌리, 폴더, d), { recursive: true });
  const 전부됨 = Object.values(기록).every((v) => v === "받음");
  return { 폴더: path.join(뿌리, 폴더), 기록, 결과: 전부됨 ? "설치 끝" : "일부 실패 — 이 화면을 코치에게", 다음: 전부됨 ? "설치가 끝났습니다. 이 채팅을 닫고, 같은 폴더로 새 채팅을 연 다음 '네이버 글 쓰고 싶어요' 라고 말하세요." : "" };
}
