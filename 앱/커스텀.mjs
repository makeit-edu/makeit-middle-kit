// 내 커스텀 키트 — 수강생 깃허브의 (비공개) 키트 복사본을 이 PC 의 새 폴더에 연결한다.
//
// 2026-10-17 진현님 지시: "수강생 깃허브에 프로젝트가 추가돼서 그걸로 커스텀 마음대로, 원본은 그대로·커스텀은 따로"
//   + "절대 수강생들 각자 로컬에서 하게 하면 안 돼" (고치기는 온라인=코덱스 웹에서만).
// 2026-10-19 진현님 결정: 복사본은 **비공개**로 (제이디님 촬영 가이드 "본인 깃허브로 빼는 법"). 포크는 공개로만 돼서 방식을 바꿨다.
//   원본 저장소를 템플릿으로 켜 두고, 수강생이 깃허브에서 직접 "Use this template" → Private 로 복사하고 읽기 전용 토큰을 만든다.
//   이 프로그램은 그 저장소 주소와 토큰을 받아 확인한 뒤, 원래 폴더 옆 '메킷 커스텀 키트' 폴더에 그 저장소로 도는 대본을 깐다.
//   깃허브 로그인·가입·복사·토큰 만들기는 수강생이 한다. 이 프로그램은 깃허브 화면을 누르지 않는다.
//
//   · 원래 폴더와 원본 키트는 그대로 둔다. 토큰은 새 폴더의 00_설정/깃허브토큰.txt 에만 둔다.
//   · 코드는 수강생 깃허브에만 있다. 이 PC 에는 내려받지 않는다 (실행할 때만 로더가 임시 폴더로 받았다가 지운다).
//
//   앱.커스텀.연결({작업폴더, 저장소, 토큰})
//     → {결과: "됨" | "주소 필요" | "주소 이상" | "원본 주소" | "토큰 꼴 아님" | "토큰 필요" | "토큰 틀림" | "못 찾음"
//              | "키트 아님" | "옛 판" | "이미 커스텀" | "멈춤", …}   토큰 값은 결과에 넣지 않는다.

import {copyFile, mkdir, readFile, stat} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

export const 버전 = "2026-10-19a";

const 여기 = dirname(fileURLToPath(import.meta.url));
const 공식저장소 = "makeit-edu/makeit-middle-kit";
const 새폴더이름 = "메킷 커스텀 키트";
const 저장소꼴 = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const 저장소줄 = /let 저장소 ?= ?"([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)";/;
const 토큰꼴 = /^[A-Za-z0-9_]{20,255}$/;
const 작게 = (s) => String(s || "").toLowerCase();
const 다듬기 = (값) => String(값 || "").trim().replace(/^["'`<]+|["'`>]+$/g, "")
  .replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/[?#].*$/, "").replace(/\.git$/, "").replace(/\/+$/, "").split("/").slice(0, 2).join("/");
// 붙여넣은 글에서 토큰만 (앞뒤 따옴표·"토큰:" 같은 말이 붙어 와도)
function 토큰고르기(값) {
  const 글 = String(값 || "").trim();
  const m = /(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.exec(글);
  return m ? m[1] : 글.replace(/^["'`]+|["'`]+$/g, "");
}

// 지금 이 키트가 어느 저장소에서 왔는지 — 로더가 임시 폴더의 대본(앱/AGENTS.md) 저장소 줄을 이 키트의 저장소로 맞춰 둔다.
async function 이키트저장소() {
  try {
    const m = 저장소줄.exec(await readFile(join(여기, "AGENTS.md"), "utf8"));
    if (m?.[1]) return m[1];
  } catch {}
  return 공식저장소;
}

// ───────── 깃허브 API (토큰이 있으면 붙인다 — 수강생 저장소로만) ─────────
async function 깃허브(경로, 토큰) {
  const headers = {Accept: "application/vnd.github+json"};
  if (토큰) headers.Authorization = `token ${토큰}`;
  const r = await fetch(`https://api.github.com${경로}`, {headers, cache: "no-store", signal: AbortSignal.timeout(15000)});
  return {상태: r.status, 몸: r.ok ? await r.json() : null};
}
// 키트 복사본인지(대본이 있는지)와, 내 커스텀 키트로 돌 수 있는 판인지(준비 코드에 저장소 줄 — 2026-10-17 이후 판)
async function 대본확인(저장소, 토큰) {
  const {상태, 몸} = await 깃허브(`/repos/${저장소}/contents/${encodeURIComponent("앱")}/AGENTS.md?ref=main`, 토큰);
  if (상태 !== 200 || !몸?.content) return {상태, 지원: false};
  const 글 = Buffer.from(String(몸.content).replace(/\s/g, ""), "base64").toString("utf8");
  return {상태, 지원: 저장소줄.test(글)};
}

// ───────── 새 폴더 ─────────
async function 폴더있나(경로) {
  try { return (await stat(경로)).isDirectory(); } catch { return false; }
}
async function 새폴더준비(작업폴더) {
  for (const 부모 of [dirname(작업폴더), homedir()]) {
    const 경로 = join(부모, 새폴더이름);
    if (경로 === 작업폴더) continue;
    try {
      const 있었음 = await 폴더있나(경로);
      await mkdir(경로, {recursive: true});
      return {경로, 있었음};
    } catch {}
  }
  throw new Error("새 폴더를 만들지 못했습니다");
}

// 키 설정(수강 코드·OpenAI 키·워드프레스 연결)을 새 폴더로 — 이 PC 안에서만 복사한다. 새 폴더에 이미 있으면 그대로 둔다.
async function 설정옮기기(작업폴더, 새폴더) {
  const 원본 = join(작업폴더, "애드센스 승인글", "00_설정", "설정.json");
  const 대상 = join(새폴더, "애드센스 승인글", "00_설정", "설정.json");
  try { await stat(원본); } catch { return false; }
  try { await stat(대상); return true; } catch {}
  await mkdir(dirname(대상), {recursive: true});
  await copyFile(원본, 대상);
  return true;
}

const 멈춤 = (원인, 할일 = "인터넷 연결을 확인하고 1~2분 뒤 '내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.", 덧 = {}) => ({결과: "멈춤", 원인, 할일, ...덧});

// ───────── 대본에서 부르는 함수 ─────────
export async function 연결({작업폴더, 저장소: 받은저장소 = "", 토큰: 받은토큰 = ""} = {}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  const 지금저장소 = await 이키트저장소();
  if (작게(지금저장소) !== 공식저장소) return {결과: "이미 커스텀", 저장소: 지금저장소, 저장소주소: `https://github.com/${지금저장소}`};

  const 저장소 = 다듬기(받은저장소);
  if (!저장소) return {결과: "주소 필요"};
  if (!저장소꼴.test(저장소)) return {결과: "주소 이상", 안내: "저장소 주소는 https://github.com/아이디/저장소이름 꼴이에요. 깃허브의 내 저장소 화면 주소를 그대로 복사해 주세요."};
  if (작게(저장소) === 공식저장소) return {결과: "원본 주소", 안내: "이건 원본 키트 주소예요. 'Use this template' 로 만든 내 저장소 화면의 주소를 주세요."};
  const 토큰 = 받은토큰 ? 토큰고르기(받은토큰) : "";
  if (토큰 && !토큰꼴.test(토큰)) return {결과: "토큰 꼴 아님", 안내: "토큰은 github_pat_ 로 시작하는 긴 글자예요. 깃허브에서 복사한 그대로 붙여넣어 주세요."};

  try {
    // 1. 저장소가 있고 이 토큰으로 읽히는지 (비공개 저장소는 토큰 없이 404)
    const 정보 = await 깃허브(`/repos/${저장소}`, 토큰);
    if (정보.상태 === 401) return {결과: "토큰 틀림", 안내: "토큰이 틀렸거나 만료·삭제됐어요. 깃허브에서 새 토큰을 만들어 다시 붙여넣어 주세요.", 저장소};
    if (정보.상태 === 404) {
      return 토큰
        ? {결과: "못 찾음", 안내: "저장소를 찾지 못했어요. 주소가 맞는지, 토큰을 만들 때 Repository access 에서 이 저장소를 골랐는지 확인해 주세요.", 저장소}
        : {결과: "토큰 필요", 안내: "비공개 저장소는 읽기 전용 토큰이 있어야 읽을 수 있어요. 토큰도 같이 붙여넣어 주세요.", 저장소};
    }
    if (정보.상태 !== 200) return 멈춤("깃허브가 잠깐 요청을 막았어요", "1~2분 뒤 '내 커스텀 키트 만들어줘' 라고 다시 말해 주세요.");
    const 진짜이름 = 정보.몸?.full_name || 저장소; // 대소문자·이름 바뀜을 깃허브 것에 맞춘다
    const 비공개 = Boolean(정보.몸?.private);
    const 포크 = Boolean(정보.몸?.fork);
    if (정보.몸?.default_branch && 정보.몸.default_branch !== "main") {
      return 멈춤(`이 저장소의 기본 브랜치가 main 이 아니에요(${정보.몸.default_branch})`, "원본에서 'Use this template' 로 복사할 때 설정을 바꾸지 말고 새로 만들어 주세요.", {저장소: 진짜이름});
    }

    // 2. 키트 복사본인지 · 내 커스텀 키트로 돌 수 있는 판인지
    const 대본 = await 대본확인(진짜이름, 토큰);
    if (대본.상태 === 404) return {결과: "키트 아님", 안내: "이 저장소에는 메킷 키트가 없어요. 원본 makeit-edu/makeit-middle-kit 에서 'Use this template' 로 만든 저장소인지 확인해 주세요.", 저장소: 진짜이름};
    if (대본.상태 !== 200) return 멈춤("내 저장소의 키트 파일을 읽지 못했어요", undefined, {저장소: 진짜이름});
    if (!대본.지원) return {결과: "옛 판", 안내: "예전 원본으로 만든 복사본이라 내 커스텀 키트로 쓸 수 없어요. 원본에서 'Use this template' 로 새로 복사해 주세요.", 저장소: 진짜이름, 저장소주소: `https://github.com/${진짜이름}`};

    // 3. 새 폴더에 '내 저장소로 도는 대본' 깔기 (설치와 같은 일 — 저장소와 토큰만 내 것)
    const {경로: 새폴더, 있었음} = await 새폴더준비(작업폴더);
    const {설치} = await import(`${pathToFileURL(join(여기, "설치.mjs")).href}?t=${Date.now()}`);
    const 설치결과 = await 설치({작업폴더: 새폴더, 저장소: 진짜이름, 토큰});
    if (설치결과.결과 !== "설치 끝") return 멈춤("새 폴더에 내 커스텀 키트를 깔다가 멈췄어요", undefined, {저장소: 진짜이름, 폴더: 새폴더, 설치: 설치결과.결과});
    const 설정옮김 = await 설정옮기기(작업폴더, 새폴더).catch(() => false);
    return {결과: "됨", 저장소: 진짜이름, 저장소주소: `https://github.com/${진짜이름}`, 폴더: 새폴더, 폴더있었음: 있었음, 비공개, 포크, 토큰저장: Boolean(토큰), 설정옮김};
  } catch (e) {
    return 멈춤(`내 커스텀 키트를 연결하다 멈췄어요: ${String(e?.message || e).split("\n")[0].slice(0, 120)}`);
  }
}

// 10/17 판 대본이 부르던 이름들 (크롬으로 포크를 누르던 방식). 코덱스가 옛 대본을 기억하고 있을 때 새 방식으로 돌려보낸다.
// 옛 대본은 크롬확장() → 만들기({agent}) 순서로 불렀다. 크롬확장은 빈 값을 줘서 크롬을 붙이지 않게 한다.
export async function 크롬확장() {
  return "";
}
export async function 만들기() {
  return {결과: "대본 바뀜", 다음: "내 커스텀 키트 만드는 방식이 바뀌었다 (비공개 복사본 + 읽기 전용 토큰, 크롬 자동 누르기 없음). 작업 폴더의 AGENTS.md 를 다시 읽고 '내 커스텀 키트 만들기' 절 그대로 한다. 수강생에게는 이 문장을 보여 주지 않는다."};
}
