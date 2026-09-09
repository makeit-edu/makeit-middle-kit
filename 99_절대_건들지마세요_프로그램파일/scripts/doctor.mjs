#!/usr/bin/env node

// 진단 (npm run doctor) — 키트 상태 점검
// 이 키트는 애드센스 승인글 하나만 다루므로 모드 구분 없이 한 번에 전부 점검한다.
// 표시 규칙:
//   [OK] 정상 / [나중에 입력] 키설정 전이라 아직 없는 값(실패 아님) / [확인 필요] 조치가 필요한 항목
//   각 항목에는 에러코드 태그(E01~)가 붙는다 — 문의 채널에서 코치가 항목을 특정하는 용도.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {listTitleFileCandidates} from "./title-files.mjs";
import {PROGRAM_ROOT, PROJECT_ROOT, ENV_LOCAL_PATH, hasEnvLocal, loadEnv, valueReady} from "./lib/env.mjs";

const rootDir = PROGRAM_ROOT;
const projectRoot = PROJECT_ROOT;
const WORK_DIR_NAME = "애드센스 승인글";

// 프로그램 루트의 선언된 의존성 개수 — 0개면 node_modules 부재가 정상 상태다
const programDependencyCount = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
    return Object.keys({...(pkg.dependencies || {}), ...(pkg.devDependencies || {})}).length;
  } catch {
    return 0;
  }
})();

function run(command, args = []) {
  try {
    return execFileSync(command, args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return "";
  }
}

function npmVersion() {
  return run("npm", ["--version"]);
}

// 디스크 사용량 — 디스크는 32GB 지만 무료 스토리지 한도는 15GB-month 라,
// 디스크가 한참 남았는데도 무료 한도가 먼저 소진돼 다음 달까지 작업방이 멈출 수 있다.
// 그래서 퍼센트가 아니라 절대 용량으로 미리 경고한다.
function diskUsage() {
  const output = run("df", ["-Pk", projectRoot]);
  const line = output.split("\n").slice(1).find(Boolean);
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const usedGb = (Number(parts[2]) / 1024 / 1024).toFixed(1);
  const totalGb = (Number(parts[1]) / 1024 / 1024).toFixed(1);
  return {usedGb, totalGb, percent: parts[4]};
}

function printChecks(title, checks) {
  console.log(title);
  console.log("=".repeat(44));
  for (const check of checks) {
    const mark = check.ok ? "[OK]" : check.later ? "[나중에 입력]" : "[확인 필요]";
    console.log(`${mark} (${check.code}) ${check.name}: ${check.detail}`);
  }
  console.log("=".repeat(44));
  console.log("비밀번호와 API 키 값은 출력하지 않음.");
  const needsAction = checks.some((check) => !check.ok && !check.later);
  if (needsAction) {
    console.log("[확인 필요] 항목이 있으면 이 출력 전체를 복사해 문의 채널에 올려주세요.");
  } else {
    console.log("모든 항목이 [OK] 또는 [나중에 입력]이면 정상입니다.");
  }
}

function siteReady(env, prefix) {
  return (
    valueReady(env[`${prefix}_URL`], ["example.com", "example-"]) &&
    valueReady(env[`${prefix}_USER`], ["your-admin-id"]) &&
    valueReady(env[`${prefix}_APP_PASSWORD`], ["xxxx"])
  );
}

// process.env(Codespaces Secrets 포함) + .env.local 병합 값 사용 (lib/env.mjs loadEnv)
const env = loadEnv();
const platformMap = {darwin: "macOS", win32: "Windows", linux: "Linux"};
const npm = npmVersion();
const disk = diskUsage();
const codespaceSized = Boolean(disk) && Number(disk.totalGb) <= 100;

const openAiReady = valueReady(env.OPENAI_API_KEY, ["sk-your", "your-openai", "placeholder"]);
const envReady = hasEnvLocal() || openAiReady; // Codespaces Secrets만 쓰는 경우도 인정
const workDir = join(projectRoot, WORK_DIR_NAME);

const adsenseReadyCount = ["ADSENSE_SITE_01", "ADSENSE_SITE_02", "ADSENSE_SITE_03"].filter((prefix) => siteReady(env, prefix)).length;
const titleCandidates = [1, 2, 3].map((n) => listTitleFileCandidates(projectRoot, n));
const titlesReady = titleCandidates.some((candidates) => candidates.some((candidate) => candidate.titleCount > 0));

const checks = [
  {code: "E01", name: "운영체제", ok: true, detail: platformMap[process.platform] || process.platform},
  {code: "E02", name: "Node.js", ok: Boolean(process.versions.node), detail: process.versions.node ? `v${process.versions.node}` : "확인 안 됨"},
  {code: "E03", name: "npm", ok: Boolean(npm), detail: npm || "확인 안 됨"},
  {
    code: "E04",
    name: "프로그램 설치",
    // 이 프로그램은 외부 의존성이 0개(내장 실행)라 node_modules 가 없는 것이 정상이다
    ok: programDependencyCount === 0 || existsSync(join(rootDir, "node_modules")),
    detail:
      programDependencyCount === 0
        ? "설치됨 (별도 설치가 필요 없는 구조예요)"
        : existsSync(join(rootDir, "node_modules"))
          ? "설치됨"
          : "설치 안 됨 — Codespaces 재빌드(Rebuild Container)가 필요할 수 있어요",
  },
  {
    code: "E05",
    name: "작업 폴더",
    ok: existsSync(workDir),
    detail: existsSync(workDir) ? "준비됨" : `'${WORK_DIR_NAME}' 폴더가 없어요 — 저장소가 템플릿에서 제대로 복제됐는지 확인 필요`,
  },
  {
    code: "E06",
    name: "디스크 사용량",
    // 절대 용량 기준은 Codespaces 크기(32GB 안팎)일 때만 의미가 있다.
    // 코치가 큰 디스크의 로컬에서 돌릴 때 오탐하지 않도록 총용량으로 한 번 거른다.
    ok: !disk || (parseInt(disk.percent, 10) < 90 && !(codespaceSized && Number(disk.usedGb) >= 12)),
    detail: disk
      ? `${disk.usedGb}GB / ${disk.totalGb}GB 사용 (${disk.percent})` +
        ((codespaceSized && Number(disk.usedGb) >= 12) || parseInt(disk.percent, 10) >= 90
          ? " — 무료 사용량(월 15GB)에 가까워졌어요. 이 출력을 복사해 문의 채널에 알려주세요"
          : "")
      : "확인 안 됨 (치명적이지 않음)",
  },
  {
    code: "E07",
    name: "키 입력 상태 (.env.local)",
    ok: envReady,
    later: !envReady,
    detail: envReady ? (existsSync(ENV_LOCAL_PATH) ? "있음" : "Codespaces Secrets 사용 중") : "아직 없음 — 터미널에 '키설정' 을 입력하면 만들어져요",
  },
  {
    code: "W01",
    name: "OpenAI API 키",
    ok: openAiReady,
    later: !openAiReady,
    detail: openAiReady ? "입력됨" : "터미널에 '키설정' 을 입력해주세요",
  },
  {
    code: "W02",
    name: "워드프레스 사이트 연결 정보",
    ok: adsenseReadyCount > 0,
    later: adsenseReadyCount === 0,
    detail: `${adsenseReadyCount}/3개 준비됨${adsenseReadyCount === 0 ? " — 터미널에 '키설정' 을 입력해주세요" : ""}`,
  },
  {
    code: "W03",
    name: "사이트별 제목 파일",
    ok: titlesReady,
    later: !titlesReady,
    detail: titleCandidates
      .map((candidates, index) => {
        const filled = candidates.filter((candidate) => candidate.titleCount > 0);
        return `사이트${index + 1} ${filled.length > 0 ? `${filled[0].titleCount}개` : "아직 없음"}`;
      })
      .join(" / "),
  },
];

printChecks("월부 중급반 키트 환경 점검", checks);

const hardFails = checks.filter((check) => ["E02", "E03", "E04", "E05"].includes(check.code) && !check.ok);
if (hardFails.length > 0) process.exitCode = 1;
