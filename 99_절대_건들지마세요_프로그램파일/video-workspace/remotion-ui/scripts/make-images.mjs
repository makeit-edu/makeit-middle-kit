// 영상에 들어갈 이미지를 만드는 스크립트 (한글 명령 '이미지만들기' 가 실행)
//
// 하는 일:
//   1. 기획안 txt에서 고른 후보의 [04 이미지 만들기용] 블록을 붙여넣으면
//   2. OpenAI 이미지 모델로 세로형(1024x1536) 이미지를 생성해서
//   3. 현재 작업의 영상에 자동으로 연결한다 (타이밍은 편집기에서 조절 가능)
//
// 추가 모드:
//   - '닮은이미지만들기'(--reference): 원본 영상에서 고해상 장면을 뽑아 참조로 첨부해
//     "내 상품과 닮은" 장면 이미지를 만든다. 실패하면 기존 텍스트 방식으로 자동 폴백.
//   - 기획안 [05] 블록에 '썸네일 번호: N' 이 있으면 '썸네일후보보기'로 뽑아둔
//     후보 프레임을 썸네일 배경으로 사용한다 (없으면 기존 AI 생성으로 폴백).
import {execFileSync} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {createPrompt} from "./lib/prompt.mjs";
import {ensureNodeModules, looksMojibake, programRoot, projectRootFromScript, readTextSmart, resolveJobPaths, studentRoot, windowsLocalPath} from "./job-config.mjs";
import {requireLicense} from "../../../scripts/lib/env.mjs";

// 진입 게이트: 수강 코드(MAKEIT_MIDDLE_LICENSE) 검증 (PRD D9 — 2주차 실사용 진입 스크립트 공통)
requireLicense({scriptLabel: "이미지 만들기"});

const projectRoot = projectRootFromScript(import.meta.url);
ensureNodeModules(projectRoot);

// '닮은이미지만들기' 래퍼가 --reference 플래그를 넘긴다. 플래그가 없으면(기존 '이미지만들기')
// 아래 참조 관련 코드는 한 줄도 실행되지 않아 현행과 완전히 동일하게 동작한다.
const REFERENCE_MODE = process.argv.includes("--reference");

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

// 응답 본문을 파일로 저장 (generations/edits 공통 — 기존 :82-93 로직 그대로)
async function saveImageResponse(response, outputPath) {
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

// referenceImages가 비어 있으면(기본) 기존 generations 경로 그대로 — 분기 자체가 없다.
// 참조가 있으면 images/edits에 원본 프레임을 첨부해 "내 상품과 닮은" 이미지를 만든다.
async function generateImage(prompt, outputPath, {referenceImages = []} = {}) {
  if (referenceImages.length > 0) {
    // Node 20 내장 FormData + Blob 사용 (의존성 추가 0개)
    const buildForm = (withFidelity) => {
      const form = new FormData();
      form.append("model", IMAGE_MODEL);
      form.append("prompt", `${prompt}\n\n${STYLE_SUFFIX}`);
      form.append("size", IMAGE_SIZE);
      form.append("quality", IMAGE_QUALITY);
      // 참조(상품 로고·라벨·디테일) 충실도 우선 파라미터 — 미지원 응답이면 아래에서 빼고 1회 재시도
      if (withFidelity) form.append("input_fidelity", "high");
      for (const refPath of referenceImages) {
        form.append("image[]", new Blob([readFileSync(refPath)], {type: "image/png"}), path.basename(refPath));
      }
      return form;
    };
    const postEdits = (withFidelity) =>
      fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {authorization: `Bearer ${apiKey}`},
        body: buildForm(withFidelity),
      });
    let response = await postEdits(true);
    if (response.status === 400) {
      const body = await response.text();
      if (/input_fidelity/i.test(body)) {
        // 이 계정/모델이 input_fidelity를 지원하지 않는 경우 — 파라미터 없이 재시도
        response = await postEdits(false);
      } else {
        throw new Error(`이미지 생성 실패 (400): ${body.slice(0, 200)}`);
      }
    }
    await saveImageResponse(response, outputPath);
    return;
  }
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
  await saveImageResponse(response, outputPath);
}

// ---- 원본 영상 프레임 추출 (닮은이미지만들기 전용) ----
// 주의: jobs/<jobId>/frames/의 640px 축소본은 쓰지 않는다 (저해상이라 참조 목적과 상충).
//       source.mp4에서 scale 필터 없이 고해상 그대로 다시 뽑는다 (기획서 항목 1·2 공통 원칙).
const remotionCli = windowsLocalPath(path.join(projectRoot, "node_modules", "@remotion", "cli", "remotion-cli.js"));

function runFfmpeg(args, options = {}) {
  execFileSync(process.execPath, [remotionCli, "ffmpeg", ...args], options);
}

function probeDurationSec(filePath) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [remotionCli, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]},
    );
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

// source.mp4에서 참조용 고해상 프레임 1~2장을 뽑아 경로 목록을 돌려준다. 실패하면 throw.
function extractReferenceFrames(sourceVideo) {
  const refDir = path.join(jobPaths.publicJobRoot, "ref-frames");
  rmSync(refDir, {recursive: true, force: true});
  mkdirSync(refDir, {recursive: true});
  const durationSec = probeDurationSec(sourceVideo);
  // 영상 길이를 3등분한 지점 2곳 (길이를 모르면 2·5초 고정)
  const times = durationSec > 0 ? [durationSec / 3, (durationSec * 2) / 3] : [2, 5];
  const made = [];
  times.forEach((t, i) => {
    const outPath = path.join(refDir, `ref_${String(i + 1).padStart(2, "0")}.png`);
    try {
      runFfmpeg(
        ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(1), "-i", sourceVideo, "-frames:v", "1", outPath, "-y"],
        {stdio: "ignore"},
      );
      if (existsSync(outPath)) made.push(outPath);
    } catch {
      // 한 장 실패해도 나머지는 계속
    }
  });
  if (made.length === 0) throw new Error("참조 프레임 추출 실패");
  return made;
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
    // ---- v1.1 신규 옵션 라벨 9종 (기획서 §2-2 — 전부 등록 필수) ----
    // 수강생이 [04] 블록에 잘못 넣어도 직전 이미지 프롬프트에 흡수(오염)되지 않도록 막는다.
    // 특히 '썸네일하단문구'는 기존 '썸네일문구' 키워드에 연속 부분문자열로 매칭되지 않아 별도 등록이 필수.
    "썸네일번호",
    "말속도",
    "음량고르게",
    "네이버링크표시",
    "광고표시문구",
    "썸네일하단문구",
    "영상모두쓰기",
    "영상길이",
    "참조이미지",
  ].some((labelName) => normalized.includes(labelName));
}

// 기획안에서 '썸네일 번호: N' 옵션 값을 읽는다 ([05] 블록 권장 — 자체 파서, 항목 2 1차).
// 라벨이 없으면 null → 현행 AI 생성 경로 그대로 (기본값 불변 원칙).
function parseThumbnailNumber(text) {
  if (!text) return null;
  const match = /썸네일\s*번호\s*[:：]\s*(\d{1,2})/.exec(String(text));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

// 기획안 전체(planText)에서 '썸네일 번호'로 적힌 고유 번호를 전부 모은다.
// 후보가 여럿인 기획안은 후보마다 다른 번호를 넣을 수 있어서, 첫 매칭만 취하면
// 다른 후보의 번호가 현재 작업에 오적용될 수 있다 — 고유 번호가 1개일 때만 폴백에 쓴다.
function allThumbnailNumbers(text) {
  if (!text) return [];
  const numbers = new Set();
  for (const match of String(text).matchAll(/썸네일\s*번호\s*[:：]\s*(\d{1,2})/g)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value >= 1) numbers.add(value);
  }
  return [...numbers];
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
const rl = createPrompt();

console.log("");
console.log("==================================================");
if (REFERENCE_MODE) {
  console.log(` 닮은 이미지 만들기 (원본 영상 참조) — 현재 작업: ${jobPaths.jobId}`);
} else {
  console.log(` 영상 이미지 만들기 — 현재 작업: ${jobPaths.jobId}`);
}
console.log("==================================================");

let pasted = null;
let pickedBody = null; // 자동 인식으로 고른 후보의 전체 본문 ([05] 옵션 줄 탐색용)
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
    const ans = (await rl.ask("유형 번호 (1/2/3/4, 엔터=1번): ")).trim();
    if (ans === "4") {
      manualPaste = true;
    } else {
      pick = candidates.find((c) => c.num === ans) || candidates[0];
      const cnt = (await rl.ask("장면 이미지를 몇 장 만들까요? (0~3, 엔터=3장): ")).trim();
      autoImageCount = /^[0-3]$/.test(cnt) ? Number(cnt) : 3;
      const th = (await rl.ask("썸네일 배경도 만들까요? (y/n, 엔터=y): ")).trim().toLowerCase();
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
    pickedBody = pick.body;
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

// ---- 항목 2 1차: '썸네일 번호: N' 옵션 처리 ----
// '썸네일후보보기'로 뽑아둔 후보 프레임을 썸네일 배경으로 쓴다.
// 옵션이 없으면 이 블록은 아무 것도 바꾸지 않는다 (현행 AI 생성 그대로).
// 탐색 순서: 선택한 후보 본문 → 붙여넣은 텍스트 → (마지막) 기획안 전체.
// 기획안 전체 폴백은 고유 번호가 1개일 때만 적용한다 — 2개 이상이면 어느 후보의 번호인지
// 알 수 없어 적용하지 않고 안내 후 기존 AI 생성으로 폴백한다 (영상만들기의 [05] 블록 단위 규약과 정합).
let thumbNo = parseThumbnailNumber(pickedBody) ?? parseThumbnailNumber(pasted);
if (thumbNo === null && makeThumbnail) {
  const planNumbers = allThumbnailNumbers(planText);
  if (planNumbers.length === 1) {
    thumbNo = planNumbers[0];
  } else if (planNumbers.length >= 2) {
    console.log("");
    console.log("[안내] 기획안에 '썸네일 번호'가 여러 개 있어요 — 후보마다 번호가 달라 어느 것을 쓸지 알 수 없어요.");
    console.log("[04] 블록과 함께 [05] 블록도 붙여넣어 주세요. 이번에는 기존 방식(AI 생성)으로 썸네일 배경을 만듭니다.");
  }
}
let thumbCandidateFile = null;
if (makeThumbnail && thumbNo !== null) {
  const candidatePath = path.join(
    jobPaths.publicJobRoot,
    "thumb-candidates",
    `candidate_${String(thumbNo).padStart(2, "0")}.png`,
  );
  if (existsSync(candidatePath)) {
    thumbCandidateFile = candidatePath;
    tailDescription = ""; // AI 생성 대신 후보 프레임을 복사한다 (아래 생성부)
  } else {
    console.log("");
    console.log(`[안내] '썸네일 번호: ${thumbNo}' 에 해당하는 후보 이미지를 찾지 못했습니다.`);
    console.log("먼저 터미널에 '썸네일후보보기' 를 실행해 후보를 만들어주세요.");
    console.log("이번에는 기존 방식(AI 생성)으로 썸네일 배경을 만듭니다.");
  }
}

// 붙여넣기 모드에서 썸네일 프롬프트가 안 잡히면 한 번 더 받는다.
if (autoImageCount === null && makeThumbnail && !tailDescription && !thumbCandidateFile) {
  console.log("");
  console.log("썸네일 배경 프롬프트가 아직 인식되지 않았습니다.");
  console.log("썸네일 배경 프롬프트만 다시 붙여넣어 주세요.");
  const retryText = await readPastedText(rl);
  tailDescription = extractThumbnailFromRetry(retryText);
}
rl.close();

if (sceneDescriptions.length === 0 && !tailDescription && !thumbCandidateFile) {
  console.log("");
  console.log("[안내] 만들 이미지나 썸네일 프롬프트를 찾지 못했습니다.");
  console.log("기획안 txt에서 선택한 후보의 [04 이미지 만들기용] 블록을 그대로 복사해 다시 시도해주세요.");
  process.exit(0);
}

// ---- 참조 프레임 준비 (닮은이미지만들기 전용 — 실패 시 기존 텍스트 방식으로 자동 폴백) ----
let referenceImages = [];
if (REFERENCE_MODE && sceneDescriptions.length > 0) {
  const sourceVideo = path.join(jobPaths.publicJobRoot, "source.mp4");
  if (!existsSync(sourceVideo)) {
    console.log("");
    console.log("[안내] 이 작업에는 원본 영상(source.mp4)이 없어 참조 방식을 쓸 수 없습니다.");
    console.log("기존 텍스트 방식으로 이미지를 만듭니다.");
  } else {
    try {
      referenceImages = extractReferenceFrames(sourceVideo);
      console.log("");
      console.log(`원본 영상에서 참조 장면 ${referenceImages.length}장을 뽑았습니다 — 장면 이미지가 내 상품과 닮게 생성됩니다.`);
      console.log("(참조 장면이 함께 전송되어 장당 과금이 기존보다 조금 늘어납니다)");
    } catch {
      console.log("");
      console.log("[안내] 참조 장면 추출 실패 — 기존 텍스트 방식으로 다시 만듭니다.");
    }
  }
}

// 장면 이미지 1장 생성 — 참조 방식이 실패하면 그 장부터 기존 텍스트 방식으로 자동 전환
async function generateSceneImage(description, outputPath) {
  if (referenceImages.length > 0) {
    try {
      await generateImage(description, outputPath, {referenceImages});
      return;
    } catch {
      process.stdout.write("\n");
      console.log("[안내] 참조 방식 실패 — 기존 텍스트 방식으로 다시 만듭니다.");
      referenceImages = []; // 남은 장면도 기존 방식으로 완성한다 (기획서 항목 1 폴백 원칙)
    }
  }
  await generateImage(description, outputPath);
}

const totalCount = sceneDescriptions.length + (tailDescription ? 1 : 0);
console.log("");
console.log(`이미지 ${totalCount}장을 만듭니다. (장당 약 90원, 30초~1분씩 걸립니다)`);
console.log(`  - 장면 이미지: ${sceneDescriptions.length}장`);
if (thumbCandidateFile) {
  console.log(`  - 썸네일 배경: 후보 ${thumbNo}번 장면 사용 (원본 영상 프레임 복사 — 과금 없음)`);
} else {
  console.log("  - 썸네일 배경: 1장");
}
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
    () => generateSceneImage(description, path.join(jobPaths.publicJobRoot, fileName)),
  );
  madeScenes.push(fileName);
}
let madeTail = null;
if (thumbCandidateFile) {
  // '썸네일 번호: N' — 후보 프레임을 그대로 썸네일 배경으로 사용 (경로·파일명은 기존과 완전 동일)
  copyFileSync(thumbCandidateFile, path.join(jobPaths.publicJobRoot, "thumbnail_tail.png"));
  madeTail = "thumbnail_tail.png";
  console.log("");
  console.log(`썸네일 배경: 후보 ${thumbNo}번 장면을 사용했습니다 (원본 영상 프레임).`);
} else if (tailDescription) {
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
