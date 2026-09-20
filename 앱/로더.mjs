import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";

const 기본저장소 = "makeit-edu/makeit-middle-kit";
const 기본브랜치 = "main";

function raw주소({저장소 = 기본저장소, 브랜치 = 기본브랜치, 파일}) {
  return `https://raw.githubusercontent.com/${저장소}/${브랜치}/${파일.split("/").map(encodeURIComponent).join("/")}`;
}

function api주소({저장소 = 기본저장소, 브랜치 = 기본브랜치, 파일}) {
  return `https://api.github.com/repos/${저장소}/contents/${파일.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(브랜치)}`;
}

function 기준주소({기준경로, 파일}) {
  return `${기준경로.replace(/\/$/, "")}/${파일.split("/").map(encodeURIComponent).join("/")}`;
}

async function 요청(url) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`);
  if (!response.ok) throw new Error(`GitHub 응답 오류 (${response.status})`);
  return response;
}

async function 원격텍스트(options) {
  if (options.기준경로) return await (await 요청(기준주소(options))).text();
  try {
    return await (await 요청(raw주소(options))).text();
  } catch (rawError) {
    const response = await 요청(api주소(options));
    const body = await response.json();
    if (!body.content) throw rawError;
    return Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8");
  }
}

async function 목록읽기(options) {
  const raw = JSON.parse(await 원격텍스트({...options, 파일: "앱/목록.json"}));
  if (!options.이전버전 || String(raw.버전).localeCompare(String(options.이전버전), undefined, {numeric: true}) >= 0) {
    return raw;
  }
  const apiResponse = await 요청(api주소({...options, 파일: "앱/목록.json"}));
  const body = await apiResponse.json();
  if (!body.content) return raw;
  return JSON.parse(Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8"));
}

export async function 불러오기({
  기준경로 = "",
  저장소 = 기본저장소,
  브랜치 = 기본브랜치,
  이전버전 = "",
} = {}) {
  let 목록;
  try {
    목록 = 기준경로
      ? JSON.parse(await 원격텍스트({기준경로, 파일: "목록.json"}))
      : await 목록읽기({저장소, 브랜치, 이전버전});
  } catch {
    return {정지: true, 안내: "인터넷 연결을 확인해 주세요."};
  }

  if (목록.정지 === true) {
    return {정지: true, 안내: 목록.정지안내 || "현재 자동화가 잠시 중지되어 있습니다."};
  }
  if (이전버전 && String(목록.버전).localeCompare(String(이전버전), undefined, {numeric: true}) < 0) {
    return {정지: true, 안내: "원격 프로그램 버전이 이전 버전이라 실행하지 않았습니다."};
  }

  const 작업폴더 = await mkdtemp(join(tmpdir(), "makeit-app-"));
  try {
    for (const 파일 of 목록.파일 || []) {
      const 목적지 = join(작업폴더, 파일);
      await mkdir(dirname(목적지), {recursive: true});
      await writeFile(목적지, await 원격텍스트(기준경로 ? {기준경로, 파일} : {저장소, 브랜치, 파일}), "utf8");
    }

    const 모듈 = {};
    for (const 파일 of 목록.파일 || []) {
      if (!파일.endsWith(".mjs")) continue;
      모듈[파일] = await import(`file://${join(작업폴더, 파일)}?t=${Date.now()}`);
    }

    let 정리됨 = false;
    return {
      정지: false,
      버전: 목록.버전,
      모듈,
      정리: async () => {
        if (정리됨) return;
        정리됨 = true;
        await rm(작업폴더, {recursive: true, force: true});
        return true;
      },
    };
  } catch (error) {
    await rm(작업폴더, {recursive: true, force: true});
    throw error;
  }
}
