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

import {mkdtemp, mkdir, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {pathToFileURL} from "node:url";

export const 버전 = "2026-09-23b";
const 저장소 = "makeit-edu/makeit-middle-kit";
const 브랜치 = "main";
const 목록파일 = "앱/목록.json";
const 진입파일 = "앱/승인글.mjs";
// 목록.json 의 "진입": {"승인글": "앱/승인글.mjs", "네이버": "앱/네이버.mjs"} 처럼 적으면 앱.승인글, 앱.네이버 로 준다.
// 1주차 저장소는 승인글 하나, 2주차 저장소는 승인글+네이버. 로더 코드는 두 저장소가 똑같다 (저장소 이름만 다름).
function 진입목록(목록) {
  const m = 목록 && typeof 목록.진입 === "object" && 목록.진입 ? 목록.진입 : {승인글: 진입파일};
  return Object.entries(m).filter(([, f]) => typeof f === "string" && f.endsWith(".mjs"));
}

function 인코딩(파일) {
  // 한글 파일 이름은 붙인 모양(NFC)으로 주소를 만든다. 맥에서 만든 목록은 자모가 쪼개져(NFD) 있어 GitHub 가 404 를 준다 (2026-09-23 실측).
  return String(파일).normalize("NFC").split("/").map(encodeURIComponent).join("/");
}

async function 받기(url, {timeout = 20000} = {}) {
  const r = await fetch(url, {cache: "no-store", signal: AbortSignal.timeout(timeout)});
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 80)}`);
  return r;
}

// GitHub API 로 파일 내용 읽기 (캐시 없음, 비인증 시간당 60회 제한 — 목록 한 개에만 쓴다)
async function API텍스트(파일, ref = 브랜치) {
  const r = await 받기(`https://api.github.com/repos/${저장소}/contents/${인코딩(파일)}?ref=${encodeURIComponent(ref)}`);
  const body = await r.json();
  if (!body.content) throw new Error("API 응답에 내용 없음");
  return Buffer.from(String(body.content).replace(/\s/g, ""), "base64").toString("utf8");
}

async function raw텍스트(파일, ref = 브랜치) {
  const 고정 = /^[0-9a-f]{40}$/.test(ref);
  const url = `https://raw.githubusercontent.com/${저장소}/${ref}/${인코딩(파일)}${고정 ? "" : `?t=${Date.now()}`}`;
  return (await 받기(url)).text();
}

export async function 목록읽기() {
  const 오류 = [];
  try {
    return {목록: JSON.parse(await API텍스트(목록파일)), 경로: "api"};
  } catch (e) {
    오류.push("api: " + (e?.message || e));
  }
  try {
    return {목록: JSON.parse(await raw텍스트(목록파일)), 경로: "raw"};
  } catch (e) {
    오류.push("raw: " + (e?.message || e));
  }
  throw new Error("목록을 받지 못했습니다 — " + 오류.join(" / "));
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

// 프로그램 파일 전부를 임시 폴더에 풀고 진입 모듈을 돌려준다.
// 반환: {정지:false, 버전, 커밋, 임시폴더, 승인글: <모듈>, 정리()}  또는  {정지:true, 안내}
export async function 불러오기({작업폴더, _재귀 = false} = {}) {
  if (!작업폴더) throw new Error("작업폴더 를 넘겨야 합니다 (수강생 폴더의 절대경로)");
  if (!_재귀) await 옛폴더청소();

  let 목록, 경로;
  try {
    ({목록, 경로} = await 목록읽기());
  } catch (e) {
    return {정지: true, 안내: "깃허브의 키트 파일을 읽지 못했어요. 인터넷 연결을 확인하고 잠시 후 다시 해주세요.", 상세: String(e?.message || e)};
  }
  if (목록.정지 === true) {
    return {정지: true, 안내: 목록.정지안내 || "지금은 프로그램이 잠시 멈춰 있습니다. 강의 공지를 확인해 주세요."};
  }
  const ref = /^[0-9a-f]{40}$/.test(String(목록.커밋 || "")) ? 목록.커밋 : 브랜치;
  const 파일들 = Array.isArray(목록.파일) ? 목록.파일 : [];
  const 진입들 = 진입목록(목록);
  const 빠진진입 = 진입들.filter(([, f]) => !파일들.includes(f)).map(([, f]) => f);
  if (!진입들.length || 빠진진입.length) return {정지: true, 안내: "프로그램 목록이 비어 있습니다. 강사에게 알려 주세요.", 상세: `목록에 ${빠진진입.join(", ") || 진입파일} 없음`};

  const 임시폴더 = await mkdtemp(join(tmpdir(), "makeit-app-"));
  const 받은 = [];
  try {
    for (const 파일 of 파일들) {
      let 내용;
      try {
        내용 = await raw텍스트(파일, ref);
      } catch (e1) {
        // 고정 커밋 raw 가 안 되면 브랜치 raw, 그다음 API 로 한 번씩 더
        try {
          내용 = await raw텍스트(파일, 브랜치);
        } catch {
          내용 = await API텍스트(파일, ref);
        }
      }
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
      if (Date.now() - 상태.마지막확인 < 20000) return; // 연달아 부를 때 API 를 매번 때리지 않는다
      상태.마지막확인 = Date.now();
      let 최신;
      try { ({목록: 최신} = await 목록읽기()); } catch { return; }
      const 새ref = /^[0-9a-f]{40}$/.test(String(최신.커밋 || "")) ? 최신.커밋 : "";
      if (!새ref || 새ref === 상태.커밋) return;
      const 다시 = await 불러오기({작업폴더, _재귀: true});
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
    return {정지: true, 안내: "깃허브의 키트 파일을 읽다가 멈췄어요. 잠시 후 다시 해주세요. 계속 그러면 이 화면을 문의 채널에 올려 주세요.", 상세: String(e?.message || e), 받은파일수: 받은.length};
  }
}
