// 1주차 메킷애센 기본 세팅
// Codex와 애드센스 승인글 자동화에 필요한 최소 준비만 한다.
import {execSync} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {requireLicense} from "./lib/env.mjs";

// 설치 게이트: 예전 01 런처의 코드 입력(runtime/.license_ok 파일 마커)을 폐지하고
// MAKEIT_MIDDLE_LICENSE 환경변수 검증으로 통일 (PRD D9·5-4)
requireLicense({scriptLabel: "1주차 기본 세팅"});

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(rootDir, "..");
const codexDir = path.join(rootDir, "runtime", "codex");
const isWindows = process.platform === "win32";
const results = [];

function record(name, ok, detail) {
  results.push({name, ok, detail});
  console.log(`${ok ? "[OK]" : "[!!]"} ${name}: ${detail}`);
}

function divider(title) {
  console.log("");
  console.log(`===== ${title} =====`);
}

function npmInstall(args, cwd) {
  execSync(`npm ${args}`, {cwd, stdio: "inherit", env: process.env});
}

function ensureProjectGitignore() {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const rules = [
    "# 월부 중급반 수강생용 로컬 제외 규칙",
    ".DS_Store",
    "*.zip",
    "99_절대_건들지마세요_프로그램파일/.env.local",
    "99_절대_건들지마세요_프로그램파일/.env",
    "99_절대_건들지마세요_프로그램파일/runtime/",
    "99_절대_건들지마세요_프로그램파일/node_modules/",
    "99_절대_건들지마세요_프로그램파일/makeit-adsense/outputs/",
    "01_1주차_애드센스승인/02_생성결과_확인용/*",
    "!01_1주차_애드센스승인/02_생성결과_확인용/.gitkeep",
    "",
  ].join("\n");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, rules, "utf8");
    return;
  }
  const current = readFileSync(gitignorePath, "utf8");
  if (!current.includes("월부 중급반 수강생용 로컬 제외 규칙")) {
    writeFileSync(gitignorePath, `${current.trim()}\n\n${rules}`, "utf8");
  }
}

console.log("");
console.log("1주차 메킷애센 기본 세팅을 시작합니다.");
console.log("이번 단계에서는 애드센스 승인글 자동화에 필요한 것만 준비합니다.");

divider("1/4 개인 설정 파일 준비");
const envLocalPath = path.join(rootDir, ".env.local");
const envExamplePath = path.join(rootDir, ".env.example");
if (existsSync(envLocalPath)) {
  record(".env.local", true, "이미 있습니다. 기존 값은 건드리지 않습니다.");
} else if (existsSync(envExamplePath)) {
  copyFileSync(envExamplePath, envLocalPath);
  record(".env.local", true, "입력 양식을 만들었습니다.");
} else {
  record(".env.local", false, ".env.example 파일이 없어 만들지 못했습니다.");
}

divider("2/4 애드센스 제목 파일 준비");
const titlesDir = path.join(projectRoot, "01_1주차_애드센스승인", "01_제목넣는곳");
try {
  mkdirSync(titlesDir, {recursive: true});
  for (const n of [1, 2, 3]) {
    const filePath = path.join(titlesDir, `사이트${n}_제목200개.txt`);
    if (!existsSync(filePath)) {
      writeFileSync(
        filePath,
        [
          `# 사이트${n} 제목 200개를 여기에 붙여넣으세요.`,
          "# 꼭 이 파일명을 쓸 필요는 없습니다. 파일명에 사이트1/1번/첫번째처럼 사이트 구분이 들어가면 Codex가 자동으로 찾습니다.",
          "# GPTs에서 뽑은 제목이 1. 2. 3. 처럼 넘버링되어 있어도 괜찮습니다.",
          "# 실제 제목은 이 주석 줄을 지우고 한 줄에 하나씩 넣으면 됩니다.",
          "",
        ].join("\n"),
        "utf8",
      );
    }
  }
  record("제목 파일", true, "사이트1/2/3 제목 파일 준비 완료");
} catch (error) {
  record("제목 파일", false, error instanceof Error ? error.message : String(error));
}

divider("3/4 Codex 설치");
const codexBin = path.join(codexDir, "node_modules", ".bin", isWindows ? "codex.cmd" : "codex");
try {
  npmInstall(`install --prefix "${codexDir}" --no-audit --no-fund @openai/codex@latest`, rootDir);
  if (existsSync(codexBin)) {
    const codexPkg = JSON.parse(
      readFileSync(path.join(codexDir, "node_modules", "@openai", "codex", "package.json"), "utf8"),
    );
    record("Codex", true, `설치 완료 (버전 ${codexPkg.version})`);
  } else {
    record("Codex", false, "설치 파일을 찾지 못했습니다. 1주차 설치를 다시 실행해주세요.");
  }
} catch {
  record("Codex", false, "설치 실패. 인터넷 연결을 확인하고 다시 실행해주세요.");
}

// (Codespaces 전환) Codex 기본 모델(config.toml) 설정은 .devcontainer/setup.sh 로 일원화 — 여기서는 하지 않는다.

divider("4/4 토큰 최적화");
try {
  // 저장소 기반(Codespaces)이므로 git init 은 하지 않는다 — .gitignore 규칙만 보강한다.
  execSync("git --version", {stdio: "ignore"});
  ensureProjectGitignore();
  record("토큰 최적화", true, "무거운 폴더를 Codex 컨텍스트에서 제외할 준비 완료");
} catch {
  record("토큰 최적화", true, "git 없음. 규칙 파일로 큰 폴더 탐색을 막습니다.");
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log("==========================================");
if (failed.length === 0) {
  console.log("1주차 기본 세팅이 끝났습니다.");
  console.log("");
  console.log("다음 단계:");
  console.log("  1. 터미널에 '키설정' 을 입력해 OpenAI API 키와 워드프레스 정보 넣기");
  console.log("  2. 터미널에 '시작' 을 입력해 Codex 열기");
  console.log("  3. '애드센스 승인글 자동화 시작해줘' 입력");
} else {
  console.log("완료되지 않은 항목이 있습니다:");
  for (const item of failed) console.log(`  - ${item.name}: ${item.detail}`);
}
console.log("==========================================");

process.exit(failed.length === 0 ? 0 : 1);
