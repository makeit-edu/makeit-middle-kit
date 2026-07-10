// 2주차 메킷허브 쇼핑숏폼 자동화 세팅
// Remotion+UI, 영상 제작용 브라우저, 영상 편집기 부품을 이 단계에서 준비한다.
import {execFileSync} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {requireLicense} from "./lib/env.mjs";

// 설치 게이트: 예전 2주차 런처의 파일 마커(runtime/.license_ok) 검사를 폐지하고
// MAKEIT_MIDDLE_LICENSE 환경변수 검증으로 통일 (PRD D9·5-4)
requireLicense({scriptLabel: "2주차 영상 세팅"});

const scriptRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envRootDir = process.env.MAKEIT_PROGRAM_DIR ? path.resolve(process.env.MAKEIT_PROGRAM_DIR) : "";
const cwdRootDir = path.resolve(process.cwd());

function looksLikeProgramRoot(dir) {
  return (
    dir &&
    existsSync(path.join(dir, "scripts", "doctor.mjs")) &&
    existsSync(path.join(dir, "video-workspace", "remotion-ui", "package.json"))
  );
}

const rootDir = [envRootDir, cwdRootDir, scriptRootDir].find(looksLikeProgramRoot) || scriptRootDir;
const projectRoot = path.resolve(rootDir, "..");
const remotionUiDir = path.join(rootDir, "video-workspace", "remotion-ui");
const results = [];

function record(name, ok, detail) {
  results.push({name, ok, detail});
  console.log(`${ok ? "[OK]" : "[!!]"} ${name}: ${detail}`);
}

function divider(title) {
  console.log("");
  console.log(`===== ${title} =====`);
}

function resolveNpmCommand() {
  return {command: "npm", prefixArgs: []};
}

function npmInstall(args, cwd) {
  const npm = resolveNpmCommand();
  execFileSync(npm.command, [...npm.prefixArgs, ...args], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      MAKEIT_PROGRAM_DIR: rootDir,
      INIT_CWD: cwd,
      PWD: cwd,
    },
  });
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate)) || null;
}

function resolveBrowserExecutable() {
  // 중요: 렌더는 수강생 PC의 Chrome/Edge를 쓰지 않는다. 수강생이 브라우저를 켜둔 상태에서
  // 렌더가 실패하는 문제(localhost 무응답) 때문에 전용 Chrome Headless Shell만 사용한다.
  // 여기서 시스템 브라우저를 지정하면 설치 단계에서 전용 엔진을 안 받아, 첫 영상 제작 때
  // 다시 내려받게 되므로 절대 지정하지 않는다. (환경변수로 명시한 경우만 예외)
  const fromEnv = process.env.REMOTION_BROWSER_EXECUTABLE || process.env.BROWSER_EXECUTABLE || "";
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return null;
}

const browserExecutable = resolveBrowserExecutable();

console.log("");
console.log("2주차 메킷허브 쇼핑숏폼 자동화 세팅을 시작합니다.");
console.log("이번 단계에서는 영상 제작과 편집에 필요한 부품을 준비합니다.");

divider("1/5 개인 설정 파일 확인");
const envLocalPath = path.join(rootDir, ".env.local");
const envExamplePath = path.join(rootDir, ".env.example");
if (existsSync(envLocalPath)) {
  record(".env.local", true, "이미 있습니다. 기존 입력값과 함께 사용합니다.");
} else if (existsSync(envExamplePath)) {
  copyFileSync(envExamplePath, envLocalPath);
  record(".env.local", true, "입력 양식을 만들었습니다.");
} else {
  record(".env.local", false, ".env.example 파일이 없어 만들지 못했습니다.");
}

divider("2/5 영상 입구 폴더 확인");
try {
  mkdirSync(path.join(projectRoot, "02_2주차_쇼핑숏폼자동화", "영상넣는곳"), {recursive: true});
  mkdirSync(path.join(projectRoot, "02_2주차_쇼핑숏폼자동화", "완성영상"), {recursive: true});
  record("영상 폴더", true, "영상넣는곳/완성영상 준비 완료");
} catch (error) {
  record("영상 폴더", false, error instanceof Error ? error.message : String(error));
}

divider("3/5 영상 편집기 설치");
try {
  npmInstall(["install", "--no-audit", "--no-fund"], remotionUiDir);
  record("영상 편집기", true, "설치 완료");
} catch {
  record("영상 편집기", false, "설치 실패. 인터넷 연결을 확인하고 다시 실행해주세요.");
}

divider("4/5 영상 제작용 브라우저 준비");
try {
  if (browserExecutable) {
    record("영상 제작용 브라우저", true, `환경변수로 지정된 브라우저 사용: ${path.basename(browserExecutable)}`);
  } else {
    const remotionCli = path.join(remotionUiDir, "node_modules", "@remotion", "cli", "remotion-cli.js");
    execFileSync(process.execPath, [remotionCli, "browser", "ensure"], {
      cwd: remotionUiDir,
      stdio: "inherit",
    });
    record("영상 제작용 브라우저", true, "준비 완료");
  }
} catch (error) {
  record(
    "영상 제작용 브라우저",
    false,
    `준비하지 못했습니다 — ${error instanceof Error ? error.message : String(error)} (이 파일을 다시 실행해주세요)`,
  );
}

divider("5/5 영상 작업 점검");
try {
  execFileSync(process.execPath, [path.join(rootDir, "scripts", "doctor.mjs"), "--week=2"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  record("2주차 점검", true, "완료");
} catch {
  record("2주차 점검", false, "설치 상태 점검 실패. 위 안내를 확인하고 01번을 다시 실행해주세요.");
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log("==========================================");
if (failed.length === 0) {
  console.log("2주차 영상 세팅이 끝났습니다.");
  console.log("");
  console.log("다음 단계:");
  console.log("  1. 02_2주차_쇼핑숏폼자동화/영상넣는곳 안에 상품별 폴더 만들기");
  console.log("     - 예: 영상넣는곳/001_손목보호대/1.mp4, 2.mp4, 상품정보.txt");
  console.log("  2. 터미널에 '시작' 을 입력하고 Codex에 '쇼핑숏폼 자동화 시작해줘' 입력");
  console.log("  3. 터미널 한글 명령 순서: 새상품 1 → (키설정) → 이미지만들기 → 영상만들기 → 편집기");
} else {
  console.log("완료되지 않은 항목이 있습니다:");
  for (const item of failed) console.log(`  - ${item.name}: ${item.detail}`);
}
console.log("==========================================");

process.exit(failed.length === 0 ? 0 : 1);
