// 썸네일 후보 프레임을 뽑아 보여주는 스크립트 (한글 명령 '썸네일후보보기' 가 실행)
//
// 하는 일 (기획서 v1.1 항목 2 — 1차):
//   1. 현재 작업의 원본 클립들(source-clips.json)에서 클립당 2~3장씩
//      고해상(원본 해상도 그대로, scale 축소 없음) 프레임을 뽑아
//   2. public/jobs/<jobId>/thumb-candidates/ 에 1번부터 번호를 붙여 저장하고
//   3. "3번 = 2번째 영상의 중간 장면" 식 목록을 보여준다.
//   수강생은 마음에 드는 번호를 기획안 [05] 블록에 `썸네일 번호: 3` 으로 넣고
//   '이미지만들기'를 실행하면 그 장면이 썸네일 배경이 된다.
//
// 주의: jobs/<jobId>/frames/ 의 640px 축소본은 쓰지 않는다 — 썸네일 배경용으로는
//       저해상이라 부적합해서 반드시 원본에서 다시 뽑는다 (기획서 항목 2 명시).
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {ensureNodeModules, projectRootFromScript, resolveJobPaths, windowsLocalPath} from "./job-config.mjs";
import {requireLicense} from "../../../scripts/lib/env.mjs";

// 진입 게이트: 수강 코드(MAKEIT_MIDDLE_LICENSE) 검증 (기존 진입 스크립트와 동일 패턴)
requireLicense({scriptLabel: "썸네일 후보 보기"});

const projectRoot = projectRootFromScript(import.meta.url);
ensureNodeModules(projectRoot);

const jobPaths = resolveJobPaths(projectRoot);
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

// ---- 원본 클립 목록 만들기 ----
// source-clips.json의 클립별 정규화본(1080x1920)을 쓴다. 없으면 source.mp4 단일 폴백.
function loadClips() {
  const clips = [];
  try {
    const sc = JSON.parse(readFileSync(path.join(jobPaths.jobRoot, "source-clips.json"), "utf8"));
    for (const clip of sc.clips || []) {
      if (!clip || !clip.publicSrc) continue;
      const filePath = path.join(projectRoot, "public", ...String(clip.publicSrc).split("/"));
      if (!existsSync(filePath)) continue;
      clips.push({
        index: Number(clip.index) || clips.length + 1,
        originalName: clip.originalName || `영상 ${clips.length + 1}`,
        filePath,
        durationSec: Number(clip.durationSec) || 0,
      });
    }
  } catch {
    // source-clips.json이 없는 구작업 — 아래 source.mp4 폴백으로 간다.
  }
  if (clips.length === 0) {
    const sourceVideo = path.join(jobPaths.publicJobRoot, "source.mp4");
    if (existsSync(sourceVideo)) {
      clips.push({index: 1, originalName: "원본 영상", filePath: sourceVideo, durationSec: 0});
    }
  }
  return clips;
}

const clips = loadClips();
if (clips.length === 0) {
  console.error("");
  console.error("[안내] 이 작업에서 원본 영상을 찾지 못했습니다.");
  console.error("먼저 터미널에 '새상품 1' 처럼 입력해 작업을 만든 뒤 다시 실행해주세요.");
  process.exit(1);
}

console.log("");
console.log("==================================================");
console.log(` 썸네일 후보 보기 — 현재 작업: ${jobPaths.jobId}`);
console.log("==================================================");
console.log(`원본 영상 ${clips.length}개에서 썸네일 후보를 뽑습니다. (과금 없음, 잠시만 기다려주세요)`);

// 클립당 후보 장수: 클립이 적으면 3장, 많으면 2장 (기획서: 클립당 2~3장)
const perClip = clips.length <= 4 ? 3 : 2;
const positionLabels = perClip === 3 ? ["앞 장면", "중간 장면", "뒷 장면"] : ["앞 장면", "뒷 장면"];

// 후보 폴더는 매번 새로 만든다 (이전 실행과 번호가 섞이지 않도록)
const candidatesDir = path.join(jobPaths.publicJobRoot, "thumb-candidates");
rmSync(candidatesDir, {recursive: true, force: true});
mkdirSync(candidatesDir, {recursive: true});

function ordinalName(index) {
  return `${index}번째 영상`;
}

const made = [];
let number = 0;
for (const [clipOrder, clip] of clips.entries()) {
  const durationSec = clip.durationSec > 0 ? clip.durationSec : probeDurationSec(clip.filePath);
  for (let i = 0; i < perClip; i += 1) {
    number += 1;
    // 클립 길이를 균등 분할한 시점 (길이를 모르면 1·4·8초 고정)
    const t = durationSec > 0 ? (durationSec * (i + 1)) / (perClip + 1) : [1, 4, 8][i] || 1;
    const fileName = `candidate_${String(number).padStart(2, "0")}.png`;
    const outPath = path.join(candidatesDir, fileName);
    try {
      // scale 필터 없이 원본 해상도 그대로 (정규화본이면 1080x1920 고해상)
      runFfmpeg(
        ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(1), "-i", clip.filePath, "-frames:v", "1", outPath, "-y"],
        {stdio: "ignore"},
      );
    } catch {
      // 한 장 실패해도 나머지는 계속
    }
    if (!existsSync(outPath)) {
      number -= 1; // 실패한 번호는 건너뛰지 않고 다음 후보가 이어받는다 (번호 구멍 방지)
      continue;
    }
    made.push({
      number,
      file: fileName,
      clipIndex: clip.index,
      clipName: clip.originalName,
      timeSec: Number(t.toFixed(1)),
      description: `${ordinalName(clipOrder + 1)}(${clip.originalName})의 ${positionLabels[i]}`,
    });
  }
}

if (made.length === 0) {
  console.error("");
  console.error("[안내] 후보 장면을 뽑지 못했습니다. 터미널에 '진단' 을 입력해 상태를 확인해주세요.");
  process.exit(1);
}

// 목록 파일도 남겨둔다 (어떤 번호가 어떤 장면인지 나중에 확인용)
writeFileSync(
  path.join(candidatesDir, "candidates.json"),
  JSON.stringify({jobId: jobPaths.jobId, createdAt: new Date().toISOString(), candidates: made}, null, 2),
  "utf8",
);

console.log("");
console.log(`썸네일 후보 ${made.length}장을 만들었습니다:`);
for (const item of made) {
  console.log(`  ${item.number}번 = ${item.description}`);
}
console.log("");
console.log("후보 이미지는 아래 폴더에 저장됐어요. 파일을 열어 눈으로 확인해보세요:");
console.log(`  ${candidatesDir}`);
console.log("");
console.log("마음에 드는 장면을 골랐다면, 기획안의 [05 영상 만들기용] 블록에");
console.log("  썸네일 번호: 3");
console.log("처럼 한 줄을 추가하고 '이미지만들기' 를 실행하세요. 그 장면이 썸네일 배경이 됩니다.");
console.log("(옵션 줄을 지우면 기존처럼 AI가 썸네일 배경을 만들어요.)");
