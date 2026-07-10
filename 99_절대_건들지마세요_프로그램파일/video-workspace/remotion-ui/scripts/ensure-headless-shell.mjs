// 렌더 전용 Chrome Headless Shell 설치 상태를 확인하고, 깨져 있으면 스스로 고친다.
//
// 왜 필요한가(윈도우 함정): Remotion이 브라우저 zip을 받은 뒤 압축을 풀 때 쓰는
// extract-zip(yauzl)이 번들 Node 24 + 윈도우 조합에서 3번째 항목(하위 폴더)에서
// promise가 영원히 끝나지 않는다. 이때 Node는 이벤트 루프가 비어 "종료 코드 0"으로
// 조용히 죽기 때문에, 렌더가 아무 오류 없이 영상만 안 만들어진다.
// (증상: "Got Headless Shell" 출력 후 즉시 종료, win64 폴더에 ABOUT/LICENSE 두 개만 존재)
//
// 그래서 윈도우에서는 Remotion의 압축 해제에 기대지 않고, 윈도우 10+에 기본 내장된
// curl.exe(다운로드)와 tar.exe(zip 해제)로 직접 설치한다.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync} from "node:fs";
import path from "node:path";

// Remotion이 기대하는 버전을 소스에서 직접 읽는다(remotion 업그레이드 시 자동 추종).
function remotionTestedVersion(projectRoot) {
  try {
    const source = readFileSync(
      path.join(projectRoot, "node_modules", "@remotion", "renderer", "dist", "browser", "get-chrome-download-url.js"),
      "utf8",
    );
    const match = source.match(/TESTED_VERSION\s*=\s*'([\d.]+)'/);
    if (match) return match[1];
  } catch {
    // 파일 구조가 바뀌면 아래 고정값으로 동작한다
  }
  return "144.0.7559.20";
}

function shellPaths(projectRoot) {
  const base = path.join(projectRoot, "node_modules", ".remotion", "chrome-headless-shell");
  return {
    base,
    zipPath: path.join(base, "chrome-headless-shell-win64.zip"),
    versionPath: path.join(base, "VERSION"),
    win64Dir: path.join(base, "win64"),
    exePath: path.join(base, "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  };
}

export function headlessShellReady(projectRoot) {
  if (process.platform !== "win32") return true;
  const {exePath, versionPath} = shellPaths(projectRoot);
  if (!existsSync(exePath)) return false;
  try {
    return readFileSync(versionPath, "utf8").trim() === remotionTestedVersion(projectRoot);
  } catch {
    return false;
  }
}

// 렌더용 브라우저를 보장한다. 성공하면 조용히 넘어가고, 실패하면 이유를 담아 throw.
export function ensureHeadlessShell(projectRoot, {log = console.log} = {}) {
  if (process.platform !== "win32") return;
  if (headlessShellReady(projectRoot)) return;

  const version = remotionTestedVersion(projectRoot);
  const {base, zipPath, versionPath, win64Dir, exePath} = shellPaths(projectRoot);
  mkdirSync(base, {recursive: true});

  // 1) zip 확보 — 이전 시도에서 받아둔 zip이 있으면 재사용, 없으면 다운로드(약 108MB)
  if (!existsSync(zipPath)) {
    const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/win64/chrome-headless-shell-win64.zip`;
    log("[준비] 영상 제작용 브라우저를 내려받는 중입니다 (약 108MB, 1~3분)...");
    try {
      execFileSync("curl.exe", ["-L", "--fail", "--silent", "--show-error", "-o", zipPath, url], {stdio: ["ignore", "ignore", "inherit"]});
    } catch (error) {
      if (existsSync(zipPath)) unlinkSync(zipPath);
      throw new Error(
        `영상 제작용 브라우저 다운로드에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행해주세요. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  // 2) 압축 해제 — 윈도우 내장 tar.exe 사용 (Remotion 내장 해제기는 윈도우에서 멈추는 문제가 있음)
  log("[준비] 영상 제작용 브라우저 압축을 푸는 중입니다...");
  rmSync(win64Dir, {recursive: true, force: true});
  mkdirSync(win64Dir, {recursive: true});
  try {
    execFileSync("tar", ["-xf", zipPath, "-C", win64Dir], {stdio: ["ignore", "ignore", "inherit"]});
  } catch (error) {
    // 압축이 중간에 깨졌을 수 있으니 다음 실행에서 새로 받도록 zip을 지운다
    if (existsSync(zipPath)) unlinkSync(zipPath);
    throw new Error(
      `영상 제작용 브라우저 압축 해제에 실패했습니다. 이 파일을 다시 실행해주세요. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  if (!existsSync(exePath)) {
    if (existsSync(zipPath)) unlinkSync(zipPath);
    throw new Error("영상 제작용 브라우저 설치가 완료되지 않았습니다. 이 파일을 다시 실행해주세요.");
  }

  // 3) Remotion이 "설치 완료"로 인식하도록 버전 기록 + 용량 절약을 위해 zip 삭제
  writeFileSync(versionPath, version);
  try {
    unlinkSync(zipPath);
  } catch {
    // zip이 지워지지 않아도 동작에는 문제 없음
  }
  log("[준비] 영상 제작용 브라우저 준비 완료");
}
