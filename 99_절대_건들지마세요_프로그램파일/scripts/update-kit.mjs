#!/usr/bin/env node

// 업데이트 (npm run update:kit) — 템플릿 저장소(upstream)의 최신 프로그램 파일을 받아온다. (PRD D17·5-9)
// - "Use this template" 복제 저장소에는 upstream 연결이 없으므로, 여기서 자동 등록한다.
// - 프로그램 영역(99_절대_건들지마세요_프로그램파일/, bin/, AGENTS.md, .devcontainer/)만 선택 동기화하고
//   수강생 작업 영역(01_/02_ 폴더)은 절대 건드리지 않는다.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {PROGRAM_ROOT, PROJECT_ROOT} from "./lib/env.mjs";

// upstream에서 받아올 프로그램 영역 (수강생 작업 영역 01_/02_는 여기 절대 넣지 않는다)
const SYNC_PATHS = ["99_절대_건들지마세요_프로그램파일", "bin", "AGENTS.md", ".devcontainer", ".gitignore"];

function git(args, options = {}) {
  // core.quotePath=false: 한글 파일명이 \354... 형태로 깨져 보이지 않게 한다
  return execFileSync("git", ["-C", PROJECT_ROOT, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function gitQuiet(args) {
  try {
    return git(args).trim();
  } catch {
    return "";
  }
}

function fail(lines) {
  console.error("");
  console.error("==========================================");
  for (const line of [].concat(lines)) console.error(line);
  console.error("==========================================");
  process.exit(1);
}

console.log("");
console.log("==================================================");
console.log(" 업데이트 — 프로그램 파일을 최신 버전으로 받아옵니다");
console.log("==================================================");
console.log("작업물(01_/02_ 폴더)과 키 설정(.env.local)은 건드리지 않아요.");

// ===== 0. 기본 확인 =====
if (!existsSync(path.join(PROJECT_ROOT, ".git"))) {
  fail(["여기는 아직 git 저장소가 아니에요. Codespaces에서 실행해주세요."]);
}

// ===== 1. 템플릿 저장소 주소 읽기 (package.json > config.templateRepo) =====
let templateRepo = "";
try {
  const pkg = JSON.parse(readFileSync(path.join(PROGRAM_ROOT, "package.json"), "utf8"));
  templateRepo = String(pkg?.config?.templateRepo || "").trim();
} catch {
  templateRepo = "";
}
if (!templateRepo || templateRepo.includes("REPLACE_WITH")) {
  fail([
    "업데이트 기능이 아직 준비 중이에요. 지금은 할 일이 없습니다!",
    "혹시 공지에서 '업데이트를 입력하세요'라고 안내받았다면, 이 화면을 복사해 문의 채널에 올려주세요.",
    "",
    "(운영진 참고: 배포 전에 99_절대_건들지마세요_프로그램파일/package.json 의",
    " config.templateRepo 값을 실제 템플릿 저장소 주소로 바꿔야 합니다 — 배포 체크리스트 항목)",
  ]);
}

// ===== 2. upstream 원격 등록 (없으면 추가, 주소가 다르면 갱신) =====
const currentUpstream = gitQuiet(["remote", "get-url", "upstream"]);
if (!currentUpstream) {
  git(["remote", "add", "upstream", templateRepo]);
  console.log(`[OK] 템플릿 저장소를 연결했어요: ${templateRepo}`);
} else if (currentUpstream !== templateRepo) {
  git(["remote", "set-url", "upstream", templateRepo]);
  console.log(`[OK] 템플릿 저장소 주소를 갱신했어요: ${templateRepo}`);
}

// ===== 3. 프로그램 영역에 수강생 수정이 있는지 확인 (있으면 덮어쓰기 위험 → 중단) =====
// 단, .gitignore는 "훼손 시 업데이트로 복구"가 공식 절차이므로 수정돼 있어도 중단하지 않는다 (저장 스크립트 안내와 연동)
const DIRTY_CHECK_PATHS = SYNC_PATHS.filter((syncPath) => syncPath !== ".gitignore");
const dirty = gitQuiet(["status", "--porcelain", "--", ...DIRTY_CHECK_PATHS]);
if (dirty) {
  fail([
    "업데이트를 멈췄습니다 — 프로그램 파일 영역에 직접 수정한 흔적이 있어요.",
    "(이 영역은 '절대 건들지 마세요' 폴더라서, 업데이트가 수정 내용을 덮어쓸 수 있어요)",
    "",
    "수정된 파일:",
    ...dirty.split("\n").slice(0, 10).map((line) => `  - ${line.trim()}`),
    "",
    "직접 수정한 기억이 없다면, 위 목록을 복사해서 문의 채널에 올려주세요.",
  ]);
}

// ===== 4. 최신 내용 받아오기 =====
console.log("");
console.log("최신 프로그램 파일을 확인하는 중...");
// 템플릿 저장소의 기본 브랜치를 감지한다 (보통 main — 감지 실패 시 main으로 진행)
const symref = gitQuiet(["ls-remote", "--symref", "upstream", "HEAD"]);
const branchMatch = symref.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
const UPSTREAM_BRANCH = branchMatch ? branchMatch[1] : "main";
try {
  git(["fetch", "upstream", UPSTREAM_BRANCH], {stdio: ["ignore", "inherit", "inherit"]});
} catch {
  fail([
    "템플릿 저장소에서 최신 내용을 받아오지 못했어요.",
    "인터넷 연결을 확인하고 다시 실행해주세요.",
    "반복되면 GitHub 로그인(저장소 읽기 권한) 문제일 수 있으니 문의 채널에 알려주세요.",
  ]);
}

// upstream에 실제로 존재하는 경로만 동기화 대상으로 삼는다 (없는 경로 checkout은 오류)
const upstreamTree = gitQuiet(["ls-tree", "--name-only", `upstream/${UPSTREAM_BRANCH}`]).split("\n").filter(Boolean);
const syncTargets = SYNC_PATHS.filter((syncPath) => upstreamTree.includes(syncPath));
if (syncTargets.length === 0) {
  fail(["템플릿 저장소에서 프로그램 폴더를 찾지 못했어요. 문의 채널에 알려주세요."]);
}

// ===== 5. 변경 요약 → 적용 =====
const diffStat = gitQuiet(["diff", "--stat", "HEAD", `upstream/${UPSTREAM_BRANCH}`, "--", ...syncTargets]);
if (!diffStat) {
  console.log("");
  console.log("[OK] 이미 최신 버전이에요! 업데이트할 내용이 없습니다.");
  process.exit(0);
}

const changedFiles = gitQuiet(["diff", "--name-only", "HEAD", `upstream/${UPSTREAM_BRANCH}`, "--", ...syncTargets])
  .split("\n")
  .filter(Boolean);

console.log("");
console.log(`업데이트할 파일 ${changedFiles.length}개를 받아옵니다.`);
for (const file of changedFiles.slice(0, 15)) console.log(`  - ${file}`);
if (changedFiles.length > 15) console.log(`  ... 외 ${changedFiles.length - 15}개`);

try {
  git(["checkout", `upstream/${UPSTREAM_BRANCH}`, "--", ...syncTargets]);
} catch (error) {
  fail([
    "업데이트 적용에 실패했어요.",
    String(error && error.stderr ? error.stderr : error).trim(),
    "위 메시지를 복사해서 문의 채널에 올려주세요.",
  ]);
}

// 받아온 프로그램 파일을 바로 커밋해 저장소 상태를 깔끔하게 유지한다
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
try {
  git(["commit", "-q", "-m", `업데이트: 프로그램 파일 동기화 (${stamp})`]);
} catch {
  // 커밋할 변경이 없거나(이미 반영) 사용자 설정 문제 — 적용 자체는 끝났으므로 계속 진행
}

console.log("");
console.log("==================================================");
console.log(`[OK] 업데이트 완료! 파일 ${changedFiles.length}개가 최신 버전이 됐어요.`);
if (changedFiles.some((file) => file.startsWith(".devcontainer"))) {
  console.log("");
  console.log("[중요] 개발 환경 설정(.devcontainer)이 바뀌었어요.");
  console.log("왼쪽 아래 파란 버튼(Codespaces) → 'Rebuild Container'를 눌러 환경을 새로 고쳐주세요.");
}
console.log("이어서 하던 작업을 그대로 진행하면 됩니다.");
console.log("==================================================");
