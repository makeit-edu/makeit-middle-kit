#!/usr/bin/env node

// 진단 (npm run doctor) — 키트 상태 점검 (PRD 5-8 개편판)
// 모드:
//   (인자 없음)  온보딩 기본 모드 — 환경만 점검 (Node/npm/폴더/설치 상태). 키 미입력은 실패가 아니다.
//   --week=1     1주차 작업 모드 — 기본 점검 + OpenAI 키·사이트 연결·제목 파일
//   --week=2     2주차 작업 모드 — 기본 점검 + 영상 폴더·편집기·Headless Shell·키
// 표시 규칙:
//   [OK] 정상 / [나중에 입력] 키설정 전이라 아직 없는 값(실패 아님) / [확인 필요] 조치가 필요한 항목
//   각 항목에는 에러코드 태그(E01~)가 붙는다 — 문의 채널에서 코치가 항목을 특정하는 용도.
import {execFileSync} from "node:child_process";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {listTitleFileCandidates} from "./title-files.mjs";
import {PROGRAM_ROOT, PROJECT_ROOT, ENV_LOCAL_PATH, hasEnvLocal, loadEnv, valueReady} from "./lib/env.mjs";

const rootDir = PROGRAM_ROOT;
const projectRoot = PROJECT_ROOT;
const week = process.argv.includes("--week=2") ? 2 : process.argv.includes("--week=1") ? 1 : 0;

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

// 렌더 전용 Chrome Headless Shell 존재 확인 (시스템 Chrome/Edge는 쓰지 않는다 — Codespaces 리눅스 기준)
function headlessShellInstalled(remotionUiDir) {
  const base = join(remotionUiDir, "node_modules", ".remotion", "chrome-headless-shell");
  if (!existsSync(base)) return false;
  // 플랫폼 폴더(linux64/mac-arm64/win64 등) 아래에 chrome-headless-shell 실행 파일이 있는지 확인
  const walk = (dir, depth) => {
    if (depth > 3) return false;
    let entries;
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith("chrome-headless-shell")) return true;
      if (entry.isDirectory() && walk(join(dir, entry.name), depth + 1)) return true;
    }
    return false;
  };
  return walk(base, 0);
}

// 디스크 사용량 (PRD 5-7 — 15GB-month 한도 관리용)
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
const remotionUiDir = join(rootDir, "video-workspace", "remotion-ui");
const disk = diskUsage();

// ── 공통(환경) 점검 항목 — 온보딩 기본 모드는 이것만 본다 ──────────────────
const openAiReady = valueReady(env.OPENAI_API_KEY, ["sk-your", "your-openai", "placeholder"]);
const elevenLabsReady = valueReady(env.ELEVENLABS_API_KEY, ["your-elevenlabs", "placeholder"]);
const envReady = hasEnvLocal() || openAiReady; // Codespaces Secrets만 쓰는 경우도 인정

const baseChecks = [
  {code: "E01", name: "운영체제", ok: true, detail: platformMap[process.platform] || process.platform},
  {code: "E02", name: "Node.js", ok: Boolean(process.versions.node), detail: process.versions.node ? `v${process.versions.node}` : "확인 안 됨"},
  {code: "E03", name: "npm", ok: Boolean(npm), detail: npm || "확인 안 됨"},
  {
    code: "E04",
    name: "프로그램 설치 (1주차)",
    // 1주차 프로그램은 외부 의존성이 0개(내장 실행)라 node_modules 가 없는 것이 정상이다
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
    name: "영상 프로그램 설치 (2주차)",
    ok: existsSync(join(remotionUiDir, "node_modules")),
    detail: existsSync(join(remotionUiDir, "node_modules")) ? "설치됨" : "설치 안 됨 — Codespaces 재빌드(Rebuild Container)가 필요할 수 있어요",
  },
  {
    code: "E06",
    name: "작업 폴더",
    ok: existsSync(join(projectRoot, "01_1주차_애드센스승인")) && existsSync(join(projectRoot, "02_2주차_쇼핑숏폼자동화")),
    detail:
      existsSync(join(projectRoot, "01_1주차_애드센스승인")) && existsSync(join(projectRoot, "02_2주차_쇼핑숏폼자동화"))
        ? "1·2주차 폴더 준비됨"
        : "폴더가 없어요 — 저장소가 템플릿에서 제대로 복제됐는지 확인 필요",
  },
  {
    code: "E07",
    name: "디스크 사용량",
    ok: !disk || parseInt(disk.percent, 10) < 90,
    detail: disk ? `${disk.usedGb}GB / ${disk.totalGb}GB 사용 (${disk.percent})${parseInt(disk.percent, 10) >= 90 ? " — 터미널에 '정리' 를 입력해 공간을 확보하세요" : ""}` : "확인 안 됨 (치명적이지 않음)",
  },
  {
    code: "E08",
    name: "키 입력 상태 (.env.local)",
    ok: envReady,
    later: !envReady,
    detail: envReady ? (existsSync(ENV_LOCAL_PATH) ? "있음" : "Codespaces Secrets 사용 중") : "아직 없음 — 온보딩 5단계에서 터미널에 '키설정' 을 입력하면 만들어져요",
  },
];

// ── 온보딩 기본 모드: 환경만 점검하고 끝 ────────────────────────────────────
if (week === 0) {
  printChecks("월부 중급반 키트 환경 점검 (기본 모드)", baseChecks);
  console.log("작업별 세부 점검: 1주차는 '진단 --week=1', 2주차는 '진단 --week=2'");
  // 키 미입력([나중에 입력])은 실패가 아니다 — 환경 항목만 하드 실패로 본다
  const hardFails = baseChecks.filter((check) => ["E02", "E03", "E04", "E06"].includes(check.code) && !check.ok);
  if (hardFails.length > 0) process.exitCode = 1;
  process.exit();
}

// ── 2주차 작업 모드 ─────────────────────────────────────────────────────────
if (week === 2) {
  const week2Root = join(projectRoot, "02_2주차_쇼핑숏폼자동화");
  const videoInputDir = join(week2Root, "영상넣는곳");
  const outputDir = join(week2Root, "완성영상");
  const remotionCli = join(remotionUiDir, "node_modules", "@remotion", "cli", "remotion-cli.js");
  const shellOk = headlessShellInstalled(remotionUiDir);
  const hubWordPressReady = siteReady(env, "HUB_WORDPRESS");

  const checks = [
    ...baseChecks,
    {code: "W21", name: "영상넣는곳 폴더", ok: existsSync(videoInputDir), detail: existsSync(videoInputDir) ? "준비됨" : "없음"},
    {code: "W22", name: "완성영상 폴더", ok: existsSync(outputDir), detail: existsSync(outputDir) ? "준비됨" : "없음"},
    {code: "W23", name: "영상 편집기", ok: existsSync(remotionCli), detail: existsSync(remotionCli) ? "설치됨" : "설치 필요 — Codespaces 재빌드(Rebuild Container)를 해주세요"},
    {
      code: "W24",
      name: "영상 제작용 브라우저 (Headless Shell)",
      ok: shellOk,
      detail: shellOk
        ? "준비됨"
        : "아직 설치 안 됨 — '영상만들기' 실행 시 자동 설치를 시도해요. 계속 실패하면 이 출력을 복사해 문의 채널에 올려주세요",
    },
    {
      code: "W25",
      name: "OpenAI API 키",
      ok: openAiReady,
      later: !openAiReady,
      detail: openAiReady ? "입력됨" : "터미널에 '키설정' 을 입력해주세요",
    },
    {
      code: "W26",
      name: "ElevenLabs API 키",
      ok: elevenLabsReady,
      later: !elevenLabsReady,
      detail: elevenLabsReady ? "입력됨" : "터미널에 '키설정' 을 입력해주세요",
    },
    {
      code: "W27",
      name: "쇼핑숏폼 워드프레스 연결 정보",
      ok: hubWordPressReady,
      later: !hubWordPressReady,
      detail: hubWordPressReady ? "입력됨" : "터미널에 '키설정' 을 입력해주세요 (선택 항목)",
    },
  ];

  printChecks("월부 중급반 2주차 메킷허브 쇼핑숏폼 환경 점검", checks);

  const hardFails = checks.filter((check) => ["E02", "E03", "W21", "W22", "W23"].includes(check.code) && !check.ok);
  if (hardFails.length > 0) process.exitCode = 1;
  process.exit();
}

// ── 1주차 작업 모드 ─────────────────────────────────────────────────────────
const adsenseReadyCount = ["ADSENSE_SITE_01", "ADSENSE_SITE_02", "ADSENSE_SITE_03"].filter((prefix) => siteReady(env, prefix)).length;
const titleCandidates = [1, 2, 3].map((n) => listTitleFileCandidates(projectRoot, n));
const titlesReady = titleCandidates.some((candidates) => candidates.some((candidate) => candidate.titleCount > 0));

const checks = [
  ...baseChecks,
  {
    code: "W11",
    name: "OpenAI API 키",
    ok: openAiReady,
    later: !openAiReady,
    detail: openAiReady ? "입력됨" : "터미널에 '키설정' 을 입력해주세요",
  },
  {
    code: "W12",
    name: "애드센스 사이트 연결 정보",
    ok: adsenseReadyCount > 0,
    later: adsenseReadyCount === 0,
    detail: `${adsenseReadyCount}/3개 준비됨${adsenseReadyCount === 0 ? " — 터미널에 '키설정' 을 입력해주세요" : ""}`,
  },
  {
    code: "W13",
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

printChecks("월부 중급반 1주차 애드센스 프로젝트 환경 점검", checks);

const hardFails = checks.filter((check) => ["E02", "E03", "E04"].includes(check.code) && !check.ok);
if (hardFails.length > 0) process.exitCode = 1;
