// 앱/설치.mjs — 수강생이 처음 한 번 돌리는 설치. 하는 일은 셋뿐이다.
//   1) 작업 폴더에 대본(AGENTS.md) 저장            ← GitHub 앱/AGENTS.md 를 받아서
//   2) 전역 ~/.codex/AGENTS.md 에 같은 대본 삽입   ← 코덱스 앱이 폴더 AGENTS.md 를 안 읽을 때가 있어서 (2026-09-17 실측)
//   3) 데이터 폴더 만들기 (애드센스 승인글/00_설정 · 01_제목넣는곳 · 02_생성결과_확인용)
// 프로그램 파일은 저장하지 않는다. 프로그램은 실행할 때마다 GitHub 에서 읽는다 (앱/로더.mjs).
//
// 내 커스텀 키트 (2026-10-17, 10/19 비공개로): 저장소 를 넘기면 그 저장소(수강생이 자기 깃허브에 복사한 키트)의 대본을 받아
// 준비 코드의 저장소 줄을 그 이름으로 맞춰 '그 폴더에만' 저장하고, 폴더에 표시(00_설정/키트저장소.txt)를 남긴다.
// 비공개 저장소면 토큰(읽기 전용)으로 읽고, 받은 토큰은 그 폴더의 00_설정/깃허브토큰.txt 에만 둔다 (원본 키트 폴더에는 두지 않는다).
// 전역 ~/.codex/AGENTS.md 의 원본 대본은 건드리지 않는다 (원본 키트는 원래 폴더에서 그대로 쓰게).

import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

const 공식저장소 = "makeit-edu/makeit-middle-kit";
const 저장소꼴 = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const 토큰꼴 = /^[A-Za-z0-9_]{20,255}$/;
// 대본의 준비 코드 속 저장소 줄(`let 저장소 = "…";`)을 이 키트의 저장소로 맞춘다. 원본이면 그대로다.
export function 저장소묶기(대본, 저장소) {
  return String(대본).replace(/let 저장소 ?= ?"[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+";/g, (줄) => 줄.replace(/"[^"]*"/, `"${저장소}"`));
}
const 시작표 = "<!-- 메킷키트 시작 (설치.mjs 가 관리. 손으로 고치지 마세요) -->";
const 끝표 = "<!-- 메킷키트 끝 -->";
// 대본 판 번호. 지금은 승인글·네이버·메킷애센을 합친 판 4. 더 높은 판이 깔려 있으면 낮은 판으로 덮지 않는다 (같은 판이면 새것으로).
function 대본판(글) {
  const m = /<!-- 키트판 (\d+) -->/.exec(String(글 || ""));
  return m ? Number(m[1]) : String(글 || "").includes("메킷 키트") ? 1 : 0;
}

async function 대본받기(저장소, 토큰 = "") {
  const 파일 = "앱/AGENTS.md";
  const 경로 = 파일.split("/").map(encodeURIComponent).join("/");
  const headers = 토큰 ? {Authorization: `token ${토큰}`} : {};
  let 상태 = 0;
  try {
    const r = await fetch(`https://api.github.com/repos/${저장소}/contents/${경로}?ref=main`, {signal: AbortSignal.timeout(20000), headers});
    상태 = r.status;
    if (r.ok) {
      const body = await r.json();
      if (body.content) return Buffer.from(String(body.content).replace(/\s/g, ""), "base64").toString("utf8");
    }
  } catch {}
  const r2 = await fetch(`https://raw.githubusercontent.com/${저장소}/main/${경로}?t=${Date.now()}`, {signal: AbortSignal.timeout(20000), headers});
  if (!r2.ok) {
    const e = new Error(`대본을 받지 못했습니다 (HTTP ${r2.status})`);
    e.상태 = 상태 === 401 || 상태 === 404 ? 상태 : r2.status;
    throw e;
  }
  return r2.text();
}

export async function 설치({작업폴더, 저장소 = 공식저장소, 토큰: 받은토큰 = ""}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  저장소 = String(저장소 || 공식저장소).trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/[?#].*$/, "").replace(/\.git$/, "").replace(/\/+$/, "").split("/").slice(0, 2).join("/");
  if (!저장소꼴.test(저장소)) return {폴더: 작업폴더, 기록: {}, 결과: `저장소 이름이 이상해요(${저장소}). '깃허브아이디/저장소이름' 꼴이어야 해요.`, 다음: ""};
  const 커스텀 = 저장소.toLowerCase() !== 공식저장소;
  const 토큰파일 = join(작업폴더, "애드센스 승인글", "00_설정", "깃허브토큰.txt");
  // 토큰은 커스텀 저장소에만 쓴다: 받은 토큰 → 없으면 그 폴더에 이미 있는 토큰
  let 토큰 = "";
  if (커스텀) {
    토큰 = String(받은토큰 || "").trim().replace(/^["'`]+|["'`]+$/g, "");
    if (!토큰) { try { 토큰 = (await readFile(토큰파일, "utf8")).trim().split(/\s+/)[0] || ""; } catch {} }
    if (!토큰꼴.test(토큰)) 토큰 = "";
  }
  const 기록 = {};
  let 대본;
  try { 대본 = 저장소묶기(await 대본받기(저장소, 토큰), 저장소); }
  catch (e) {
    const 결과 = !커스텀 ? "일부 실패 — 인터넷 연결을 확인하고 1~2분 뒤 같은 문장으로 다시 설치해 주세요"
      : e?.상태 === 401 ? "깃허브 토큰이 틀렸거나 만료됐어요. 깃허브에서 새 토큰을 만들어 다시 해 주세요."
      : e?.상태 === 404 && !토큰 ? `깃허브의 내 커스텀 키트(${저장소})를 읽지 못했어요. 비공개 저장소라면 먼저 원본 키트(makeit-edu/makeit-middle-kit)를 설치한 뒤 '내 커스텀 키트 만들어줘' 라고 하세요. 거기서 읽기 전용 토큰을 넣어요.`
      : `깃허브의 내 커스텀 키트(${저장소})에서 대본을 받지 못했어요. 저장소 이름과, 토큰을 만들 때 이 저장소를 골랐는지 확인하고 다시 해 주세요.`;
    return {폴더: 작업폴더, 기록, 결과, 다음: ""};
  }

  // 코덱스가 README 를 읽으려고 저장소를 통째로 내려받는 경우가 있다 (2026-09-23 실측: 작업 폴더 안에 makeit-middle-kit-naver/ 를 git clone).
  // 그러면 프로그램 파일이 수강생 PC 에 남는다. 우리 저장소 사본(폴더 이름 + .git 원격 주소 둘 다 맞을 때만)은 지운다.
  try {
    for (const 이름 of await readdir(작업폴더)) {
      const 저장소이름 = 저장소.split("/")[1];
      if (!/^makeit-middle-kit(-naver)?$/.test(이름) && 이름 !== 저장소이름) continue;
      const 깃설정 = await readFile(join(작업폴더, 이름, ".git", "config"), "utf8").catch(() => "");
      const 우리것 = /github\.com[/:]makeit-edu\/makeit-middle-kit(-naver)?(\.git)?\b/.test(깃설정) || 깃설정.toLowerCase().includes(`github.com/${저장소.toLowerCase()}`) || 깃설정.toLowerCase().includes(`github.com:${저장소.toLowerCase()}`);
      if (!우리것) continue;
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
  // 내 커스텀 키트 표시 — 커스텀이면 적고, 원본으로 다시 깔면 지운다. 로더는 이 표시를 준비 코드의 저장소보다 먼저 본다
  // (코덱스가 폴더 대본 대신 전역 대본(원본)의 준비 코드를 돌려도 이 폴더는 내 저장소로 돌게).
  const 표시 = join(작업폴더, "애드센스 승인글", "00_설정", "키트저장소.txt");
  if (커스텀) { await writeFile(표시, `${저장소}\n`, "utf8"); 기록["내 커스텀 키트 표시"] = "만듦"; }
  else await rm(표시, {force: true}).catch(() => {});
  // 깃허브 토큰 — 커스텀 저장소를 이 토큰으로 읽었으면 이 폴더에 둔다 (값은 어디에도 찍지 않는다). 원본으로 다시 깔면 지운다.
  if (커스텀 && 토큰) { await writeFile(토큰파일, 토큰 + "\n", {encoding: "utf8", mode: 0o600}); 기록["깃허브 토큰 (읽기 전용)"] = "저장"; }
  else if (!커스텀) await rm(토큰파일, {force: true}).catch(() => {});
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

  // 커스텀 키트는 이 폴더에만 대본을 둔다. 전역 대본은 원본 키트 것이라 그대로 둔다.
  if (커스텀) 기록["~/.codex/AGENTS.md (전역 대본)"] = "원본 그대로 둠";
  else try {
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

  const 전부됨 = Object.values(기록).every((v) => v === "받음" || v === "갱신" || v === "만듦" || v === "이미 있음" || v === "정리" || v === "원본 그대로 둠" || v === "저장");
  return {
    폴더: 작업폴더,
    저장소,
    커스텀,
    기록,
    결과: 전부됨 ? "설치 끝" : "일부 실패 — 인터넷 연결을 확인하고 1~2분 뒤 같은 문장으로 다시 설치해 주세요",
    다음: 전부됨 ? "설치 끝. 결과 JSON 은 수강생에게 보여 주지 않는다. 곧바로 작업 폴더 AGENTS.md 대본의 준비 코드를 실행한다. 수강 코드가 아직 없으면 수강생에게 딱 두 문장만 말하고 답을 기다린다: '설치가 끝났어요. 이제 처음 한 번만 하는 키 설정입니다.' '먼저 강의 자료실 공지에 있는 수강 코드를 알려 주세요.' 수강 코드를 받으면 대본대로 수강코드저장을 부르고, 그다음은 수강생이 이 채팅에서 말한 일에 따라 대본을 따른다 (승인글이거나 설치만 했으면 키설정.txt, 네이버면 키설정.txt — OpenAI 키만 있어도 됨, 메킷애센이면 키설정.txt 없이 바로 메킷애센 고치기). 키 설정이 이미 돼 있으면 '설치가 끝났어요.' 한 줄 뒤 수강생이 말한 일을 시작하고, 말한 일이 없으면 '설치가 끝났어요. 하실 일을 말씀해 주세요.' 라고만 한다. 다른 일을 권하지 않는다. 새 채팅을 열라고 하지 않는다." : "",
  };
}
