// 1주차 키트 상태 점검 스크립트.
// 결과를 통째로 복사해서 Codex에 붙여넣으면 도움을 받을 수 있는 형식으로 출력한다.
import {existsSync, readFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {listTitleFileCandidates} from "./title-files.mjs";
import {hasEnvLocal, loadEnv} from "./lib/env.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(rootDir, "..");
const isWindows = process.platform === "win32";

const lines = [];
function report(label, value) {
  lines.push(`${label}: ${value}`);
}

function maskKey(value) {
  if (!value) return "미입력";
  const cleaned = value.trim();
  if (!cleaned || cleaned.includes("your-") || cleaned.includes("sk-your")) return "미입력 (예시값 그대로)";
  if (cleaned.length < 8) return "입력됨 (너무 짧음 - 확인 필요)";
  return `입력됨 (${cleaned.slice(0, 4)}...${cleaned.slice(-3)})`;
}

function valueReady(value, placeholderTokens = []) {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return !placeholderTokens.some((token) => lowered.includes(token));
}

function siteReady(env, prefix) {
  return (
    valueReady(env[`${prefix}_URL`], ["example.com", "example-"]) &&
    valueReady(env[`${prefix}_USER`], ["your-admin-id"]) &&
    valueReady(env[`${prefix}_APP_PASSWORD`], ["xxxx"])
  );
}

// .env.local 파일 + process.env(Codespaces Secrets) 병합 — lib/env.mjs loadEnv 경유
function readEnvLocal() {
  const env = loadEnv();
  if (!hasEnvLocal() && !env.OPENAI_API_KEY) return null;
  return env;
}

report("점검 시각", new Date().toLocaleString("ko-KR"));
report("운영체제", `${isWindows ? "윈도우" : process.platform === "darwin" ? "맥" : process.platform} (${os.arch()})`);
report("프로젝트 폴더", projectRoot);
report("프로그램 내부 폴더", rootDir);
report(
  "실행 엔진(Node)",
  `v${process.versions.node} — ${process.execPath.includes(path.join("runtime", "node")) ? "키트 내장" : "컴퓨터 설치본"}`,
);

const codexPkgPath = path.join(rootDir, "runtime", "codex", "node_modules", "@openai", "codex", "package.json");
if (existsSync(codexPkgPath)) {
  const version = JSON.parse(readFileSync(codexPkgPath, "utf8")).version;
  report("Codex", `설치됨 (버전 ${version})`);
  const codexAuthPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json");
  report(
    "Codex 로그인",
    existsSync(codexAuthPath)
      ? "로그인됨"
      : "아직 안 함 → 터미널에 '시작' 을 입력하면 로그인 안내가 나옵니다",
  );
} else {
  report("Codex", "설치 안 됨 → 터미널에 '시작' 을 입력하면 자동으로 설치됩니다");
}

const env = readEnvLocal();
if (!env) {
  report(".env.local", "없음 → 터미널에 '키설정' 을 입력하면 만들어집니다");
} else {
  report("OpenAI API 키", maskKey(env.OPENAI_API_KEY));
  report("애드센스 사이트 1", siteReady(env, "ADSENSE_SITE_01") ? "연결 정보 입력됨" : "미입력 또는 확인 필요");
  report("애드센스 사이트 2", siteReady(env, "ADSENSE_SITE_02") ? "연결 정보 입력됨" : "미입력 또는 확인 필요");
  report("애드센스 사이트 3", siteReady(env, "ADSENSE_SITE_03") ? "연결 정보 입력됨" : "미입력 또는 확인 필요");
}

for (const number of [1, 2, 3]) {
  const candidates = listTitleFileCandidates(projectRoot, number);
  const filled = candidates.filter((candidate) => candidate.titleCount > 0);
  if (filled.length > 0) {
    report(`사이트 ${number} 제목 파일`, `${filled[0].fileName} (${filled[0].titleCount}개)`);
  } else if (candidates.length > 0) {
    report(`사이트 ${number} 제목 파일`, `${candidates[0].fileName} 있음, 제목은 아직 비어 있음`);
  } else {
    report(`사이트 ${number} 제목 파일`, "없음");
  }
}

const body = lines.map((line) => `  ${line}`).join("\n");
console.log("");
console.log("================ 1주차 키트 점검 리포트 ================");
console.log(body);
console.log("======================================================");
console.log("");
console.log("문제가 있다면 위 리포트 전체를 마우스로 긁어 복사한 뒤,");
console.log("Codex에 붙여넣고 이렇게 물어보세요:");
console.log('  "이 점검 결과를 보고 무엇이 문제인지, 어떤 파일을 실행하면 되는지만 알려줘"');
