import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {readTitleEntries, resolveTitleFile} from "./title-files.mjs";
import {keysGuideMessage, requireLicense} from "./lib/env.mjs";

const programRoot = resolve(process.cwd());
const projectRoot = String(process.env.MAKEIT_PROJECT_ROOT || "").trim() || resolve(programRoot, "..");

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

function ready(value, placeholders = []) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(your-|example|xxxx|sk-your|https:\/\/example)/i.test(text)) return false;
  return !placeholders.some((placeholder) => text.includes(placeholder));
}

function sitePrefix(siteNumber) {
  return `ADSENSE_SITE_${String(siteNumber).padStart(2, "0")}`;
}
import {siteNumbers} from "./lib/sites.mjs";
import {예산상태, 천단위, 퍼센트문구} from "./lib/usage.mjs";

function siteEnvReady(env, siteNumber) {
  const prefix = sitePrefix(siteNumber);
  return (
    ready(env[`${prefix}_URL`], ["example"]) &&
    ready(env[`${prefix}_USER`], ["your-admin"]) &&
    ready(env[`${prefix}_APP_PASSWORD`], ["xxxx"])
  );
}

function siteTitleInfo(siteNumber) {
  try {
    const filePath = resolveTitleFile(projectRoot, siteNumber);
    const parsed = readTitleEntries(filePath);
    return {
      ok: true,
      siteNumber,
      filePath,
      titleCount: parsed.entries.length,
      categoryCount: parsed.categories.length,
      childCategoryCount: parsed.categories.reduce((sum, category) => sum + category.children.length, 0),
    };
  } catch (error) {
    return {
      ok: false,
      siteNumber,
      filePath: "",
      titleCount: 0,
      categoryCount: 0,
      childCategoryCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// 라이센스 게이트(수강 코드 확인) 통과 후, process.env 우선 + .env.local 보조로 설정을 읽는다 (PRD D8·D9)
const env = requireLicense({scriptLabel: "애드센스 승인글 자동 발행"});
const explicitSite = Number(argValue("site", "0"));
const limit = Number(argValue("limit", "0"));
const dryRun = ["1", "true", "yes"].includes(argValue("dry-run", "0").toLowerCase());
const includeUsed = ["1", "true", "yes"].includes(argValue("include-used", "0").toLowerCase());
const dateMode = argValue("date-mode", "");
const startDate = argValue("start-date", "");
// 날짜 관련 옵션은 여기서 받아 그대로 자식 스크립트에 넘긴다.
// 넘기지 않으면 "이틀에 하나씩" 같은 요청이 조용히 무시된다(실측으로 확인).
const dateStep = argValue("date-step", "");
const fixedTime = argValue("fixed-time", "");
const randomDays = argValue("random-days", "");
const hourGap = argValue("hour-gap", "");

if (!dryRun && !ready(env.OPENAI_API_KEY, ["sk-your"])) {
  console.error(keysGuideMessage("OpenAI API 키"));
  process.exit(1);
}

const siteInfos = siteNumbers().map((siteNumber) => ({
  ...siteTitleInfo(siteNumber),
  envReady: siteEnvReady(env, siteNumber),
}));

console.log("제목 파일 자동 매핑 확인");
for (const info of siteInfos) {
  const envLabel = dryRun ? "dry-run" : info.envReady ? "연결정보 있음" : "연결정보 없음";
  const titleLabel = info.ok ? `제목 ${info.titleCount}개` : "제목 파일 확인 실패";
  console.log(`- 사이트${info.siteNumber}: ${titleLabel} / ${envLabel}${info.filePath ? ` / ${info.filePath}` : ""}`);
}

const targetSites = explicitSite > 0
  ? siteInfos.filter((info) => info.siteNumber === explicitSite)
  : siteInfos.filter((info) => info.ok && info.titleCount > 0 && (dryRun || info.envReady));

if (targetSites.length === 0) {
  const needs = siteInfos
    .filter((info) => info.ok && info.titleCount > 0 && !info.envReady)
    .map((info) => `사이트${info.siteNumber}`);
  if (needs.length > 0 && !dryRun) {
    console.error(`${needs.join(", ")} 제목 파일은 있지만 워드프레스 연결정보가 부족합니다.`);
    console.error(keysGuideMessage("해당 사이트의 워드프레스 연결 정보(도메인·관리자 아이디·애플리케이션 비밀번호)"));
  } else {
    console.error("실행할 사이트를 찾지 못함. 사이트별 제목 파일과 연결정보를 확인해야 함. (사이트1~10)");
  }
  process.exit(1);
}

for (const info of targetSites) {
  if (!info.ok) {
    console.error(`사이트${info.siteNumber} 제목 파일 오류: ${info.error}`);
    process.exit(1);
  }
  if (!dryRun && !info.envReady) {
    console.error(`사이트${info.siteNumber} 워드프레스 연결정보가 부족함. ADSENSE_SITE_${String(info.siteNumber).padStart(2, "0")}_URL/USER/APP_PASSWORD를 먼저 저장해야 함.`);
    process.exit(1);
  }
}

console.log(`실행 대상: ${targetSites.map((info) => `사이트${info.siteNumber}`).join(", ")}`);

const 실패한사이트 = [];

for (const info of targetSites) {
  const args = ["scripts/adsense-create-drafts.mjs", `--site=${info.siteNumber}`, `--titles=${info.filePath}`];
  if (limit > 0) args.push(`--limit=${limit}`);
  if (dryRun) args.push("--dry-run=1");
  if (includeUsed) args.push("--include-used=1");
  if (dateMode) args.push(`--date-mode=${dateMode}`);
  if (startDate) args.push(`--start-date=${startDate}`);
  if (dateStep) args.push(`--date-step=${dateStep}`);
  if (fixedTime) args.push(`--fixed-time=${fixedTime}`);
  if (randomDays) args.push(`--random-days=${randomDays}`);
  if (hourGap) args.push(`--hour-gap=${hourGap}`);

  console.log("=".repeat(44));
  console.log(`사이트${info.siteNumber} 실행 시작`);
  const result = spawnSync(process.execPath, args, {
    cwd: programRoot,
    stdio: "inherit",
  });

  // 한 사이트가 실패해도 나머지 사이트는 계속 돌린다.
  //
  // 예전에는 여기서 곧바로 멈춰서, 사이트1 에 문제가 하나만 있어도
  // 사이트2~10 은 아예 실행되지 않고 조용히 끝났다. 수강생은 왜 안 됐는지 모른다.
  if (result.status !== 0) {
    실패한사이트.push(info.siteNumber);
    console.log(`사이트${info.siteNumber} 는 끝까지 마치지 못했어요. 다음 사이트로 넘어갑니다.`);
  }
}

console.log("=".repeat(44));
if (실패한사이트.length > 0) {
  console.log(`끝까지 마치지 못한 사이트: ${실패한사이트.map((n) => `${n}번`).join(", ")}`);
  console.log("위 화면을 위로 올려 그 사이트의 메시지를 확인해 주세요. 다시 실행하면 이어서 만듭니다.");
  process.exitCode = 1;
} else {
  console.log("사이트별 제목 파일 자동 매핑 실행 완료");
}
// 사이트가 여러 개면 돈은 마지막에 한 번 더 합쳐서 보여 준다.
if (!dryRun && targetSites.length > 1) {
  try {
    const 예산 = 예산상태({env});
    console.log(`💰 전체 누적 ${예산.전체.글수}개 · 약 ${천단위(예산.전체.krw)}원` + (예산.있음 ? ` · 남은 돈 약 ${천단위(예산.남은krw)}원 (${퍼센트문구(예산.남은퍼센트)} 남음)` : " · 남은 돈은 '키설정'에서 충전 금액을 넣으면 보여 드려요"));
  } catch {
    // 요약은 덤
  }
}
