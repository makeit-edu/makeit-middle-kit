#!/usr/bin/env node

// 저장 (npm run save) — 작업물(텍스트 산출물)만 골라서 커밋하고 GitHub에 올린다.
// (PRD D16·5-5: 화이트리스트 add → push 전 시크릿 grep + .gitignore 무결성 확인 → 검출 시 push 차단)
// Private 저장소는 GitHub push protection(시크릿 스캐닝)이 무료 플랜에 적용되지 않으므로,
// 이 스크립트가 키 유출을 막는 기술적 최후 방어선이다.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {PROJECT_ROOT, VALID_LICENSE_CODES, readEnvFile} from "./lib/env.mjs";

// ===== 저장 대상 화이트리스트 =====
// 텍스트 산출물 폴더만 커밋한다. 영상(mp4)·시크릿·프로그램 파일은 대상이 아니다.
const WHITELIST_DIRS = ["01_1주차_애드센스승인", "02_2주차_쇼핑숏폼자동화"];
// 이중 방어: 폴더가 맞아도 텍스트 계열 확장자만 허용한다 (영상·압축 파일 커밋 방지)
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".html", ".gitkeep"]);

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

// ===== 0. 기본 확인 =====
if (!existsSync(path.join(PROJECT_ROOT, ".git"))) {
  fail([
    "여기는 아직 git 저장소가 아니에요.",
    "Codespaces(깃허브 저장소에서 만든 작업 공간)에서 실행하면 바로 사용할 수 있습니다.",
  ]);
}

// ===== 1. .gitignore 무결성 확인 (시크릿 제외 규칙이 살아있는지) =====
const gitignorePath = path.join(PROJECT_ROOT, ".gitignore");
const gitignoreText = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
const gitignoreProblems = [];
if (!gitignoreText) gitignoreProblems.push(".gitignore 파일이 없습니다.");
if (gitignoreText && !gitignoreText.includes(".env.local")) gitignoreProblems.push(".gitignore에 .env.local 제외 규칙이 없습니다.");
if (gitignoreText && !gitignoreText.includes(".codex")) gitignoreProblems.push(".gitignore에 .codex/ 제외 규칙이 없습니다.");
if (gitignoreProblems.length > 0) {
  fail([
    "저장을 멈췄습니다 — 보안 제외 규칙(.gitignore)이 훼손됐어요.",
    ...gitignoreProblems.map((problem) => `  - ${problem}`),
    "",
    "터미널에 `업데이트` (또는 npm run update:kit)를 실행하면 원래 규칙으로 복구됩니다.",
    "복구한 뒤 다시 저장해주세요.",
  ]);
}

// ===== 2. 변경 파일 수집 (화이트리스트 경로만) =====
// 혹시 이전에 실수로 스테이징된 파일(git add -A 등)이 있으면 먼저 전부 내려놓는다
gitQuiet(["reset", "-q"]);

// -uall(--untracked-files=all): 새 하위 폴더 안의 파일도 '폴더/' 한 줄로 축약되지 않고
// 파일 단위로 나오게 한다 (축약되면 확장자 필터가 폴더를 통째로 skip해 저장이 누락된다)
const statusRaw = git(["status", "--porcelain", "-z", "-uall", "--", ...WHITELIST_DIRS]);
const entries = statusRaw.split("\0").filter(Boolean);
const candidates = [];
for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  const state = entry.slice(0, 2);
  const filePath = entry.slice(3);
  if (state[0] === "R" || state[0] === "C") {
    // rename/copy는 다음 항목이 원래 경로 — 건너뛴다
    i += 1;
  }
  candidates.push({filePath});
}

const skipped = [];
const targets = candidates.filter(({filePath}) => {
  const ext = path.extname(filePath).toLowerCase() || path.basename(filePath);
  const allowed = TEXT_EXTENSIONS.has(ext) || path.basename(filePath) === ".gitkeep";
  if (!allowed) skipped.push(filePath);
  return allowed;
});

if (targets.length === 0) {
  console.log("");
  console.log("저장할 새 작업물이 없어요. (제목 파일·기획안 등 텍스트 작업물이 바뀌면 저장됩니다)");
  if (skipped.length > 0) {
    console.log("");
    console.log("아래 파일은 영상 등 대용량 파일이라 저장 대상이 아니에요. (완성영상은 다운로드해서 보관해주세요)");
    for (const file of skipped.slice(0, 10)) console.log(`  - ${file}`);
  }
  process.exit(0);
}

// git add는 파일 삭제도 함께 기록하므로, 허용된 파일만 하나씩 스테이징한다
for (const {filePath} of targets) {
  git(["add", "--", filePath]);
}

// ===== 3. push 전 시크릿 가드 =====
// .env.local에 저장된 "실제 값"을 읽어와 커밋될 내용에 들어있는지 정확 대조한다
const envValues = readEnvFile();
const sensitiveExact = [];
for (const [key, value] of Object.entries(envValues)) {
  const text = String(value || "").trim();
  if (text.length < 8) continue;
  if (/^(your-|example|xxxx|sk-your|https:\/\/example)/i.test(text)) continue;
  if (/(_API_KEY|_APP_PASSWORD|LICENSE)/.test(key)) sensitiveExact.push({key, value: text});
}
for (const code of VALID_LICENSE_CODES) sensitiveExact.push({key: "수강 코드", value: code});

const secretPatterns = [
  {label: "OpenAI API 키 형식(sk-...)", regex: /sk-[A-Za-z0-9_-]{20,}/},
  {label: "ElevenLabs API 키 형식(sk_...)", regex: /sk_[A-Za-z0-9]{20,}/},
  {label: "ElevenLabs 키 사용 흔적(xi-api-key)", regex: /xi-api-key\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i},
];

const stagedFiles = git(["diff", "--cached", "--name-only", "-z"]).split("\0").filter(Boolean);
const violations = [];
for (const filePath of stagedFiles) {
  const base = path.basename(filePath);
  if (base === ".env.local" || base === ".env") {
    violations.push({filePath, label: "시크릿 파일 자체가 커밋 대상에 포함됨"});
    continue;
  }
  let content = "";
  try {
    content = git(["show", `:${filePath}`]);
  } catch {
    continue; // 삭제된 파일 등은 내용 검사 대상 아님
  }
  for (const {label, regex} of secretPatterns) {
    if (regex.test(content)) violations.push({filePath, label});
  }
  for (const {key, value} of sensitiveExact) {
    if (content.includes(value)) violations.push({filePath, label: `${key} 실제 값이 그대로 들어 있음`});
  }
}

if (violations.length > 0) {
  gitQuiet(["reset", "-q"]);
  fail([
    "저장을 중단했습니다 — 커밋하려던 파일 안에서 API 키/수강 코드로 보이는 값이 발견됐어요.",
    "(키가 GitHub에 한 번 올라가면 기록에 영원히 남아서, 키를 새로 발급받는 것 말고는 되돌릴 방법이 없어요)",
    "",
    "발견된 위치:",
    ...[...new Set(violations.map(({filePath, label}) => `  - ${filePath} → ${label}`))],
    "",
    "해결 방법: 해당 파일을 열어 키/코드 값을 지운 뒤, 다시 `저장`을 실행해주세요.",
    "키는 오직 키설정(npm run keys)으로만 입력하면 됩니다.",
  ]);
}

// ===== 4. 커밋 + push =====
const changedWeek1 = targets.filter(({filePath}) => filePath.startsWith("01_")).length;
const changedWeek2 = targets.filter(({filePath}) => filePath.startsWith("02_")).length;
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
const summaryParts = [];
if (changedWeek1 > 0) summaryParts.push(`1주차 ${changedWeek1}개`);
if (changedWeek2 > 0) summaryParts.push(`2주차 ${changedWeek2}개`);
const message = `저장: ${stamp} — ${summaryParts.join(", ")} 파일 갱신`;

try {
  git(["commit", "-q", "-m", message]);
} catch (error) {
  fail([
    "커밋에 실패했어요.",
    String(error && error.stderr ? error.stderr : error).trim(),
    "위 메시지를 복사해서 문의 채널에 올려주시면 도와드릴게요.",
  ]);
}

console.log("");
console.log(`[OK] 커밋 완료 — ${message}`);
if (skipped.length > 0) {
  console.log("");
  console.log("아래 파일은 영상 등 대용량 파일이라 커밋하지 않았어요. (완성영상은 다운로드해서 보관해주세요)");
  for (const file of skipped.slice(0, 10)) console.log(`  - ${file}`);
}

const branch = gitQuiet(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
const hasOrigin = gitQuiet(["remote", "get-url", "origin"]);
if (!hasOrigin) {
  console.log("");
  console.log("[안내] GitHub 원격 저장소(origin)가 아직 연결되지 않아 컴퓨터 안에만 저장됐어요.");
  console.log("Codespaces에서 실행하면 자동으로 GitHub까지 올라갑니다.");
  process.exit(0);
}

try {
  git(["push", "origin", branch], {stdio: ["ignore", "inherit", "inherit"]});
  console.log("");
  console.log("[OK] GitHub에 안전하게 저장됐습니다. 수고하셨어요!");
} catch {
  fail([
    "GitHub에 올리는(push) 데 실패했어요. 인터넷 연결을 확인하고 다시 실행해주세요.",
    "반복되면 위 오류 메시지를 복사해서 문의 채널에 올려주시면 도와드릴게요.",
    "(커밋 자체는 완료되어 작업물이 사라지지는 않았습니다)",
  ]);
}
