// 장면/썸네일 이미지를 수강생 사진으로 교체·복원하는 스크립트
// (한글 명령 '이미지바꾸기 <번호|썸네일>' / '이미지되돌리기 <번호|썸네일>' 가 실행)
//
// 하는 일 (기획서 v1.1 항목 5):
//   - 교체: 제품 폴더(영상넣는곳/<제품폴더>)에 넣어둔 사진으로 story_0N.png / thumbnail_tail.png 를 바꾼다.
//     같은 파일명으로 바꿔치기 때문에 timeline 수정 없이 다음 렌더·미리보기에 즉시 반영된다.
//   - 교체 전 원본은 public/jobs/<jobId>/backup/ 에 자동 백업 → '이미지되돌리기 N' 으로 복원.
//   - timeline 반영 예외 3건:
//     (a) imageOverlays에 N번 항목이 없으면 그 overlay만 추가 (기존 항목은 보존)
//     (b) 썸네일 교체 시 thumbnailTail.src가 비어 있으면 채운다
//     (c) 편집기에서 바꾼 custom_* 이미지가 적용 중이면 확인 후 src를 story_0N.png로 되돌린다
import {execFileSync} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import path from "node:path";
import {createPrompt} from "./lib/prompt.mjs";
import {VIDEO_INBOX_DIR, ensureNodeModules, projectRootFromScript, resolveJobPaths, studentRoot, windowsLocalPath} from "./job-config.mjs";
import {requireLicense} from "../../../scripts/lib/env.mjs";

// '이미지되돌리기' 래퍼가 --restore 플래그를 넘긴다.
const args = process.argv.slice(2).filter((value) => value !== "--");
const RESTORE_MODE = args.includes("--restore");

// 진입 게이트: 수강 코드(MAKEIT_MIDDLE_LICENSE) 검증 (기존 진입 스크립트와 동일 패턴)
requireLicense({scriptLabel: RESTORE_MODE ? "이미지 되돌리기" : "이미지 바꾸기"});

const projectRoot = projectRootFromScript(import.meta.url);
ensureNodeModules(projectRoot);

const jobPaths = resolveJobPaths(projectRoot);
const propsPath = jobPaths.defaultPropsPath;
const timelinePath = path.join(jobPaths.timelineDir, "timeline.json");

if (!existsSync(propsPath)) {
  console.error("");
  console.error("[안내] 아직 상품 작업이 없습니다. 먼저 터미널에 '새상품 1' 처럼 상품번호와 함께 입력해 작업을 만들어주세요.");
  process.exit(1);
}

const remotionCli = windowsLocalPath(path.join(projectRoot, "node_modules", "@remotion", "cli", "remotion-cli.js"));
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const commandName = RESTORE_MODE ? "이미지되돌리기" : "이미지바꾸기";

function runFfmpeg(ffArgs, options = {}) {
  execFileSync(process.execPath, [remotionCli, "ffmpeg", ...ffArgs], options);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

// ---- 교체/복원 대상 정하기 ----
function targetFromKey(key) {
  if (key === "썸네일") return {key: "썸네일", label: "썸네일 배경", file: "thumbnail_tail.png"};
  if (/^[1-3]$/.test(key)) return {key, label: `${key}번 장면 이미지`, file: `story_${pad2(key)}.png`};
  return null;
}

function listExistingTargets() {
  const found = [];
  for (let n = 1; n <= 3; n += 1) {
    const target = targetFromKey(String(n));
    if (existsSync(path.join(jobPaths.publicJobRoot, target.file))) found.push(target);
  }
  const thumb = targetFromKey("썸네일");
  if (existsSync(path.join(jobPaths.publicJobRoot, thumb.file))) found.push(thumb);
  return found;
}

const rl = createPrompt();

async function resolveTarget() {
  const positional = args.filter((value) => !value.startsWith("--"));
  if (positional[0]) {
    const target = targetFromKey(positional[0].trim());
    if (!target) {
      console.error("");
      console.error(`[안내] '${positional[0]}' 은(는) 알 수 없는 대상입니다.`);
      console.error(`사용법: ${commandName} 2   또는   ${commandName} 썸네일   (번호는 1~3)`);
      process.exit(1);
    }
    return target;
  }
  // 인자 없이 실행 — 발견한 이미지 목록을 보여주고 번호를 물어본다 (기획서 항목 5)
  const existing = listExistingTargets();
  console.log("");
  if (existing.length === 0) {
    if (RESTORE_MODE) {
      // 되돌리기는 '이미지바꾸기'로 교체한 이력이 전제 — '이미지만들기'를 안내하면 헛수순을 밟는다.
      console.log("[안내] 되돌릴 이미지가 없습니다. '이미지바꾸기' 로 교체한 적이 있어야 되돌릴 수 있어요.");
    } else {
      console.log("[안내] 아직 만들어진 이미지가 없습니다. 먼저 '이미지만들기' 를 실행해주세요.");
    }
    process.exit(0);
  }
  console.log(`어떤 이미지를 ${RESTORE_MODE ? "되돌릴까요" : "바꿀까요"}?`);
  existing.forEach((target) => console.log(`  ${target.key}. ${target.label} (${target.file})`));
  const answer = (await rl.ask(`번호 또는 '썸네일' 입력 (엔터=${existing[0].key}): `)).trim();
  const target = answer ? targetFromKey(answer) : existing[0];
  if (!target) {
    console.error(`[안내] '${answer}' 은(는) 알 수 없는 대상입니다. 번호(1~3) 또는 '썸네일' 로 다시 실행해주세요.`);
    process.exit(1);
  }
  return target;
}

// ---- 수강생 사진 찾기 (교체 모드) ----
// 현재 작업의 제품 폴더(source-clips.json의 inputDir)를 먼저 보고,
// 없으면 영상넣는곳 폴더(와 그 하위 폴더)를 찾는다 — new-job과 같은 입구 규칙.
function candidateImageDirs() {
  const dirs = [];
  try {
    const sc = JSON.parse(readFileSync(path.join(jobPaths.jobRoot, "source-clips.json"), "utf8"));
    if (sc.inputDir && existsSync(sc.inputDir)) dirs.push(sc.inputDir);
  } catch {
    // source-clips.json이 없으면 아래 영상넣는곳 폴백으로 간다.
  }
  if (dirs.length === 0) {
    const inbox = path.join(studentRoot(projectRoot), VIDEO_INBOX_DIR);
    if (existsSync(inbox)) {
      dirs.push(inbox);
      for (const name of readdirSync(inbox)) {
        if (name.startsWith(".")) continue;
        const dirPath = path.join(inbox, name);
        try {
          if (statSync(dirPath).isDirectory()) dirs.push(dirPath);
        } catch {
          // 접근 불가 폴더는 건너뛴다.
        }
      }
    }
  }
  return dirs;
}

function collectStudentImages() {
  const images = [];
  const seen = new Set();
  for (const dir of candidateImageDirs()) {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      if (!IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      const filePath = path.join(dir, name);
      if (seen.has(filePath)) continue;
      try {
        if (!statSync(filePath).isFile()) continue;
      } catch {
        continue;
      }
      seen.add(filePath);
      images.push({filePath, fileName: name});
    }
  }
  images.sort((left, right) => left.fileName.localeCompare(right.fileName, "ko", {numeric: true, sensitivity: "base"}));
  return images;
}

async function pickStudentImage() {
  const images = collectStudentImages();
  if (images.length === 0) {
    console.log("");
    console.log("[안내] 교체할 사진을 찾지 못했습니다.");
    console.log(`내 사진(png/jpg/webp)을 [${VIDEO_INBOX_DIR}] 안의 제품 폴더에 넣은 뒤 다시 실행해주세요.`);
    process.exit(0);
  }
  if (images.length === 1) {
    console.log(`\n찾은 사진: ${images[0].fileName}`);
    return images[0];
  }
  console.log("\n사진이 여러 장 있습니다. 어떤 사진으로 바꿀까요?");
  images.forEach((image, index) => console.log(`  ${index + 1}. ${image.fileName}`));
  const answer = (await rl.ask("사진 번호 (엔터=1번): ")).trim();
  const index = /^\d+$/.test(answer) ? Number(answer) - 1 : 0;
  return images[Math.max(0, Math.min(images.length - 1, index))];
}

// ---- timeline/props 반영 ----
function currentSrcOf(data, target) {
  if (target.key === "썸네일") return data?.thumbnailTail?.src || "";
  const overlays = Array.isArray(data?.imageOverlays) ? data.imageOverlays : [];
  const n = Number(target.key);
  const entry =
    overlays.find((overlay) => overlay?.imageId === `story-${n}`) ||
    overlays.find((overlay) => String(overlay?.src || "").endsWith(`story_${pad2(n)}.png`));
  return entry ? String(entry.src || "") : "";
}

// 예외 3건((a)/(b)/(c))을 반영한 새 데이터를 돌려준다. 다른 항목은 절대 건드리지 않는다.
function applyReplacement(data, target) {
  const expectedSrc = `jobs/${jobPaths.jobId}/${target.file}`;
  const next = {...data};
  if (target.key === "썸네일") {
    // (b) src가 비어 있으면 채우고, (c) custom_* 이면 되돌린다 — 결과적으로 항상 expectedSrc
    next.thumbnailTail = {...(data.thumbnailTail || {durationSec: 0.6}), src: expectedSrc};
    return next;
  }
  const n = Number(target.key);
  const overlays = (Array.isArray(data.imageOverlays) ? data.imageOverlays : []).map((overlay) => ({...overlay}));
  let entry =
    overlays.find((overlay) => overlay.imageId === `story-${n}`) ||
    overlays.find((overlay) => String(overlay.src || "").endsWith(`story_${pad2(n)}.png`));
  if (!entry) {
    // (a) N번 항목이 없으면 그 overlay만 추가한다 (통째 교체 금지 — 기존 항목 보존).
    //     시간 배치는 '이미지만들기'(make-images.mjs applyImages)의 3장 기준 산식과 동일.
    const durationSec = Math.max(Number(data.durationSec || 24), 6);
    let startSec;
    let endSec;
    if (n === 1) {
      startSec = 0;
      endSec = Math.min(3, durationSec - 1);
    } else {
      const slot = (durationSec - 4) / 3;
      startSec = Number((3 + slot * (n - 1 - 0.5)).toFixed(2));
      endSec = Number(Math.min(startSec + 2.5, durationSec - 0.5).toFixed(2));
    }
    entry = {imageId: `story-${n}`, startSec, endSec, fit: "cover", transition: "soft-fade", src: expectedSrc};
    overlays.push(entry);
    overlays.sort((left, right) => (Number(left.startSec) || 0) - (Number(right.startSec) || 0));
  } else {
    // (c) custom_* 적용 중이었다면 여기서 story_0N.png로 복귀된다 (호출 전에 사용자 확인을 받는다).
    entry.src = expectedSrc;
  }
  next.imageOverlays = overlays;
  return next;
}

function saveWithReplacement(target) {
  const props = JSON.parse(readFileSync(propsPath, "utf8"));
  writeFileSync(propsPath, JSON.stringify(applyReplacement(props, target), null, 2), "utf8");
  if (existsSync(timelinePath)) {
    const timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
    writeFileSync(timelinePath, JSON.stringify(applyReplacement(timeline, target), null, 2), "utf8");
  }
}

// (c) 검사: 편집기에서 바꾼 custom_* 이미지가 적용 중인지 — props/timeline 어느 한쪽이라도.
function isCustomImageApplied(target) {
  const expectedSrc = `jobs/${jobPaths.jobId}/${target.file}`;
  const sources = [];
  try {
    sources.push(currentSrcOf(JSON.parse(readFileSync(propsPath, "utf8")), target));
  } catch {
    // 읽기 실패는 검사 생략
  }
  if (existsSync(timelinePath)) {
    try {
      sources.push(currentSrcOf(JSON.parse(readFileSync(timelinePath, "utf8")), target));
    } catch {
      // 읽기 실패는 검사 생략
    }
  }
  return sources.some((src) => src && src !== expectedSrc);
}

// ---- 실행 ----
const target = await resolveTarget();
const targetPath = path.join(jobPaths.publicJobRoot, target.file);
const backupDir = path.join(jobPaths.publicJobRoot, "backup");
const backupPrefix = `${target.file.replace(/\.png$/, "")}_`;

if (RESTORE_MODE) {
  // ================= 복원 (이미지되돌리기) =================
  let backups = [];
  if (existsSync(backupDir)) {
    backups = readdirSync(backupDir)
      .filter((name) => name.startsWith(backupPrefix) && name.endsWith(".png"))
      .sort();
  }
  if (backups.length === 0) {
    console.log("");
    console.log(`[안내] ${target.label}의 백업이 없습니다. ('이미지바꾸기' 로 교체한 적이 있어야 되돌릴 수 있어요)`);
    rl.close();
    process.exit(0);
  }
  if (isCustomImageApplied(target)) {
    console.log("");
    console.log("[확인] 이 장면은 편집기에서 바꾼 이미지가 적용 중입니다.");
    const answer = (await rl.ask("복원한 이미지로 덮을까요? (y/n, 엔터=y): ")).trim().toLowerCase();
    if (answer === "n" || answer === "no") {
      console.log("복원을 취소했습니다. (아무것도 바뀌지 않았어요)");
      rl.close();
      process.exit(0);
    }
  }
  rl.close();
  const latest = backups[backups.length - 1];
  copyFileSync(path.join(backupDir, latest), targetPath);
  saveWithReplacement(target); // src를 story_0N.png / thumbnail_tail.png 로 복귀 (예외 (b)/(c))
  console.log("");
  console.log(`완료! ${target.label}을(를) 가장 최근 백업으로 되돌렸습니다.`);
  console.log(`  - 사용한 백업: backup/${latest}`);
  console.log("다음 '영상만들기' 나 편집기 미리보기부터 바로 반영됩니다.");
  process.exit(0);
}

// ================= 교체 (이미지바꾸기) =================
// (c) 확인은 파일을 건드리기 전에 먼저 받는다 — 취소하면 아무것도 바뀌지 않는다.
if (isCustomImageApplied(target)) {
  console.log("");
  console.log("[확인] 이 장면은 편집기에서 바꾼 이미지가 적용 중입니다.");
  const answer = (await rl.ask("터미널 교체로 덮을까요? (y/n, 엔터=y): ")).trim().toLowerCase();
  if (answer === "n" || answer === "no") {
    console.log("교체를 취소했습니다. (아무것도 바뀌지 않았어요)");
    rl.close();
    process.exit(0);
  }
}

const picked = await pickStudentImage();
rl.close();

// 1) 먼저 임시 파일로 변환/복사한다 (실패해도 기존 이미지가 깨지지 않도록)
const tempPath = path.join(jobPaths.publicJobRoot, `${target.file}.new.png`);
rmSync(tempPath, {force: true});
mkdirSync(jobPaths.publicJobRoot, {recursive: true});
if (path.extname(picked.fileName).toLowerCase() === ".png") {
  copyFileSync(picked.filePath, tempPath);
} else {
  console.log("png 형식으로 변환하는 중입니다...");
  try {
    runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", picked.filePath, tempPath, "-y"], {stdio: "inherit"});
  } catch {
    // 아래 존재 검사에서 함께 처리
  }
  if (!existsSync(tempPath)) {
    console.error("");
    console.error(`[안내] 사진 변환에 실패했습니다: ${picked.fileName}`);
    console.error("사진을 png 나 jpg 로 다시 저장해서 넣은 뒤 재시도해주세요. (기존 이미지는 그대로예요)");
    process.exit(1);
  }
}

// 2) 교체 전 원본을 자동 백업한다 → '이미지되돌리기 N' 으로 복원 가능
if (existsSync(targetPath)) {
  mkdirSync(backupDir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHmmss
  copyFileSync(targetPath, path.join(backupDir, `${backupPrefix}${stamp}.png`));
}

// 3) 같은 이름으로 바꿔치기 → timeline 수정 없이 다음 렌더·미리보기에 즉시 반영
renameSync(tempPath, targetPath);

// 4) timeline/props 예외 3건 반영 ((a) 항목 추가 / (b) 빈 src 채움 / (c) custom src 복귀)
saveWithReplacement(target);

console.log("");
console.log(`완료! ${target.label}을(를) [${picked.fileName}] 사진으로 바꿨습니다.`);
console.log("");
console.log("알아두세요:");
console.log("  - 나오는 시점은 자막에 맞춰 자동입니다. (그림만 바뀝니다)");
console.log("  - '이미지만들기' 를 다시 돌리면 교체한 이미지도 새로 만들어집니다. 교체는 마지막에 하세요.");
console.log(`  - 원래대로 돌리고 싶으면: 이미지되돌리기 ${target.key}`);
