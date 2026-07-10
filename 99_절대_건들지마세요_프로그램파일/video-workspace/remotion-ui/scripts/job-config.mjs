// 현재 작업(job) 경로를 계산하는 공유 모듈
// config/current-job.json의 jobId를 기준으로 모든 경로를 정한다.
// 파일이 없으면 기본 샘플 작업(sample-001)을 사용한다.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const DEFAULT_JOB_ID = "sample-001";
export const WEEK2_DIR = "02_2주차_쇼핑숏폼자동화";
export const VIDEO_INBOX_DIR = path.join(WEEK2_DIR, "영상넣는곳");
export const FINISHED_VIDEO_DIR = path.join(WEEK2_DIR, "완성영상");
export const PROGRAM_DIR = "99_절대_건들지마세요_프로그램파일";

export function resolveJobPaths(projectRoot) {
  const currentJobPath = path.join(projectRoot, "config", "current-job.json");
  let jobId = DEFAULT_JOB_ID;
  if (existsSync(currentJobPath)) {
    try {
      const data = JSON.parse(readFileSync(currentJobPath, "utf8"));
      if (data && data.jobId) jobId = String(data.jobId);
    } catch {
      // 설정 파일이 깨져 있으면 기본 샘플 작업으로 동작한다.
    }
  }
  const jobRoot = path.join(projectRoot, "jobs", jobId);
  return {
    jobId,
    jobRoot,
    publicJobRoot: path.join(projectRoot, "public", "jobs", jobId),
    defaultPropsPath: path.join(jobRoot, "render", "shopping_shorts_props.json"),
    timelineDir: path.join(projectRoot, "editor-data", jobId),
    renderDir: path.join(jobRoot, "render", "editor_outputs"),
  };
}

export function ensureNodeModules(projectRoot) {
  if (existsSync(path.join(projectRoot, "node_modules"))) return;
  console.error("");
  console.error("[안내] 영상 편집기에 필요한 프로그램 부품이 아직 설치되지 않았습니다.");
  console.error("(원래는 작업방을 만들 때 자동으로 설치됩니다 — .devcontainer/setup.sh)");
  console.error("이렇게 해결하세요:");
  console.error("  1. 터미널에 '진단' 을 입력해 상태를 확인하고, 출력 전체를 복사해 문의 채널에 올려주세요.");
  console.error("  2. 또는 왼쪽 아래 파란 버튼(Codespaces) → 'Rebuild Container' 로 작업방을 다시 빌드해주세요.");
  console.error("");
  process.exit(1);
}

// 수강생 프로젝트 폴더 루트(2주차 영상 폴더·완성영상·실행파일이 있는 곳)
// 중요: 프로그램 폴더(99_절대_건들지마세요_프로그램파일) 안에 실수로 '02_2주차_쇼핑숏폼자동화'가 생겨도
// 거기에 속지 않도록, 먼저 프로그램 폴더를 찾고 그 '부모'부터 위로 올라가며 학생 루트를 찾는다.
export function studentRoot(projectRoot) {
  const pr = programRoot(projectRoot);
  const startDir = pr && pr !== projectRoot ? path.dirname(pr) : projectRoot;
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(path.join(dir, VIDEO_INBOX_DIR)) ||
      existsSync(path.join(dir, FINISHED_VIDEO_DIR)) ||
      existsSync(path.join(dir, WEEK2_DIR)) ||
      existsSync(path.join(dir, "영상넣는곳")) ||
      existsSync(path.join(dir, "완성영상"))
    ) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir; // 못 찾으면 프로그램 폴더의 부모(진짜 학생 루트에 가장 가까움)
}

export function programRoot(projectRoot) {
  let dir = projectRoot;
  for (let i = 0; i < 8; i += 1) {
    if (path.basename(dir).normalize("NFC") === PROGRAM_DIR.normalize("NFC")) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(projectRoot, "../..");
}

// 코덱스가 프로젝트 루트에 만드는 .git/.agents 폴더를 윈도우 탐색기에서 숨긴다.
// (수강생이 보는 폴더를 깔끔하게 — 삭제하면 코덱스가 다시 만들므로 숨김 처리만 한다)
export function hideInternalFolders(projectRoot) {
  if (process.platform !== "win32") return; // 맥은 점(.) 폴더가 기본 숨김
  const root = studentRoot(projectRoot);
  for (const name of [".git", ".agents", ".gitignore", ".gitattributes"]) {
    const target = path.join(root, name);
    if (!existsSync(target)) continue;
    try {
      execFileSync("attrib", ["+h", target], {stdio: "ignore"});
    } catch {
      // 숨김 실패는 치명적이지 않으니 조용히 넘어간다.
    }
  }
}

// 기획안 txt를 인코딩과 무관하게 최대한 올바르게 읽는다.
// (윈도우 코덱스가 UTF-16/BOM으로 저장하는 경우 대비 — UTF-8 기본, BOM 자동 처리)
export function readTextSmart(filePath) {
  const buf = readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf).swap16().toString("utf16le");
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

// 한글이 깨진(모지바케) 텍스트인지 어림 감지 — 깨졌으면 사용자에게 알려 재생성을 유도한다.
export function looksMojibake(text) {
  const sample = String(text || "").slice(0, 4000);
  const replacementCount = (sample.match(/\uFFFD/g) || []).length;
  const brokenPattern = /[?][\u{AC00}-\u{D7A3}]{1,3}[?]|[\u{3131}-\u{318E}]{4,}/u;
  return replacementCount > 5 || brokenPattern.test(sample);
}

export function windowsLocalPath(filePath) {
  const normalized = path.normalize(String(filePath || ""));
  if (process.platform !== "win32") return normalized;
  const pairs = [
    ["\\\\psf\\Home\\", "C:\\Mac\\Home\\"],
    ["\\\\Mac\\Home\\", "C:\\Mac\\Home\\"],
  ];
  for (const [from, to] of pairs) {
    if (normalized.toLowerCase().startsWith(from.toLowerCase()) && existsSync(to)) {
      return path.normalize(to + normalized.slice(from.length));
    }
  }
  return normalized;
}

export function projectRootFromScript(importMetaUrl) {
  const programDir = process.env.MAKEIT_PROGRAM_DIR;
  if (programDir) {
    return windowsLocalPath(path.join(programDir, "video-workspace", "remotion-ui"));
  }
  return windowsLocalPath(path.resolve(path.dirname(fileURLToPath(importMetaUrl)), ".."));
}
