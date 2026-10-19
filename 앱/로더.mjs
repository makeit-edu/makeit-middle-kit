// 앱/로더.mjs — 코덱스 앱에서 GitHub 의 프로그램을 읽어 임시 폴더에서 실행하고, 끝나면 지운다.
//
// 이 파일은 수강생 폴더에 남지 않는다. 대본(AGENTS.md)의 준비 코드가 매번 GitHub 에서 받아 임시 폴더에서 import 한다.
// 그래서 이 파일은 되도록 바꾸지 않는다. 바뀌는 건 목록.json 과 프로그램 파일들이다.
//
// 캐시 대응 (2026-09-16 실측: raw 는 5분 CDN 캐시라 옛 판이 올 수 있다)
//   1) 목록.json 은 GitHub API(contents) 로 읽는다 — 캐시 없음. 실패하면 raw 로.
//   2) 목록.json 의 "커밋"(프로그램 파일들이 담긴 커밋 sha) 으로 raw 주소를 만든다.
//      raw.githubusercontent.com/<저장소>/<sha>/<파일> 은 내용이 절대 안 바뀌는 주소라 캐시가 문제 되지 않는다.
//   3) "커밋" 이 없으면 main 브랜치 + ?t= 로 받는다 (예비).
//
// 정지: 목록.json 의 "정지": true 면 아무것도 내려받지 않고 안내만 돌려준다. 기수가 끝나면 이걸로 전원 정지.
//
// 내 커스텀 키트 (2026-10-17 진현님 지시, 10/19 비공개로): 수강생이 이 저장소를 자기 깃허브에 복사해 마음대로 고친 키트.
//   코드는 각자 깃허브에만 있고, 고치는 것도 온라인(코덱스 웹·깃허브)에서만 한다. PC 에는 원본처럼 실행할 때만 임시로 받는다.
//   준비 코드가 저장소 이름을 넘기거나 폴더 표시(00_설정/키트저장소.txt)가 있으면 그 저장소에서 읽는다.
//   커스텀 키트는 목록의 "커밋" 고정 대신 자기 main 의 최신 커밋을 쓴다 (코덱스 웹에서 고쳐 병합하면 다음 실행부터 바로 바뀌게).
//   비공개 복사본("Use this template" → Private, 10/19 진현님 결정)은 읽기 전용 깃허브 토큰(00_설정/깃허브토큰.txt)으로 읽는다.
//   토큰은 그 커스텀 저장소로 보내는 요청에만 붙인다. 원본 키트 요청에는 절대 붙이지 않는다.

import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {pathToFileURL} from "node:url";

export const 버전 = "2026-10-19a";
const 공식저장소 = "makeit-edu/makeit-middle-kit";
const 저장소꼴 = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
// 깃허브 토큰 꼴 (github_pat_… · ghp_… 등). 값은 어디에도 찍지 않는다.
const 토큰꼴 = /^[A-Za-z0-9_]{20,255}$/;
// 내 커스텀 키트 폴더 표시 — 설치가 커스텀 저장소로 깔 때 적는다. 코덱스가 폴더 대본 대신 전역(원본) 대본으로 준비 코드를 돌려도
// 이 표시가 있으면 그 폴더는 내 커스텀 키트로 돈다 (2026-09-17 실측: 코덱스 앱이 폴더 AGENTS.md 를 안 읽을 때가 있음).
const 표시파일 = ["애드센스 승인글", "00_설정", "키트저장소.txt"];
const 토큰파일 = ["애드센스 승인글", "00_설정", "깃허브토큰.txt"];
// 대본(앱/AGENTS.md) 준비 코드 속 저장소 줄을 이 키트의 저장소로 맞춘다. 승인글의 대본 최신화가 이 사본을 폴더에 깐다.
const 저장소묶기 = (대본, 저장소이름) => String(대본).replace(/let 저장소 ?= ?"[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+";/g, (줄) => 줄.replace(/"[^"]*"/, `"${저장소이름}"`));
const 다듬기 = (값) => String(값 || "").trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/[?#].*$/, "").replace(/\.git$/, "").replace(/\/+$/, "").split("/").slice(0, 2).join("/");
const 브랜치 = "main";
const 목록파일 = "앱/목록.json";
const 진입파일 = "앱/승인글.mjs";
// 목록.json 의 "진입": {"승인글": "앱/승인글.mjs", "네이버": "앱/네이버.mjs"} 처럼 적으면 앱.승인글, 앱.네이버 로 준다.
// 지금은 한 저장소에 승인글·네이버·메킷애센·커스텀이 다 들어 있다. (옛 2주차 저장소는 이 저장소를 그대로 따라 만든 사본)
function 진입목록(목록) {
  const m = 목록 && typeof 목록.진입 === "object" && 목록.진입 ? 목록.진입 : {승인글: 진입파일};
  return Object.entries(m).filter(([, f]) => typeof f === "string" && f.endsWith(".mjs"));
}

function 인코딩(파일) {
  // 한글 파일 이름은 붙인 모양(NFC)으로 주소를 만든다. 맥에서 만든 목록은 자모가 쪼개져(NFD) 있어 GitHub 가 404 를 준다 (2026-09-23 실측).
  return String(파일).normalize("NFC").split("/").map(encodeURIComponent).join("/");
}

// 곳 = {저장소, 토큰} — 불러올 때마다 따로 들고 다닌다 (원본·커스텀이 서로 섞이지 않게)
async function 받기(곳, url, {timeout = 20000, 헤더 = {}} = {}) {
  const 인증 = 곳.토큰 && /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(url) ? {Authorization: `token ${곳.토큰}`} : {};
  const r = await fetch(url, {cache: "no-store", signal: AbortSignal.timeout(timeout), headers: {...헤더, ...인증}});
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status} ${url.replace(/^https:\/\//, "").slice(0, 80)}`);
    e.상태 = r.status;
    throw e;
  }
  return r;
}

// 커스텀 키트: 저장소 main 의 최신 커밋 (API 한 번, sha 만 받는다)
async function 최신커밋(곳) {
  const r = await 받기(곳, `https://api.github.com/repos/${곳.저장소}/commits/${브랜치}`, {헤더: {Accept: "application/vnd.github.sha"}});
  const sha = (await r.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("최신 커밋을 읽지 못했습니다");
  return sha;
}

// GitHub API 로 파일 내용 읽기 (캐시 없음, 비인증 시간당 60회 제한 — 목록 한 개에만 쓴다)
async function API텍스트(곳, 파일, ref = 브랜치) {
  const r = await 받기(곳, `https://api.github.com/repos/${곳.저장소}/contents/${인코딩(파일)}?ref=${encodeURIComponent(ref)}`);
  const body = await r.json();
  if (!body.content) throw new Error("API 응답에 내용 없음");
  return Buffer.from(String(body.content).replace(/\s/g, ""), "base64").toString("utf8");
}

async function raw텍스트(곳, 파일, ref = 브랜치) {
  const 고정 = /^[0-9a-f]{40}$/.test(ref);
  const url = `https://raw.githubusercontent.com/${곳.저장소}/${ref}/${인코딩(파일)}${고정 ? "" : `?t=${Date.now()}`}`;
  return (await 받기(곳, url)).text();
}

const 원본곳 = {저장소: 공식저장소, 토큰: ""};
export async function 목록읽기() {
  const 오류 = [];
  try {
    return {목록: JSON.parse(await API텍스트(원본곳, 목록파일)), 경로: "api"};
  } catch (e) {
    오류.push("api: " + (e?.message || e));
  }
  try {
    return {목록: JSON.parse(await raw텍스트(원본곳, 목록파일)), 경로: "raw"};
  } catch (e) {
    오류.push("raw: " + (e?.message || e));
  }
  throw new Error("목록을 받지 못했습니다 — " + 오류.join(" / "));
}

// 커스텀 저장소를 못 읽었을 때 수강생에게 할 말 (상태 번호로 가른다)
function 커스텀안내(곳, 상태) {
  if (상태 === 401) return "깃허브 토큰이 틀렸거나 만료·삭제됐어요. 깃허브에서 새 토큰을 만들고 '깃허브 토큰 바꿔줘' 라고 하세요.";
  if (상태 === 404 && !곳.토큰) return `내 커스텀 키트 저장소(${곳.저장소})를 읽지 못했어요. 비공개 저장소는 읽기 전용 깃허브 토큰이 있어야 해요. 깃허브에서 토큰을 만들고 '깃허브 토큰 바꿔줘' 라고 하세요.`;
  if (상태 === 404) return `내 커스텀 키트 저장소(${곳.저장소})를 찾지 못했어요. 깃허브에서 저장소 이름을 바꿨거나 지웠는지, 토큰을 만들 때 이 저장소를 골랐는지 확인하세요. 토큰을 새로 만들었으면 '깃허브 토큰 바꿔줘' 라고 하세요.`;
  if (상태 === 403 || 상태 === 429) return "깃허브가 잠깐 요청을 막았어요. 1~2분 뒤 다시 해 주세요.";
  return "깃허브의 내 커스텀 키트를 읽지 못했어요. 인터넷 연결을 확인하고 1~2분 뒤 다시 해 주세요.";
}

// 지난 실행이 커널 리셋 등으로 정리() 를 못 불렀을 때 남은 임시 폴더를 치운다. 실패는 무시.
async function 옛폴더청소() {
  let 지움 = 0;
  try {
    const 부모 = tmpdir();
    for (const 이름 of await readdir(부모)) {
      if (!이름.startsWith("makeit-app-")) continue;
      try {
        const s = await stat(join(부모, 이름));
        if (Date.now() - s.mtimeMs > 10 * 60 * 1000) {
          await rm(join(부모, 이름), {recursive: true, force: true});
          지움 += 1;
        }
      } catch {}
    }
  } catch {}
  return 지움;
}

async function 첫단어(경로) {
  try { return (await readFile(경로, "utf8")).trim().split(/\s+/)[0] || ""; } catch { return ""; }
}

// 프로그램 파일 전부를 임시 폴더에 풀고 진입 모듈을 돌려준다.
// 반환: {정지:false, 버전, 커밋, 임시폴더, 승인글: <모듈>, 정리()}  또는  {정지:true, 안내}
export async function 불러오기({작업폴더, 저장소: 받은저장소 = "", _재귀 = false} = {}) {
  if (!작업폴더) throw new Error("작업폴더 를 넘겨야 합니다 (수강생 폴더의 절대경로)");
  let 요청저장소 = 다듬기(받은저장소);
  if (요청저장소 && !저장소꼴.test(요청저장소)) return {정지: true, 안내: `저장소 이름이 이상해요(${요청저장소}). '깃허브아이디/저장소이름' 꼴이어야 해요.`};
  // 폴더 표시가 있으면 그 저장소가 우선 (원본 대본으로 불려도 내 커스텀 키트 폴더는 내 저장소로)
  const 표시 = 다듬기(await 첫단어(join(작업폴더, ...표시파일)));
  if (저장소꼴.test(표시)) 요청저장소 = 표시;
  const 저장소 = 요청저장소 || 공식저장소;
  const 커스텀 = 저장소.toLowerCase() !== 공식저장소;
  // 토큰은 커스텀 저장소에만 쓴다
  let 토큰 = 커스텀 ? await 첫단어(join(작업폴더, ...토큰파일)) : "";
  if (!토큰꼴.test(토큰)) 토큰 = "";
  const 곳 = {저장소, 토큰};
  if (!_재귀) await 옛폴더청소();

  let 목록, 경로, ref;
  if (커스텀) {
    let 상태 = 0;
    try {
      // 최신 커밋은 API 로 본다. API 가 막히면(시간당 60번 제한 등) main 을 그대로 받는다 (raw 는 ?t= 로 새로 받는다)
      ref = await 최신커밋(곳).catch((e) => { 상태 = e?.상태 || 0; return 브랜치; });
      try { 목록 = JSON.parse(await raw텍스트(곳, 목록파일, ref)); 경로 = ref === 브랜치 ? "raw(main)" : "raw(최신 커밋)"; }
      catch { 목록 = JSON.parse(await API텍스트(곳, 목록파일, ref)); 경로 = "api(최신 커밋)"; }
    } catch (e) {
      return {정지: true, 안내: 커스텀안내(곳, 상태 === 401 || 상태 === 404 ? 상태 : e?.상태 || 상태), 상세: String(e?.message || e), 저장소, 토큰있음: Boolean(토큰)};
    }
  } else {
    try {
      ({목록, 경로} = await 목록읽기());
    } catch (e) {
      return {정지: true, 안내: "깃허브의 키트 파일을 읽지 못했어요. 인터넷 연결을 확인하고 잠시 후 다시 해주세요.", 상세: String(e?.message || e)};
    }
  }
  if (목록.정지 === true) {
    return {정지: true, 안내: 목록.정지안내 || "지금은 프로그램이 잠시 멈춰 있습니다. 강의 공지를 확인해 주세요."};
  }
  if (!커스텀) ref = /^[0-9a-f]{40}$/.test(String(목록.커밋 || "")) ? 목록.커밋 : 브랜치;
  const 파일들 = Array.isArray(목록.파일) ? 목록.파일 : [];
  const 진입들 = 진입목록(목록);
  const 빠진진입 = 진입들.filter(([, f]) => !파일들.includes(f)).map(([, f]) => f);
  if (!진입들.length || 빠진진입.length) return {정지: true, 안내: "프로그램 목록을 읽지 못했어요. 1~2분 뒤 다시 해 주세요.", 상세: `목록에 ${빠진진입.join(", ") || 진입파일} 없음`};

  const 임시폴더 = await mkdtemp(join(tmpdir(), "makeit-app-"));
  const 받은 = [];
  try {
    for (const 파일 of 파일들) {
      let 내용;
      try {
        내용 = await raw텍스트(곳, 파일, ref);
      } catch (e1) {
        // 고정 커밋 raw 가 안 되면 브랜치 raw, 그다음 API 로 한 번씩 더
        try {
          내용 = await raw텍스트(곳, 파일, 브랜치);
        } catch {
          내용 = await API텍스트(곳, 파일, ref);
        }
      }
      if (파일 === "앱/AGENTS.md") 내용 = 저장소묶기(내용, 저장소);
      const 목적지 = join(임시폴더, 파일);
      await mkdir(dirname(목적지), {recursive: true});
      await writeFile(목적지, 내용, "utf8");
      받은.push(파일);
    }
    const 모듈들 = {};
    for (const [이름, 파일] of 진입들) 모듈들[이름] = await import(`${pathToFileURL(join(임시폴더, 파일)).href}?t=${Date.now()}`);
    let 정리됨 = false;
    // 같은 채팅에서 `앱` 을 계속 재사용하면 그 사이에 GitHub 가 바뀌어도 옛 코드로 돈다 (2026-09-21 실측: 날짜 배치가 옛 판으로 만들어짐).
    // 그래서 승인글의 함수를 부를 때마다 목록의 커밋이 바뀌었는지 보고, 바뀌었으면 새 판을 받아 그쪽으로 넘긴다.
    const 상태 = {모듈들, 커밋: ref, 임시폴더, 마지막확인: Date.now()};
    async function 최신확인() {
      // 연달아 부를 때 API 를 매번 때리지 않는다. 커스텀 키트는 최신 커밋을 API 로 보므로(비인증 시간당 60번 제한) 2분에 한 번만
      if (Date.now() - 상태.마지막확인 < (커스텀 ? 120000 : 20000)) return;
      상태.마지막확인 = Date.now();
      let 새ref = "";
      if (커스텀) {
        try { 새ref = await 최신커밋(곳); } catch { return; }
      } else {
        let 최신;
        try { ({목록: 최신} = await 목록읽기()); } catch { return; }
        새ref = /^[0-9a-f]{40}$/.test(String(최신.커밋 || "")) ? 최신.커밋 : "";
      }
      if (!새ref || 새ref === 상태.커밋) return;
      const 다시 = await 불러오기({작업폴더, 저장소, _재귀: true});
      if (다시.정지) return;
      const 옛폴더 = 상태.임시폴더;
      상태.모듈들 = 다시._모듈들;
      상태.커밋 = 다시.커밋;
      상태.임시폴더 = 다시.임시폴더;
      rm(옛폴더, {recursive: true, force: true}).catch(() => {});
    }
    const 감싸기 = (이름) => new Proxy({}, {
      get(_, prop) {
        const 값 = 상태.모듈들[이름]?.[prop];
        if (typeof 값 !== "function") return 값;
        return async (...args) => {
          await 최신확인();
          return 상태.모듈들[이름][prop](...args);
        };
      },
      has(_, prop) { return prop in (상태.모듈들[이름] || {}); },
      ownKeys() { return Reflect.ownKeys(상태.모듈들[이름] || {}); },
    });
    const 모듈창구 = Object.fromEntries(진입들.map(([이름]) => [이름, 감싸기(이름)]));
    return {
      ...모듈창구,
      정지: false,
      버전: 목록.버전,
      저장소,
      커스텀키트: 커스텀, // '커스텀' 은 모듈 이름(앱.커스텀)이라 겹치지 않게
      커밋: ref,
      목록경로: 경로,
      임시폴더,
      받은파일수: 받은.length,
      수강코드목록: Array.isArray(목록.수강코드) ? 목록.수강코드 : [],
      _모듈들: 모듈들,
      정리: async () => {
        if (정리됨) return true;
        정리됨 = true;
        await rm(상태.임시폴더, {recursive: true, force: true});
        return true;
      },
    };
  } catch (e) {
    await rm(임시폴더, {recursive: true, force: true});
    if (커스텀 && (e?.상태 === 401 || e?.상태 === 404)) return {정지: true, 안내: 커스텀안내(곳, e.상태), 상세: String(e?.message || e), 받은파일수: 받은.length};
    return {정지: true, 안내: "깃허브의 키트 파일을 읽다가 멈췄어요. 인터넷 연결을 확인하고 1~2분 뒤 다시 해 주세요.", 상세: String(e?.message || e), 받은파일수: 받은.length};
  }
}

// 깃허브 토큰 바꾸기 — 내 커스텀 키트 폴더에서 "깃허브 토큰 바꿔줘" 할 때. 앱이 토큰 문제로 멈춰 있어도 쓸 수 있게 로더에 둔다.
// 새 토큰으로 내 저장소를 먼저 읽어 보고, 되면 그때 저장한다 (틀린 토큰으로 덮지 않게). 토큰 값은 돌려주지 않는다.
export async function 토큰저장({작업폴더, 토큰: 새토큰 = ""} = {}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  const 값 = String(새토큰 || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!토큰꼴.test(값)) return {결과: "토큰 꼴 아님", 안내: "토큰은 github_pat_ 로 시작하는 긴 글자예요. 깃허브에서 복사한 그대로 붙여넣어 주세요."};
  const 저장소 = 다듬기(await 첫단어(join(작업폴더, ...표시파일)));
  if (!저장소꼴.test(저장소)) return {결과: "커스텀 폴더 아님", 안내: "이 폴더는 내 커스텀 키트 폴더가 아니에요. 원래 폴더에서 '내 커스텀 키트 만들어줘' 라고 하세요."};
  let 상태 = 0, 비공개 = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${저장소}`, {cache: "no-store", signal: AbortSignal.timeout(15000), headers: {Accept: "application/vnd.github+json", Authorization: `token ${값}`}});
    상태 = r.status;
    if (r.ok) 비공개 = Boolean((await r.json()).private);
  } catch {
    return {결과: "멈춤", 안내: "깃허브에 연결하지 못했어요. 인터넷 연결을 확인하고 1~2분 뒤 다시 해 주세요."};
  }
  if (상태 !== 200) return {결과: 상태 === 401 ? "토큰 틀림" : 상태 === 404 ? "권한 없음" : "멈춤", 안내: 커스텀안내({저장소, 토큰: 값}, 상태), 저장소};
  const 파일 = join(작업폴더, ...토큰파일);
  await mkdir(dirname(파일), {recursive: true});
  await writeFile(파일, 값 + "\n", {encoding: "utf8", mode: 0o600});
  return {결과: "됨", 저장소, 비공개};
}
