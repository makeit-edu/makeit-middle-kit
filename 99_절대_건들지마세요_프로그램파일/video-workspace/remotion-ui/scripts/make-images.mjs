// 영상에 들어갈 이미지를 만드는 스크립트 (한글 명령 '이미지만들기' 가 실행)
//
// 하는 일:
//   1. 기획안 txt에서 고른 후보의 [04 이미지 만들기용] 블록을 붙여넣으면
//   2. OpenAI 이미지 모델로 세로형(1024x1536) 이미지를 생성해서
//   3. 현재 작업의 영상에 자동으로 연결한다 (타이밍은 편집기에서 조절 가능)
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import {ensureNodeModules, looksMojibake, programRoot, projectRootFromScript, readTextSmart, resolveJobPaths, studentRoot} from "./job-config.mjs";
import {requireLicense} from "../../../scripts/lib/env.mjs";

// 진입 게이트: 수강 코드(MAKEIT_MIDDLE_LICENSE) 검증 (PRD D9 — 2주차 실사용 진입 스크립트 공통)
requireLicense({scriptLabel: "이미지 만들기"});

const projectRoot = projectRootFromScript(import.meta.url);
ensureNodeModules(projectRoot);

const IMAGE_MODEL = "gpt-image-1.5";
const IMAGE_SIZE = "1024x1536";
const IMAGE_QUALITY = "medium"; // 장당 약 90원. 더 높은 화질이 필요하면 "high" (약 350원)
const STYLE_SUFFIX =
  "세로형 쇼핑 숏폼에 삽입할 장면. 실사 사진 스타일, 자연스러운 조명, 클릭을 멈추게 만드는 후기형 구도, 글자나 워터마크 없이.";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

const jobPaths = resolveJobPaths(projectRoot);
const propsPath = jobPaths.defaultPropsPath;
const timelinePath = path.join(jobPaths.timelineDir, "timeline.json");

if (!existsSync(propsPath)) {
  console.error("");
  console.error("[안내] 아직 상품 작업이 없습니다. 먼저 터미널에 '새상품 1' 처럼 상품번호와 함께 입력해 작업을 만들어주세요.");
  process.exit(1);
}

const env = {
  ...parseEnvFile(path.join(studentRoot(projectRoot), ".env.local")),
  ...parseEnvFile(path.join(programRoot(projectRoot), ".env.local")),
};
const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
if (!apiKey || apiKey.includes("your-")) {
  console.error("");
  console.error("[안내] OpenAI API 키가 아직 입력되지 않았습니다.");
  console.error("터미널에 '키설정' 을 입력해 OpenAI API 키를 넣은 뒤, '이미지만들기' 를 다시 실행해주세요.");
  process.exit(1);
}

async function generateImage(prompt, outputPath) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: `${prompt}\n\n${STYLE_SUFFIX}`,
      size: IMAGE_SIZE,
      quality: IMAGE_QUALITY,
      output_format: "png",
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new Error("OpenAI 키가 올바르지 않습니다. .env.local의 OPENAI_API_KEY를 확인해주세요.");
    }
    throw new Error(`이미지 생성 실패 (${response.status}): ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  const item = data.data?.[0];
  if (item?.b64_json) {
    writeFileSync(outputPath, Buffer.from(item.b64_json, "base64"));
    return;
  }
  if (item?.url) {
    const image = await fetch(item.url);
    writeFileSync(outputPath, Buffer.from(await image.arrayBuffer()));
    return;
  }
  throw new Error("이미지 응답이 비어 있습니다. 잠시 후 다시 시도해주세요.");
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "계산 중";
  const total = Math.ceil(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes <= 0) return `${rest}초`;
  return `${minutes}분 ${rest}초`;
}

function progressBar(percent) {
  const width = 24;
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((safe / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function renderProgress(percent, message, startedAt) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const remainingSec = safe > 1 && safe < 100 ? (elapsedSec * (100 - safe)) / safe : 0;
  const percentText = `${Math.round(safe)}`.padStart(3, " ");
  const remainingText = safe >= 100 ? "0초" : formatSeconds(remainingSec);
  process.stdout.write(
    `\r${progressBar(safe)} ${percentText}% | ${message} | 경과 ${formatSeconds(elapsedSec)} | 남은 예상 ${remainingText}   `,
  );
}

async function withEstimatedProgress({startPercent, endPercent, message, estimateSec, startedAt}, task) {
  const stepStartedAt = Date.now();
  const safeStart = Math.max(0, Math.min(100, startPercent));
  const safeEnd = Math.max(safeStart, Math.min(100, endPercent));
  const tick = () => {
    const elapsed = (Date.now() - stepStartedAt) / 1000;
    const ratio = Math.min(0.94, elapsed / Math.max(estimateSec, 1));
    const current = Math.min(safeEnd - 0.5, safeStart + (safeEnd - safeStart) * ratio);
    renderProgress(current, message, startedAt);
  };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const result = await task();
    clearInterval(timer);
    renderProgress(safeEnd, `${message} 완료`, startedAt);
    process.stdout.write("\n");
    return result;
  } catch (error) {
    clearInterval(timer);
    process.stdout.write("\n");
    throw error;
  }
}

function readPastedText(rl) {
  return new Promise((resolve) => {
    const collected = [];
    let timer = null;
    // 입력 스트림이 닫혀도(파이프/Ctrl+Z 등) 멈추지 않고 지금까지 모은 내용으로 진행한다
    const finish = () => {
      if (timer) clearTimeout(timer);
      rl.off("line", onLine);
      rl.off("close", finish);
      resolve(collected.join("\n"));
    };
    const onLine = (line) => {
      collected.push(line);
      if (timer) clearTimeout(timer);
      // Windows terminals can stream a large pasted block slowly. Wait long
      // enough after the last line so the parser does not ask for the
      // thumbnail while the rest of the paste is still arriving.
      timer = setTimeout(finish, 2200);
    };
    rl.on("line", onLine);
    rl.on("close", finish);
  });
}

function labelKey(label) {
  const normalized = String(label || "")
    .replace(/^[\s#\-\*\d.)\[\]]+/, "")
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (normalized.includes("이미지1")) return "image1";
  if (normalized.includes("이미지2")) return "image2";
  if (normalized.includes("이미지3")) return "image3";
  if (normalized.includes("썸네일배경")) return "thumbnail";
  return "";
}

function isStopLabel(label) {
  const normalized = String(label || "")
    .replace(/^[\s#\-\*\d.)\[\]]+/, "")
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return [
    "썸네일문구",
    "후킹",
    "대본",
    "자막",
    "TTS",
    "CTA",
    "광고표시",
    "가상인물표시필요",
    "가상인물판단이유",
    "이후보를고르면좋은상황",
    "주의",
  ].some((labelName) => normalized.includes(labelName));
}

function parseImagePromptBlock(text) {
  const source = text;
  const fields = {};
  let current = "";
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      current = "";
      continue;
    }
    const match = /^([^:：]{1,32})[:：]\s*(.*)$/.exec(line);
    if (match) {
      const label = match[1].trim();
      const key = labelKey(label);
      if (key) {
        current = key;
        fields[current] = [match[2].trim()].filter(Boolean);
        continue;
      }
      if (isStopLabel(label)) {
        current = "";
        continue;
      }
      if (current) {
        fields[current].push(line);
        continue;
      }
      continue;
    }
    if (current) fields[current].push(line);
  }

  const images = [fields.image1, fields.image2, fields.image3]
    .filter(Boolean)
    .map((parts) => parts.join(" ").trim())
    .filter(Boolean);
  const thumbnail = fields.thumbnail ? fields.thumbnail.join(" ").trim() : "";
  return {images, thumbnail};
}

function extractThumbnailFromRetry(text) {
  const parsed = parseImagePromptBlock(text);
  if (parsed.thumbnail) return parsed.thumbnail;
  const direct = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^썸네일\s*배경\s*프롬프트/i.test(line));
  return direct.join(" ").trim();
}

// ---- 기획안 자동 인식 헬퍼 (make-video와 동일 규칙, 실패하면 붙여넣기로 폴백) ----
function checkPlanningEncoding(text) {
  if (looksMojibake(text)) {
    console.log("");
    console.log("[주의] 기획안 txt의 한글이 깨져 있습니다 (저장 인코딩 문제).");
    console.log("코덱스에 아래 한 줄을 입력해 기획안을 다시 만들어 주세요:");
    console.log("  Re-save the plan txt as UTF-8 without BOM using [System.IO.File]::WriteAllText, then verify Korean labels are readable.");
    console.log("");
  }
  return text;
}

function loadPlanningText() {
  try {
    const sc = JSON.parse(readFileSync(path.join(jobPaths.jobRoot, "source-clips.json"), "utf8"));
    const direct = sc.mustSavePlanningFileHere || sc.planningFilePath;
    if (direct && existsSync(direct)) return checkPlanningEncoding(readTextSmart(direct));
    // 제품폴더 바로 아래(inputDir)와 '대본 및 이미지'(planningDir) 둘 다 찾는다 — 코덱스가 어느 쪽에 저장해도 인식.
    for (const dir of [sc.planningDir, sc.inputDir]) {
      if (!dir || !existsSync(dir)) continue;
      const hit = readdirSync(dir).find((n) => /(기획|계획)안\.txt$/.test(n.normalize("NFC")));
      if (hit) return checkPlanningEncoding(readTextSmart(path.join(dir, hit)));
    }
  } catch {
    // 못 읽으면 붙여넣기로 간다.
  }
  return null;
}
function splitPlanCandidates(planText) {
  const re = /\[(?:후보|추천안)\s*([123])\s*[:：]?\s*([^\]]*)\]/g;
  const marks = [];
  let m;
  while ((m = re.exec(planText))) marks.push({num: m[1], label: (m[2] || "").trim(), idx: m.index});
  return marks
    .map((mk, i) => ({num: mk.num, label: mk.label, body: planText.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : undefined)}))
    .filter((c) => c.body.includes("[05 영상 만들기용]") || c.body.includes("[04 이미지 만들기용]"));
}
function extractImageBlockFromCandidate(body) {
  const s = body.indexOf("[04 이미지 만들기용]");
  const e = body.indexOf("[05 영상 만들기용]");
  if (s < 0) return body;
  return body.slice(s, e > s ? e : undefined);
}

// ---- 입력 받기 ----
const rl = readline.createInterface({input: process.stdin, output: process.stdout});

console.log("");
console.log("==================================================");
console.log(` 영상 이미지 만들기 — 현재 작업: ${jobPaths.jobId}`);
console.log("==================================================");

let pasted = null;
let autoImageCount = null; // null이면 붙여넣기 모드(파싱된 개수 그대로 사용)
let makeThumbnail = true;
const planText = loadPlanningText();
const candidates = planText ? splitPlanCandidates(planText) : [];
if (candidates.length > 0) {
  console.log("기획안을 찾았어요. 어떤 유형의 이미지를 만들까요?");
  candidates.forEach((c) => console.log(`  ${c.num}. ${c.label || `후보 ${c.num}`}`));
  console.log("  4. 기획안 직접 붙여넣기 (찾은 기획안을 그대로 쓰지 않을 때)");
  console.log("");
  let pick = null;
  let manualPaste = false;
  try {
    const ans = (await rl.question("유형 번호 (1/2/3/4, 엔터=1번): ")).trim();
    if (ans === "4") {
      manualPaste = true;
    } else {
      pick = candidates.find((c) => c.num === ans) || candidates[0];
      const cnt = (await rl.question("장면 이미지를 몇 장 만들까요? (0~3, 엔터=3장): ")).trim();
      autoImageCount = /^[0-3]$/.test(cnt) ? Number(cnt) : 3;
      const th = (await rl.question("썸네일 배경도 만들까요? (y/n, 엔터=y): ")).trim().toLowerCase();
      makeThumbnail = !(th === "n" || th === "no");
    }
  } catch {
    if (!manualPaste) {
      pick = pick || candidates[0];
      autoImageCount = autoImageCount ?? 3;
    }
  }
  if (manualPaste) {
    console.log("\n직접 붙여넣기 모드로 진행합니다.\n");
  } else if (pick) {
    pasted = extractImageBlockFromCandidate(pick.body);
    console.log(`\n[${pick.label || `후보 ${pick.num}`}] 이미지 ${autoImageCount}장${makeThumbnail ? " + 썸네일" : ""} 만듭니다.\n`);
  }
}
if (pasted === null) {
  console.log("기획안 txt에서 선택한 후보의 [04 이미지 만들기용] 블록을 그대로 붙여넣어 주세요.");
  console.log("프로그램은 이미지1, 이미지2, 이미지3, 썸네일 배경 프롬프트를 자동으로 인식합니다.");
  console.log("이미지1~3은 있는 것만 만들고, 썸네일은 반드시 만듭니다.");
  console.log("(붙여넣고 2~3초만 기다리면 자동으로 인식합니다.)");
  console.log("");
  pasted = await readPastedText(rl);
}

let {images: sceneDescriptions, thumbnail: tailDescription} = parseImagePromptBlock(pasted);

if (sceneDescriptions.length === 0 && !tailDescription) {
  const directLines = pasted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  sceneDescriptions = directLines.slice(0, 3);
  tailDescription = directLines[3] || "";
}

// 자동 모드에서 고른 장면 개수 / 썸네일 여부 반영
if (autoImageCount !== null) sceneDescriptions = sceneDescriptions.slice(0, autoImageCount);
if (!makeThumbnail) tailDescription = "";

// 붙여넣기 모드에서 썸네일 프롬프트가 안 잡히면 한 번 더 받는다.
if (autoImageCount === null && makeThumbnail && !tailDescription) {
  console.log("");
  console.log("썸네일 배경 프롬프트가 아직 인식되지 않았습니다.");
  console.log("썸네일 배경 프롬프트만 다시 붙여넣어 주세요.");
  const retryText = await readPastedText(rl);
  tailDescription = extractThumbnailFromRetry(retryText);
}
rl.close();

if (sceneDescriptions.length === 0 && !tailDescription) {
  console.log("");
  console.log("[안내] 만들 이미지나 썸네일 프롬프트를 찾지 못했습니다.");
  console.log("기획안 txt에서 선택한 후보의 [04 이미지 만들기용] 블록을 그대로 복사해 다시 시도해주세요.");
  process.exit(0);
}

const totalCount = sceneDescriptions.length + (tailDescription ? 1 : 0);
console.log("");
console.log(`이미지 ${totalCount}장을 만듭니다. (장당 약 90원, 30초~1분씩 걸립니다)`);
console.log(`  - 장면 이미지: ${sceneDescriptions.length}장`);
console.log("  - 썸네일 배경: 1장");
console.log("진행률 게이지가 표시됩니다. 100%가 될 때까지 창을 닫지 마세요.");

// ---- 생성 ----
mkdirSync(jobPaths.publicJobRoot, {recursive: true});
const madeScenes = [];
const progressStartedAt = Date.now();
for (const [index, description] of sceneDescriptions.entries()) {
  const fileName = `story_${String(index + 1).padStart(2, "0")}.png`;
  await withEstimatedProgress(
    {
      startPercent: (index / totalCount) * 100,
      endPercent: ((index + 1) / totalCount) * 100,
      message: `${index + 1}/${totalCount} 장면 이미지 만드는 중`,
      estimateSec: 55,
      startedAt: progressStartedAt,
    },
    () => generateImage(description, path.join(jobPaths.publicJobRoot, fileName)),
  );
  madeScenes.push(fileName);
}
let madeTail = null;
if (tailDescription) {
  await withEstimatedProgress(
    {
      startPercent: (sceneDescriptions.length / totalCount) * 100,
      endPercent: 100,
      message: `${totalCount}/${totalCount} 썸네일 배경 만드는 중`,
      estimateSec: 55,
      startedAt: progressStartedAt,
    },
    () => generateImage(tailDescription, path.join(jobPaths.publicJobRoot, "thumbnail_tail.png")),
  );
  madeTail = "thumbnail_tail.png";
}

// ---- 작업 정보에 연결 (props + 편집 중인 타임라인 둘 다) ----
function applyImages(data) {
  const durationSec = Math.max(Number(data.durationSec || 24), 6);
  const overlays = [];
  for (const [index, fileName] of madeScenes.entries()) {
    let startSec;
    let endSec;
    if (index === 0) {
      // 첫 이미지는 후킹 구간(첫 3초)을 덮는다
      startSec = 0;
      endSec = Math.min(3, durationSec - 1);
    } else {
      // 나머지는 영상 중반에 2.5초씩 균등 배치
      const slot = (durationSec - 4) / madeScenes.length;
      startSec = Number((3 + slot * (index - 0.5)).toFixed(2));
      endSec = Number(Math.min(startSec + 2.5, durationSec - 0.5).toFixed(2));
    }
    overlays.push({
      imageId: `story-${index + 1}`,
      startSec,
      endSec,
      fit: "cover",
      transition: "soft-fade",
      src: `jobs/${jobPaths.jobId}/${fileName}`,
    });
  }
  const next = {...data};
  if (overlays.length > 0) next.imageOverlays = overlays;
  if (madeTail) {
    next.thumbnailTail = {...(data.thumbnailTail || {durationSec: 0.6}), src: `jobs/${jobPaths.jobId}/${madeTail}`};
  }
  return next;
}

const props = JSON.parse(readFileSync(propsPath, "utf8"));
writeFileSync(propsPath, JSON.stringify(applyImages(props), null, 2), "utf8");
if (existsSync(timelinePath)) {
  const timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
  writeFileSync(timelinePath, JSON.stringify(applyImages(timeline), null, 2), "utf8");
}

console.log("");
console.log("완료!");
