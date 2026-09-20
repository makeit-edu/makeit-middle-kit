#!/usr/bin/env node

// 진단 (npm run doctor) — 키트 상태 점검
// 이 키트는 애드센스 승인글 하나만 다루므로 모드 구분 없이 한 번에 전부 점검한다.
// 표시 규칙:
//   [OK] 정상 / [나중에 입력] 키설정 전이라 아직 없는 값(실패 아님) / [확인 필요] 조치가 필요한 항목
//   각 항목에는 에러코드 태그(E01~)가 붙는다 — 코치가 어떤 항목인지 빠르게 특정하는 용도.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {listTitleFileCandidates} from "./title-files.mjs";
import {MAX_SITES, siteNumbers, sitePrefix} from "./lib/sites.mjs";
import {PROGRAM_ROOT, PROJECT_ROOT, ENV_LOCAL_PATH, hasEnvLocal, loadEnv, valueReady} from "./lib/env.mjs";
import {예산상태, 천단위, 퍼센트문구} from "./lib/usage.mjs";

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
    console.log("[확인 필요] 항목이 있으면 이 출력 전체를 복사해 코덱스에게 붙여넣고 물어보세요.");
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

// 코덱스가 지금 어떤 모델로 돌고 있는지 — 값은 .devcontainer/setup.sh 가 작업방을 만들 때 넣는다.
// 수강생 전원이 같은 모델·같은 추론 강도로 돌아야 코치가 화면만 보고 지원할 수 있다.
// 이 값이 다르면 그 사람만 다른 속도·다른 한도로 돌고 있다는 뜻이라 반드시 드러나야 한다.
const CODEX_MODEL = "gpt-5.6-luna";
const CODEX_EFFORT = "low";
const codexConfigPath = join(process.env.CODEX_HOME || join(projectRoot, ".codex"), "config.toml");

function codexSetting(key) {
  try {
    const found = readFileSync(codexConfigPath, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
    return found ? found[1] : "";
  } catch {
    return "";
  }
}

const codexModel = codexSetting("model");
const codexEffort = codexSetting("model_reasoning_effort");
const codexConfigExists = existsSync(codexConfigPath);

const adsenseReadyCount = siteNumbers().filter((n) => siteReady(env, sitePrefix(n))).length;
const titleCandidates = siteNumbers().map((n) => listTitleFileCandidates(projectRoot, n));
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
          ? " — 무료 사용량(월 15GB)에 가까워졌어요. 이 출력을 복사해 코덱스에게 물어보세요"
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
    code: "E08",
    name: "코덱스 모델",
    ok: codexModel === CODEX_MODEL && codexEffort === CODEX_EFFORT,
    later: !codexConfigExists,
    detail: !codexConfigExists
      ? "아직 없음 — 작업방을 처음 만들 때 자동으로 설정돼요"
      : `${codexModel || "지정 없음"} / ${codexEffort || "지정 없음"}` +
        (codexModel === CODEX_MODEL && codexEffort === CODEX_EFFORT
          ? ""
          : ` — 정해진 값은 ${CODEX_MODEL} / ${CODEX_EFFORT} 입니다. 터미널에 '업데이트' 를 입력한 뒤 작업방을 다시 만들면(Rebuild Container) 되돌아와요`),
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
    detail: `${adsenseReadyCount}개 준비됨 (최대 ${MAX_SITES}개)${adsenseReadyCount === 0 ? " — 터미널에 '키설정' 을 입력해주세요" : ""}`,
  },
  {
    code: "W03",
    name: "사이트별 제목 파일",
    ok: titlesReady,
    later: !titlesReady,
    // 사이트가 최대 10개라 전부 쓰면 한 줄이 너무 길어진다 — 채워진 것만 알려준다.
    detail: (() => {
      const filled = titleCandidates
        .map((candidates, index) => ({n: index + 1, best: candidates.find((candidate) => candidate.titleCount > 0)}))
        .filter((entry) => entry.best);
      if (filled.length === 0) return "아직 없음 — '애드센스 승인글/01_제목넣는곳'의 사이트1제목.txt 부터 채우세요";
      return filled.map((entry) => `사이트${entry.n} ${entry.best.titleCount}개`).join(" / ");
    })(),
  },
];

printChecks("월부 중급반 키트 환경 점검", checks);

// ── 지금까지 얼마나 했는지 ────────────────────────────────
//
// 이게 없으면 AI 비서가 매번 "처음"이라고 짐작하고, 어제 200개를 만들었어도
// 오늘 다시 "테스트로 1개 발행해볼까요?" 부터 묻는다.
// 기록은 우리 파일만 본다. 워드프레스를 부르면 켤 때마다 네트워크에 매달리고,
// 이미 글이 있는 블로그를 '이어하기'로 잘못 볼 수도 있다.
function 사이트별진행() {
  const 결과 = [];
  for (const n of siteNumbers()) {
    const dir = join(PROGRAM_ROOT, "makeit-adsense", "outputs", `site-${String(n).padStart(2, "0")}`);
    const file = join(dir, "draft-history.json");
    let 만든수 = 0;
    if (existsSync(file)) {
      try {
        const rows = JSON.parse(readFileSync(file, "utf8"));
        if (Array.isArray(rows)) 만든수 = rows.filter((row) => row && row.title).length;
      } catch {
        만든수 = 0;
      }
    }
    const 제목수 = (titleCandidates[n - 1] || []).reduce((max, c) => Math.max(max, c.titleCount || 0), 0);
    if (만든수 > 0 || 제목수 > 0) 결과.push({site: n, 만든수, 제목수});
  }
  return 결과;
}

const 진행 = 사이트별진행();
const 총만든수 = 진행.reduce((sum, row) => sum + row.만든수, 0);

console.log("");
console.log("지금까지 만든 글");
console.log("=".repeat(44));
if (진행.length === 0) {
  console.log("아직 만든 글이 없어요. 제목도 아직 없습니다.");
} else {
  for (const row of 진행) {
    const 남은수 = Math.max(row.제목수 - row.만든수, 0);
    console.log(`사이트${row.site}: 만든 글 ${row.만든수}개 / 제목 ${row.제목수}개 (남은 제목 ${남은수}개)`);
  }
}
console.log("=".repeat(44));

// 돈 — 글마다 찍는 것과 같은 기준. 비서가 "지금까지 얼마 썼어요?" 에 여기 숫자로 답한다.
{
  let 예산 = null;
  try {
    예산 = 예산상태({env});
  } catch {
    예산 = null;
  }
  console.log("");
  console.log("OpenAI 쓴 돈");
  console.log("=".repeat(44));
  if (!예산) {
    console.log("사용량 기록을 읽지 못했어요.");
  } else if (예산.전체.글수 === 0) {
    console.log("아직 OpenAI 를 쓴 기록이 없어요.");
    console.log(예산.있음 ? `충전액 ${천단위(예산.예산krw)}원(${예산.예산usd}달러) 기준으로 셉니다.` : "'키설정'에서 충전한 금액을 넣으면 글마다 남은 돈을 보여 드려요.");
  } else {
    console.log(`전체 누적: 글 ${예산.전체.글수}개 · 토큰 ${천단위(예산.전체.total_tokens)}개 · 약 ${천단위(예산.전체.krw)}원`);
    if (예산.있음) {
      console.log(`충전액 ${천단위(예산.예산krw)}원(${예산.예산usd}달러) 중 ${천단위(예산.쓴krw)}원 씀 (${퍼센트문구(예산.쓴퍼센트)})`);
      console.log(`남은 돈: 약 ${천단위(예산.남은krw)}원 (${퍼센트문구(예산.남은퍼센트)} 남음)`);
    } else {
      console.log("남은 돈: '키설정'에서 충전한 금액을 넣으면 보여 드려요.");
    }
  }
  console.log("=".repeat(44));
}
// 비서가 이 한 줄을 보고 갈라 진행한다. 사람에게도 뜻이 통하는 문장이어야 한다.
console.log(총만든수 > 0 ? "상태: 이어하기 (이미 만든 글이 있어요)" : "상태: 처음 (아직 만든 글이 없어요)");

const hardFails = checks.filter((check) => ["E02", "E03", "E04", "E05"].includes(check.code) && !check.ok);
if (hardFails.length > 0) process.exitCode = 1;
