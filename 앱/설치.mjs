// 앱/설치.mjs — 수강생이 처음 한 번 돌리는 설치. 하는 일은 셋뿐이다.
//   1) 작업 폴더에 대본(AGENTS.md) 저장            ← GitHub 앱/AGENTS.md 를 받아서
//   2) 전역 ~/.codex/AGENTS.md 에 같은 대본 삽입   ← 코덱스 앱이 폴더 AGENTS.md 를 안 읽을 때가 있어서 (2026-09-17 실측)
//   3) 데이터 폴더 만들기 (애드센스 승인글/00_설정 · 01_제목넣는곳 · 02_생성결과_확인용)
// 프로그램 파일은 저장하지 않는다. 프로그램은 실행할 때마다 GitHub 에서 읽는다 (앱/로더.mjs).

import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

const 저장소 = "makeit-edu/makeit-middle-kit";
const 시작표 = "<!-- 메킷키트 시작 (설치.mjs 가 관리. 손으로 고치지 마세요) -->";
const 끝표 = "<!-- 메킷키트 끝 -->";
// 대본 판 번호 (1주차=1, 2주차=2). 더 높은 판이 깔려 있으면 낮은 판으로 덮지 않는다.
function 대본판(글) {
  const m = /<!-- 키트판 (\d+) -->/.exec(String(글 || ""));
  return m ? Number(m[1]) : String(글 || "").includes("메킷 키트") ? 1 : 0;
}

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

  // 코덱스가 README 를 읽으려고 저장소를 통째로 내려받는 경우가 있다 (2026-09-23 실측: 작업 폴더 안에 makeit-middle-kit-naver/ 를 git clone).
  // 그러면 프로그램 파일이 수강생 PC 에 남는다. 우리 저장소 사본(폴더 이름 + .git 원격 주소 둘 다 맞을 때만)은 지운다.
  try {
    for (const 이름 of await readdir(작업폴더)) {
      if (!/^makeit-middle-kit(-naver)?$/.test(이름)) continue;
      const 깃설정 = await readFile(join(작업폴더, 이름, ".git", "config"), "utf8").catch(() => "");
      if (!/github\.com[/:]makeit-edu\/makeit-middle-kit(-naver)?(\.git)?\b/.test(깃설정)) continue;
      await rm(join(작업폴더, 이름), {recursive: true, force: true});
      기록[`내려받은 저장소 사본 ${이름}`] = "정리";
    }
  } catch {}

  let 폴더대본 = "";
  try { 폴더대본 = await readFile(join(작업폴더, "AGENTS.md"), "utf8"); } catch {}
  if (대본판(폴더대본) > 대본판(대본)) 기록["AGENTS.md (작업 폴더 대본)"] = "이미 있음";
  else { await writeFile(join(작업폴더, "AGENTS.md"), 대본, "utf8"); 기록["AGENTS.md (작업 폴더 대본)"] = "받음"; }

  for (const d of ["00_설정", "01_제목넣는곳", "02_생성결과_확인용"]) await mkdir(join(작업폴더, "애드센스 승인글", d), {recursive: true});
  기록["애드센스 승인글/ 폴더 3개"] = "만듦";
  // 수강생이 채울 키설정.txt (있으면 그대로 둔다)
  const 키파일 = join(작업폴더, "애드센스 승인글", "00_설정", "키설정.txt");
  try {
    await readFile(키파일, "utf8");
    기록["키설정.txt"] = "이미 있음";
  } catch {
    await writeFile(키파일, `# 아래 순서대로 한 줄에 하나씩 넣고 저장하세요. (이 줄은 지워도 됩니다)
# 1 OpenAI 키  2 사이트 주소  3 워드프레스 관리자 아이디  4 애플리케이션 비밀번호
# 사이트가 더 있으면 주소·아이디·비밀번호 세 줄을 같은 순서로 이어서 적으세요.
# 이 파일은 비밀번호가 들어 있으니 남에게 보내거나 채팅방에 올리지 마세요.
`, "utf8");
    기록["키설정.txt"] = "만듦";
  }

  try {
    const 전역폴더 = join(homedir(), ".codex");
    const 전역파일 = join(전역폴더, "AGENTS.md");
    let 기존 = "";
    try { 기존 = await readFile(전역파일, "utf8"); } catch {}
    const 덩어리 = `${시작표}\n${대본.trim()}\n${끝표}`;
    const a = 기존.indexOf(시작표), b = 기존.indexOf(끝표);
    if (a >= 0 && b > a && 대본판(기존.slice(a, b)) > 대본판(대본)) throw new Error("더 높은 판이 이미 깔려 있음");
    const 새것 = a >= 0 && b > a
      ? 기존.slice(0, a) + 덩어리 + 기존.slice(b + 끝표.length)
      : (기존.trim() ? 기존.trimEnd() + "\n\n" : "") + 덩어리 + "\n";
    await mkdir(전역폴더, {recursive: true});
    if (기존 && a < 0) await writeFile(전역파일 + ".백업-" + Date.now(), 기존, "utf8");
    await writeFile(전역파일, 새것, "utf8");
    기록["~/.codex/AGENTS.md (전역 대본)"] = a >= 0 ? "갱신" : "받음";
  } catch (e) {
    기록["~/.codex/AGENTS.md (전역 대본)"] = /더 높은 판/.test(String(e?.message)) ? "이미 있음" : "실패: " + String(e?.message || e).slice(0, 80);
  }

  const 전부됨 = Object.values(기록).every((v) => v === "받음" || v === "갱신" || v === "만듦" || v === "이미 있음" || v === "정리");
  return {
    폴더: 작업폴더,
    기록,
    결과: 전부됨 ? "설치 끝" : "일부 실패 — 이 화면을 코치에게 보여 주세요",
    다음: 전부됨 ? "설치 끝. 수강생에게 딱 두 문장만 말하고 답을 기다린다: '설치가 끝났어요. 이제 처음 한 번만 하는 키 설정입니다.' '먼저 강의 자료실 공지에 있는 수강 코드를 알려 주세요.' 수강 코드를 받으면 작업 폴더의 AGENTS.md 대본대로 준비 코드를 실행하고 수강코드저장을 부른 뒤, 키설정.txt(OpenAI 키·사이트 주소·관리자 아이디·앱 비밀번호)를 끌어다 놓으라고 한다. 새 채팅을 열라고 하지 않는다." : "",
  };
}
