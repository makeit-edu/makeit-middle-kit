// 앱/설치.mjs — 수강생이 처음 한 번 돌리는 설치. 하는 일은 셋뿐이다.
//   1) 작업 폴더에 대본(AGENTS.md) 저장            ← GitHub 앱/AGENTS.md 를 받아서
//   2) 전역 ~/.codex/AGENTS.md 에 같은 대본 삽입   ← 코덱스 앱이 폴더 AGENTS.md 를 안 읽을 때가 있어서 (2026-09-17 실측)
//   3) 데이터 폴더 만들기 (애드센스 승인글/00_설정 · 01_제목넣는곳 · 02_생성결과_확인용)
// 프로그램 파일은 저장하지 않는다. 프로그램은 실행할 때마다 GitHub 에서 읽는다 (앱/로더.mjs).

import {mkdir, readFile, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

const 저장소 = "makeit-edu/makeit-middle-kit";
const 시작표 = "<!-- 메킷키트 시작 (설치.mjs 가 관리. 손으로 고치지 마세요) -->";
const 끝표 = "<!-- 메킷키트 끝 -->";

async function 대본받기() {
  const 파일 = "앱/AGENTS.md";
  const 경로 = 파일.split("/").map(encodeURIComponent).join("/");
  try {
    const r = await fetch(`https://api.github.com/repos/${저장소}/contents/${경로}?ref=main`, {signal: AbortSignal.timeout(20000)});
    if (r.ok) {
      const body = await r.json();
      if (body.content) return Buffer.from(String(body.content).replace(/\s/g, ""), "base64").toString("utf8");
    }
  } catch {}
  const r2 = await fetch(`https://raw.githubusercontent.com/${저장소}/main/${경로}?t=${Date.now()}`, {signal: AbortSignal.timeout(20000)});
  if (!r2.ok) throw new Error(`대본을 받지 못했습니다 (HTTP ${r2.status})`);
  return r2.text();
}

export async function 설치({작업폴더}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  const 기록 = {};
  const 대본 = await 대본받기();

  await writeFile(join(작업폴더, "AGENTS.md"), 대본, "utf8");
  기록["AGENTS.md (작업 폴더 대본)"] = "받음";

  for (const d of ["00_설정", "01_제목넣는곳", "02_생성결과_확인용"]) await mkdir(join(작업폴더, "애드센스 승인글", d), {recursive: true});
  기록["애드센스 승인글/ 폴더 3개"] = "만듦";

  try {
    const 전역폴더 = join(homedir(), ".codex");
    const 전역파일 = join(전역폴더, "AGENTS.md");
    let 기존 = "";
    try { 기존 = await readFile(전역파일, "utf8"); } catch {}
    const 덩어리 = `${시작표}\n${대본.trim()}\n${끝표}`;
    const a = 기존.indexOf(시작표), b = 기존.indexOf(끝표);
    const 새것 = a >= 0 && b > a
      ? 기존.slice(0, a) + 덩어리 + 기존.slice(b + 끝표.length)
      : (기존.trim() ? 기존.trimEnd() + "\n\n" : "") + 덩어리 + "\n";
    await mkdir(전역폴더, {recursive: true});
    if (기존 && a < 0) await writeFile(전역파일 + ".백업-" + Date.now(), 기존, "utf8");
    await writeFile(전역파일, 새것, "utf8");
    기록["~/.codex/AGENTS.md (전역 대본)"] = a >= 0 ? "갱신" : "받음";
  } catch (e) {
    기록["~/.codex/AGENTS.md (전역 대본)"] = "실패: " + String(e?.message || e).slice(0, 80);
  }

  const 전부됨 = Object.values(기록).every((v) => v === "받음" || v === "갱신" || v === "만듦");
  return {
    폴더: 작업폴더,
    기록,
    결과: 전부됨 ? "설치 끝" : "일부 실패 — 이 화면을 코치에게 보여 주세요",
    다음: 전부됨 ? "설치가 끝났습니다. 이 채팅을 닫고, 같은 폴더로 새 채팅을 연 다음 '승인글 자동화 시작해' 라고 말하세요." : "",
  };
}
