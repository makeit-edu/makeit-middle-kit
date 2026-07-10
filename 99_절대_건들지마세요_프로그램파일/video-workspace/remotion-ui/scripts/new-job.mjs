// 새 쇼핑숏폼 작업(job)을 만드는 스크립트
//
// 사용 예:
//   npm run new-job -- --product 002 --name "선크림"
//   npm run new-job -- --product 002 --name "선크림" --video "../raw-videos/내영상.mp4"
//
// 하는 일:
//   1. jobs/job-002/ 작업 폴더를 만든다 (샘플 작업의 설정을 복제)
//   2. 원본 영상을 public/jobs/job-002/source.mp4 로 준비한다
//      (--video 를 안 주면 [02_2주차_쇼핑숏폼자동화/영상넣는곳] 안의 상품별 폴더 또는 영상 파일을 사용)
//   3. 현재 작업을 job-002 로 바꾼다 (편집기를 다시 켜면 이 작업이 열림)
import {execFileSync} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import path from "node:path";
import {DEFAULT_JOB_ID, VIDEO_INBOX_DIR, hideInternalFolders, projectRootFromScript, studentRoot, windowsLocalPath} from "./job-config.mjs";
import {requireLicense} from "../../../scripts/lib/env.mjs";

// 진입 게이트: 수강 코드(MAKEIT_MIDDLE_LICENSE) 검증 (PRD D9 — 2주차 실사용 진입 스크립트 공통)
requireLicense({scriptLabel: "새 상품 작업 만들기"});

const projectRoot = projectRootFromScript(import.meta.url);
// 수강생용 한글 입구 폴더를 1순위로, 예전 영문 폴더도 함께 찾는다
const studentRootDir = studentRoot(projectRoot);
hideInternalFolders(projectRoot); // 코덱스가 만든 .git/.agents 폴더 숨김
const videoInboxDirs = [
  path.join(studentRootDir, VIDEO_INBOX_DIR),
  path.join(studentRootDir, "영상넣는곳"),
  path.resolve(projectRoot, "..", "raw-videos"),
];
// Remotion에 내장된 ffmpeg/ffprobe를 사용한다 (시스템 설치 불필요)
const remotionCli = windowsLocalPath(path.join(projectRoot, "node_modules", "@remotion", "cli", "remotion-cli.js"));
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const INFO_FILE_NAMES = ["상품정보.txt", "상품정보", "상품 정보.txt", "상품 정보", "product-info.txt", "product-info", "info.txt", "info", "메모.txt", "메모"];

function resolveFfmpegExecutable() {
  const fromEnv = process.env.FFMPEG_PATH || process.env.FFMPEG_BINARY || "";
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return null;
}

const ffmpegExecutable = resolveFfmpegExecutable();

function runFfmpeg(args, options = {}) {
  if (ffmpegExecutable) {
    execFileSync(ffmpegExecutable, args, options);
    return;
  }
  execFileSync(process.execPath, [remotionCli, "ffmpeg", ...args], options);
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function fail(message) {
  console.error(`\n[안내] ${message}\n`);
  process.exit(1);
}

const productNoInput = argValue("--product");
if (!productNoInput) {
  fail(
    "상품번호가 필요합니다.\n" +
      '사용 예: npm run new-job -- --product 002 --name "선크림"',
  );
}
// 전각 숫자(０-９)도 반각으로 바꿔 인식한다
const normalizedNo = String(productNoInput).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const digits = normalizedNo.replace(/\D/g, "");
if (!digits) {
  // 숫자가 하나도 없으면 조용히 000으로 만들지 말고 막는다 (한/영 키가 한글 상태일 때 자주 생김)
  fail(
    `상품번호를 숫자로 입력해주세요. (입력한 값: "${productNoInput}")\n` +
      "한/영 키가 한글 상태면 영문·숫자 모드로 바꾼 뒤 다시 시도해주세요. 예: 004",
  );
}
const productNo = digits.padStart(3, "0").slice(-3);
let productName = String(argValue("--name") || "").trim();
const jobId = `job-${productNo}`;

const jobRoot = path.join(projectRoot, "jobs", jobId);
const publicJobRoot = path.join(projectRoot, "public", "jobs", jobId);
const propsPath = path.join(jobRoot, "render", "shopping_shorts_props.json");
const currentJobPath = path.join(projectRoot, "config", "current-job.json");

if (existsSync(propsPath) && !process.argv.includes("--force")) {
  // 이미 만들어진 작업이면 새로 만들지 않고 그 작업으로 전환만 한다
  writeFileSync(currentJobPath, JSON.stringify({jobId}, null, 2), "utf8");
  console.log("");
  console.log(`${productNo}번 작업은 이미 만들어져 있어요. 그 작업으로 전환했습니다.`);
  console.log("(처음부터 새로 만들려면 --force 를 붙여서 실행)");
  console.log("");
  console.log("편집기를 껐다가 다시 켜면 이 작업이 열립니다.");
  console.log("  - 켜져 있다면: 편집기 터미널을 Ctrl+C 로 끄고, 터미널에 '편집기' 를 다시 입력");
  process.exit(0);
}

function naturalCompare(left, right) {
  return left.localeCompare(right, "ko-KR", {numeric: true, sensitivity: "base"});
}

function concatListPathValue(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "\\'");
}

function parseProductInfoText(text) {
  const info = {
    productName: "",
    coupangUrl: "",
    naverUrl: "",
    memo: "",
    raw: text,
  };
  const memoLines = [];
  const numberedOrPlainLines = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const urlMatch = line.match(/https?:\/\/\S+/i);
    if (urlMatch) {
      const url = urlMatch[0].replace(/[),.。]+$/g, "");
      if (/coupang|link\.coupang/i.test(url) && !info.coupangUrl) {
        info.coupangUrl = url;
      } else if (/naver/i.test(url) && !info.naverUrl) {
        info.naverUrl = url;
      } else {
        memoLines.push(line);
      }
      continue;
    }
    const match = line.match(/^([^:=：]+)\s*[:=：]\s*(.+)$/);
    if (!match) {
      numberedOrPlainLines.push(line);
      continue;
    }
    const key = match[1].replace(/\s+/g, "").toLowerCase();
    const value = match[2].trim();
    if (!value) continue;
    if (["상품명", "제품명", "productname", "name"].includes(key)) {
      info.productName = value;
    } else if (["쿠팡파트너스링크", "쿠팡링크", "쿠팡", "coupang", "coupangurl"].includes(key)) {
      info.coupangUrl = value;
    } else if (["브랜드커넥트링크", "네이버브랜드커넥트링크", "네이버링크", "네이버", "naver", "naverurl"].includes(key)) {
      info.naverUrl = value;
    } else if (["추가메모", "메모", "특징", "핵심특징", "memo"].includes(key)) {
      memoLines.push(value);
    }
  }

  for (const line of numberedOrPlainLines) {
    const cleaned = line
      .replace(/^\s*\d+\s*[\.\)]\s*/, "")
      .replace(/^\s*[-*]\s*/, "")
      .trim();
    if (!cleaned) continue;
    const normalizedDigits = cleaned.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    const isProductNumberOnly = new RegExp(`^0*${Number(productNo)}\\s*(번|번상품|상품)?$`).test(normalizedDigits);
    if (isProductNumberOnly) continue;
    if (!info.productName) {
      info.productName = cleaned;
      continue;
    }
    memoLines.push(line);
  }

  info.memo = memoLines.join("\n").trim();
  return info;
}

function readProductInfo(dir) {
  if (!dir || !existsSync(dir)) return {path: null, data: null};
  const files = readdirSync(dir).filter((file) => !file.startsWith("."));
  let infoFile = null;
  for (const expectedName of INFO_FILE_NAMES) {
    const found = files.find((file) => file.normalize("NFC") === expectedName.normalize("NFC"));
    if (found) {
      infoFile = found;
      break;
    }
  }
  if (!infoFile) {
    const txtFiles = files.filter((file) => path.extname(file).toLowerCase() === ".txt").sort(naturalCompare);
    infoFile = txtFiles[0] || null;
  }
  if (!infoFile) return {path: null, data: null};
  const infoPath = path.join(dir, infoFile);
  try {
    const text = readFileSync(infoPath, "utf8");
    return {path: infoPath, data: parseProductInfoText(text)};
  } catch {
    return {path: infoPath, data: null};
  }
}

function folderProductName(folderName) {
  const name = folderName
    .replace(new RegExp(`^0*${Number(productNo)}[_\\-\\s]*`), "")
    .replace(/^[_\-\s]+/, "")
    .trim();
  return name || "";
}

function collectVideosInDir(dir) {
  const videos = [];
  if (!existsSync(dir)) return videos;
  for (const file of readdirSync(dir)) {
    if (file.startsWith(".")) continue;
    const filePath = path.join(dir, file);
    if (!statSync(filePath).isFile()) continue;
    if (!VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    videos.push({filePath, fileName: file});
  }
  videos.sort((left, right) => naturalCompare(left.fileName, right.fileName));
  return videos;
}

function findProductFolder(dir) {
  const folders = readdirSync(dir)
    .filter((file) => !file.startsWith("."))
    .map((file) => ({name: file, filePath: path.join(dir, file)}))
    .filter((item) => statSync(item.filePath).isDirectory())
    .sort((left, right) => naturalCompare(left.name, right.name));

  if (folders.length === 0) return null;

  const matched = folders.filter((item) => {
    const digitsInName = item.name.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).match(/\d+/g) || [];
    return digitsInName.some((value) => value.padStart(3, "0").slice(-3) === productNo);
  });
  if (matched.length === 1) return matched[0];
  if (matched.length > 1) {
    fail(
      `${productNo}번으로 보이는 폴더가 여러 개 있습니다.\n` +
        matched.map((item) => `- ${item.name}`).join("\n") +
        "\n하나만 남긴 뒤 다시 실행해주세요.",
    );
  }

  if (folders.length === 1) {
    const only = folders[0];
    const digitsInName = only.name.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).match(/\d+/g) || [];
    const hasDifferentNumber = digitsInName.length > 0 && !digitsInName.some((value) => value.padStart(3, "0").slice(-3) === productNo);
    if (hasDifferentNumber) {
      fail(
        `입력한 상품번호는 ${productNo}번인데, 영상 폴더명은 "${only.name}"입니다.\n` +
          "상품번호를 맞추거나 폴더명을 수정한 뒤 다시 실행해주세요. 예: 001_손목보호대",
      );
    }
    return only;
  }

  return null;
}

// 1) 원본 영상과 상품정보 찾기
function findSourceBundle() {
  const videoArg = argValue("--video");
  if (videoArg) {
    const resolved = path.resolve(process.cwd(), videoArg);
    if (!existsSync(resolved)) fail(`영상 파일을 찾을 수 없습니다: ${resolved}`);
    return {
      mode: "single-file",
      inputDir: path.dirname(resolved),
      productFolderName: "",
      productInfoPath: null,
      productInfo: null,
      videos: [{filePath: resolved, fileName: path.basename(resolved)}],
    };
  }
  for (const dir of videoInboxDirs) {
    if (!existsSync(dir)) continue;

    const productFolder = findProductFolder(dir);
    if (productFolder) {
      const videos = collectVideosInDir(productFolder.filePath);
      if (videos.length > 0) {
        const info = readProductInfo(productFolder.filePath);
        return {
          mode: "product-folder",
          inputDir: productFolder.filePath,
          productFolderName: productFolder.name,
          productInfoPath: info.path,
          productInfo: info.data,
          videos,
        };
      }
    }

    const directVideos = collectVideosInDir(dir);
    if (directVideos.length > 0) {
      const info = readProductInfo(dir);
      return {
        mode: "direct-files",
        inputDir: dir,
        productFolderName: "",
        productInfoPath: info.path,
        productInfo: info.data,
        videos: directVideos,
      };
    }

    const folders = readdirSync(dir)
      .filter((file) => !file.startsWith("."))
      .map((file) => ({name: file, filePath: path.join(dir, file)}))
      .filter((item) => statSync(item.filePath).isDirectory())
      .sort((left, right) => naturalCompare(left.name, right.name));
    if (folders.length > 1) {
      fail(
        `영상넣는곳 안에 상품 폴더가 여러 개 있습니다. ${productNo}번 폴더를 찾지 못했습니다.\n` +
          "폴더명 앞에 상품번호를 붙여주세요. 예: 001_손목보호대\n\n" +
          folders.map((item) => `- ${item.name}`).join("\n"),
      );
    }
  }
  fail(
    "영상 파일(mp4, mov)을 찾지 못했습니다.\n" +
      `프로젝트 폴더 안 [${VIDEO_INBOX_DIR}] 폴더에 상품 원본 영상을 넣은 뒤 다시 실행해주세요.`,
  );
}

function probeDurationSec(filePath) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [remotionCli, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]},
    );
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : null;
  } catch {
    return null;
  }
}

const sourceBundle = findSourceBundle();
const sourceVideos = sourceBundle.videos;
if (!productName && sourceBundle.productInfo?.productName) {
  productName = sourceBundle.productInfo.productName;
}
if (!productName && sourceBundle.productFolderName) {
  productName = folderProductName(sourceBundle.productFolderName);
}
if (!productName) {
  productName = `상품 ${productNo}`;
}

if (sourceBundle.mode === "product-folder") {
  console.log(`상품 폴더: ${sourceBundle.productFolderName}`);
}
if (sourceBundle.productInfoPath) {
  console.log(`상품정보 파일: ${sourceBundle.productInfoPath}`);
}
console.log(`원본 영상 ${sourceVideos.length}개를 찾았습니다.`);
sourceVideos.forEach((video, index) => {
  console.log(`  ${String(index + 1).padStart(2, "0")}. ${video.fileName}`);
});

// 2) 영상을 public/jobs/<jobId>/source.mp4 로 준비
mkdirSync(publicJobRoot, {recursive: true});
mkdirSync(path.join(jobRoot, "render"), {recursive: true});
const targetVideo = path.join(publicJobRoot, "source.mp4");

function prepareSingleVideo(sourceVideo, outputVideo) {
  const extension = path.extname(sourceVideo).toLowerCase();
  if (extension === ".mp4") {
    copyFileSync(sourceVideo, outputVideo);
    return;
  }
  console.log("mp4 형식으로 변환하는 중입니다. 영상 길이에 따라 시간이 걸릴 수 있습니다...");
  runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", sourceVideo, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", outputVideo, "-y"], {stdio: "inherit"});
}

function normalizeClipForConcat(sourceVideo, outputVideo) {
  runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sourceVideo,
    "-vf",
    "scale=width=1080:height=1920:force_original_aspect_ratio=increase,crop=out_w=1080:out_h=1920,format=pix_fmts=yuv420p",
    "-r",
    "30",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    outputVideo,
    "-y",
  ], {stdio: "inherit"});
}

function concatClips(clipPaths, outputVideo) {
  const listPath = path.join(publicJobRoot, "concat-list.txt");
  const listText = clipPaths.map((clipPath) => `file '${concatListPathValue(clipPath)}'`).join("\n");
  writeFileSync(listPath, `${listText}\n`, "utf8");
  runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outputVideo, "-y"], {stdio: "inherit"});
}

let preparedClips = [];
if (sourceVideos.length === 1) {
  prepareSingleVideo(sourceVideos[0].filePath, targetVideo);
  preparedClips = [{
    index: 1,
    originalName: sourceVideos[0].fileName,
    publicSrc: `jobs/${jobId}/source.mp4`,
    preparedPath: targetVideo,
    durationSec: probeDurationSec(targetVideo),
  }];
  console.log("영상 준비 완료 (단일 원본)");
} else {
  console.log("여러 원본 영상을 파일명순으로 하나의 쇼핑숏폼 배경 영상으로 합치는 중입니다...");
  const clipPaths = [];
  preparedClips = sourceVideos.map((video, index) => {
    const clipFileName = `source_${String(index + 1).padStart(2, "0")}.mp4`;
    const preparedPath = path.join(publicJobRoot, clipFileName);
    console.log(`  - ${video.fileName} → ${clipFileName}`);
    normalizeClipForConcat(video.filePath, preparedPath);
    clipPaths.push(preparedPath);
    return {
      index: index + 1,
      originalName: video.fileName,
      publicSrc: `jobs/${jobId}/${clipFileName}`,
      preparedPath,
      durationSec: probeDurationSec(preparedPath),
    };
  });
  concatClips(clipPaths, targetVideo);
  console.log("멀티컷 영상 합치기 완료");
}

// 2-1) 코덱스가 영상 내용을 "볼" 수 있도록 핵심 장면 프레임을 뽑아둔다.
//      코덱스는 영상을 직접 못 보지만, 이 이미지들을 읽어서 영상 내용을 파악한다.
function extractFrames(videoPath, framesDir, options = {}) {
  mkdirSync(framesDir, {recursive: true});
  let durationSec = 0;
  try {
    const out = execFileSync(
      process.execPath,
      [remotionCli, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
      {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]},
    );
    durationSec = Number(out.trim()) || 0;
  } catch {
    durationSec = 0;
  }
  const count = options.count || 4;
  const prefix = options.prefix || "frame";
  const made = [];
  for (let i = 0; i < count; i += 1) {
    // 영상 길이를 균등 분할한 시점에서 한 장씩 (길이를 모르면 2·5·9·13초 고정)
    const t = durationSec > 0 ? (durationSec * (i + 1)) / (count + 1) : [2, 5, 9, 13][i];
    const outPath = path.join(framesDir, `${prefix}_${String(i + 1).padStart(2, "0")}.png`);
    try {
      runFfmpeg(["-hide_banner", "-loglevel", "error", "-ss", String(t.toFixed(1)), "-i", videoPath, "-frames:v", "1", "-vf", "scale=640:-1", outPath, "-y"], {stdio: "ignore"});
      if (existsSync(outPath)) made.push(path.basename(outPath));
    } catch {
      // 한 장 실패해도 나머지는 계속
    }
  }
  return made;
}

const framesDir = path.join(jobRoot, "frames");
rmSync(framesDir, {recursive: true, force: true});
let frames = [];
if (preparedClips.length > 1) {
  const framesPerClip = preparedClips.length <= 6 ? 2 : 1;
  for (const clip of preparedClips) {
    const made = extractFrames(clip.preparedPath, framesDir, {
      count: framesPerClip,
      prefix: `clip_${String(clip.index).padStart(2, "0")}_frame`,
    });
    frames = frames.concat(made);
  }
} else {
  frames = extractFrames(targetVideo, framesDir);
}
if (frames.length > 0) {
  console.log(`영상 장면 ${frames.length}장 추출 완료 (코덱스가 이 장면을 보고 대본을 만듭니다)`);
} else {
  console.log("[참고] 영상 장면 추출은 건너뜀 (대본은 상품 정보 기준으로 만들어집니다)");
}
// 기획안 txt는 제품폴더(영상넣는곳/제품폴더) 바로 아래에 저장한다. (진현님 확정: 하위폴더 아님)
const planningDir = sourceBundle.inputDir;
const planningFileName = `${productNo}_${productName}_기획안.txt`;
const planningFilePath = path.join(planningDir, planningFileName);
try {
  mkdirSync(planningDir, {recursive: true});
} catch {
  // 원본 위치가 읽기 전용이면 Codex가 잘못 저장하지 않도록 프롬프트에서 중단시킨다.
}
writeFileSync(
  path.join(jobRoot, "source-clips.json"),
  JSON.stringify(
    {
      jobId,
      productNo,
      productName,
      inputMode: sourceBundle.mode,
      inputDir: sourceBundle.inputDir,
      planningDir,
      planningFileName,
      planningFilePath,
      mustSavePlanningFileHere: planningFilePath,
      planningSaveRule: "기획안 txt는 반드시 mustSavePlanningFileHere 경로(제품폴더 바로 아래)에 이 파일명 그대로 저장한다. 그 외 위치·다른 파일명 금지.",
      productFolderName: sourceBundle.productFolderName,
      productInfoPath: sourceBundle.productInfoPath,
      productInfo: sourceBundle.productInfo,
      combinedVideo: `jobs/${jobId}/source.mp4`,
      clipCount: preparedClips.length,
      clips: preparedClips.map((clip) => ({
        index: clip.index,
        originalName: clip.originalName,
        publicSrc: clip.publicSrc,
        durationSec: clip.durationSec,
      })),
      frameFiles: frames,
      rule: "여러 원본 영상은 영상넣는곳 폴더의 파일명순으로 합쳐집니다.",
    },
    null,
    2,
  ),
  "utf8",
);

if (sourceBundle.productInfo) {
  writeFileSync(
    path.join(jobRoot, "product-info.json"),
    JSON.stringify(
      {
        productNo,
        productName,
        coupangUrl: sourceBundle.productInfo.coupangUrl || "",
        naverUrl: sourceBundle.productInfo.naverUrl || "",
        memo: sourceBundle.productInfo.memo || "",
        originalInfoPath: sourceBundle.productInfoPath,
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    path.join(jobRoot, "codex-folder-prompt.txt"),
    [
      "[CRITICAL - FILE ENCODING (English, read first)]",
      "ALWAYS read every file in this workspace as UTF-8. In PowerShell use Get-Content -Raw -Encoding UTF8 <path>. NEVER plain Get-Content - Korean will look corrupted like ?꾨낫. If any Korean you read looks garbled, re-read the file with UTF-8. NEVER copy corrupted characters into your output.",
      "ALWAYS save the plan txt as UTF-8 WITHOUT BOM: [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false)). NEVER Out-File/Set-Content with default encoding. After saving, read it back with UTF-8 and confirm Korean labels are readable.",
      "",
      "[CRITICAL - OUTPUT CONTRACT (English, read first)]",
      "For EACH of the 3 candidates, the `[05 영상 만들기용]` block MUST contain exactly these labels on their own lines: `후킹:`, `대본:`, `자막:`, `TTS:`, `CTA:`. `자막:` must be followed by 7-8 short sentence lines (each 12-24 Korean characters), and `TTS:` must repeat the `자막:` lines character-for-character. The 05 block may contain ONLY these labels: 후킹:/대본:/자막:/TTS:/CTA:/썸네일 문구:/광고 표시:/가상인물 표시 필요:/가상인물 판단 이유:. NEVER invent labels like `상황:`, `문제:`, `반전:`, `체감변화:`, `전개:`, `00_`, or scene directions. Save the final txt ONLY directly under the product folder inside `영상넣는곳` - NEVER inside `jobs/`. If you cannot satisfy this contract, stop and say so.",
      "",
      "[영상 작업 요청 v2]",
      "",
      `제품번호: ${productNo}`,
      `상품명: ${productName}`,
      `쿠팡파트너스 링크: ${sourceBundle.productInfo.coupangUrl || "없음"}`,
      `네이버 브랜드커넥트/쇼핑커넥트 링크: ${sourceBundle.productInfo.naverUrl || "없음"}`,
      sourceBundle.productInfo.memo ? `추가메모: ${sourceBundle.productInfo.memo}` : "",
      "",
      "[작업 폴더 찾기 - 매우 중요]",
      "특정 배포 폴더명, 날짜 폴더명, 압축 해제 예시 폴더명을 절대 가정하지 마.",
      "지금 열린 작업공간 내부에서만 재귀적으로 찾아. 작업공간 밖의 상위 폴더, 다른 날짜 폴더, 다운로드 폴더 전체는 찾지 마.",
      `video-workspace/remotion-ui/jobs/${jobId}, remotion-ui/jobs/${jobId}, jobs/${jobId} 구조를 가진 실제 폴더를 찾아.`,
      `후보가 여러 개면 각 후보 안의 product-info.json, source-clips.json, codex-folder-prompt.txt를 확인해서 ${productNo}번 상품과 일치하는 폴더만 사용해.`,
      `찾지 못하면 작업을 진행하지 말고, 현재 열린 작업공간 안에서 ${productNo}번 상품 작업 폴더를 찾지 못했습니다라고만 짧게 알려줘.`,
      "",
      "먼저 직접 확인할 것",
      "1. 실제로 찾은 상품 작업 폴더의 frames/ 안에 있는 png 이미지를 모두 읽어서 상품의 모양, 색, 재질, 실제 촬영 장면, 컷 순서를 파악해.",
      "2. 여러 컷이면 clip_01_frame_01처럼 컷 순서가 파일명에 들어가 있어.",
      "3. 실제로 찾은 상품 작업 폴더 안의 product-info.json 또는 codex-folder-prompt.txt가 있으면 상품명, 링크, 메모를 근거로 써.",
      "",
      "이 상품의 쇼핑숏폼 결과를 채팅창에 길게 출력하지 마.",
      "기획안 txt는 반드시 실제 원본 영상이 들어 있던 `영상넣는곳`의 상품 폴더 '바로 아래'에 저장해. 하위 폴더(`대본 및 이미지` 등)를 새로 만들지 말고 상품 폴더 바로 아래에 저장해.",
      `절대 jobs/${jobId} 폴더 안에 기획안을 저장하지 마. jobs/${jobId}는 프레임과 메타데이터를 확인하는 분석용 폴더일 뿐이야.`,
      "저장 규칙(가장 중요): source-clips.json의 mustSavePlanningFileHere 값이 있으면, 오직 그 경로에만 기획안 txt를 저장해. 그 경로 말고 다른 어떤 위치에도 저장하지 마.",
      "mustSavePlanningFileHere가 없을 때만 source-clips.json의 planningDir 폴더 바로 아래에 저장하고, planningDir도 없으면 inputDir 폴더 바로 아래에 저장해. 어느 경우든 하위 폴더를 새로 만들지 마.",
      "Windows 경로처럼 보이는 C:\\Mac\\Home 문자열은 그대로 새 폴더로 만들지 말고, 현재 열린 작업공간 안에서 같은 끝 경로를 가진 실제 폴더로 해석해.",
      "저장 직전에 반드시 확인: 저장하려는 상품 폴더 안에 `상품정보` 파일 또는 원본 영상 파일(.mp4, .mov, .MOV 등)이 있어야 한다. 없으면 원본 영상이 들어 있던 상품 폴더가 아니므로 저장하지 마.",
      "비슷한 이름의 프로젝트 폴더, 오타가 있는 프로젝트 폴더, 네가 새로 만든 프로젝트 폴더에는 절대 저장하지 마.",
      "메킷허브중급반프로젝트폴더 또는 비슷한 이름의 프로젝트 폴더 자체를 새로 만들지 마.",
      "저장 직후에는 실제 txt 파일이 그 위치에 생겼는지 반드시 확인하고, 확인된 경로만 채팅에 짧게 알려줘.",
      "모두 없으면 기획안을 저장하지 말고 `원본 영상이 들어 있던 상품 폴더를 찾지 못했습니다`라고만 짧게 알려줘.",
      `파일명은 반드시 source-clips.json의 planningFileName 값을 그대로 써. 그 값이 없을 때만 ${productNo}_${productName}_기획안.txt 로 저장해.`,
      "",
	      "기획안 txt에는 아래 내용을 반드시 넣어줘.",
	      "1. 사용 전 확인",
	      "1-1. 사용 전 확인에는 네이버 브랜드커넥트/쇼핑커넥트 CPA 추가 CTA: 예/해당 없음 항목을 반드시 넣어줘.",
	      "2. 후보 한눈에 보기",
	      "3. 후보 1 : 공감형",
	      "4. 후보 2 : 경고형",
	      "5. 후보 3 : 후기형",
	      "6. 각 후보 안의 [04 이미지 만들기용] 블록",
	      "7. 각 후보 안의 [05 영상 만들기용] 블록",
	      "8. 광고 표시: 예",
	      "9. AI 이미지/썸네일 프롬프트 기준 가상인물 표시 필요 여부",
	      "",
	      "후보는 정확히 3개만 써. 마지막에 추천 후보를 한 번 더 반복하는 블록은 만들지 마.",
	      "후보 제목은 반드시 [후보 1 : 공감형], [후보 2 : 경고형], [후보 3 : 후기형]으로 써.",
	      "각 후보는 아래 형식으로 써.",
	      "[후보 1 : 공감형]",
	      "이 후보를 고르면 좋은 상황:",
	      "",
	      "[04 이미지 만들기용]",
	      "썸네일 문구:",
	      "",
	      "썸네일 배경 프롬프트:",
	      "",
	      "이미지1:",
	      "",
	      "이미지2:",
	      "",
	      "이미지3:",
	      "",
	      "가상인물 표시 필요: 예/아니오",
	      "",
	      "가상인물 판단 이유:",
	      "",
	      "[05 영상 만들기용]",
	      "후킹:",
	      "",
	      "대본:",
	      "",
	      "자막:",
	      "",
	      "TTS:",
	      "",
	      "CTA:",
	      "",
	      "썸네일 문구:",
	      "",
	      "광고 표시: 예",
	      "",
	      "가상인물 표시 필요: 예/아니오",
	      "",
	      "가상인물 판단 이유:",
	      "",
	      "위 형식을 [후보 2 : 경고형], [후보 3 : 후기형]에도 똑같이 반복해.",
	      "",
	      "초보 수강생이 고르기 쉽게 써줘.",
	      "1. 후보 1 공감형은 일상 속 불편함을 먼저 찔러서 저거 나도 겪는데라고 느끼게 써.",
	      "2. 후보 2 경고형은 놓치기 쉬운 포인트나 모르고 지나치면 손해 보는 느낌을 만들되, 허위 공포를 만들지 마.",
	      "3. 후보 3 후기형은 직접 써본 듯한 반전과 체감 변화로 끌고 가되, 과장된 광고 말투를 피해.",
	      "4. 대본은 존댓말로, 20초에서 30초 쇼츠 기준으로, 영상에서 실제로 입으로 말할 대사 문장만 써. 전개:, 00_오프닝, 01_제품 체인, ~를 던진다, ~를 보여준다, ~로 정리한다, 자막은 짧고 담백하게 같은 연출 설명/장면 지시는 한 줄도 쓰면 실패야.",
	      "5. 대본은 CTA 음성까지 포함해 20초 이상 자연스럽게 이어지게 써. 음성이 없는 화면이 길게 남지 않게, 짧은 대본을 영상만 늘려서 해결하는 구조는 피해야 해.",
	      "5-1. 대본은 CTA를 제외한 본문 정확히 8문장으로 써. 한 문장은 공백 포함 14~24자 — 26자를 넘으면 실패야. 본문 전체는 150~200자로 써 — 150자 미만이면 완성 영상이 20초보다 짧아져 실패야. 말했을 때 CTA 포함 20~30초, 영상 전체 목표는 20~35초야. 본문은 문장들이 자연스럽게 이어지는 하나의 이야기여야 하고, 뚝뚝 끊긴 한 줄 목록처럼 쓰면 실패야.",
	      "5-2. 대본은 단순 제품 설명이 아니라 불편한 순간, 왜 신경 쓰이는지, 그냥 넘기면 생기는 불편, 제품을 써보는 순간, 예상과 다른 작은 반전, 구체적인 체감 변화, 계속 보게 만드는 마무리, 프로필 링크 CTA 흐름으로 써.",
	      "5-3. 피곤합니다, 생각보다 좋습니다 같은 밋밋한 단독 문장을 반복하지 마. [나쁜 예 절대 금지] 00_오프닝에서 매일 차도 안 질리는 시계를 던진다 / 제품 체인에서 얇은 두께를 보여준다. [좋은 예 이렇게] 아침마다 시계까지 고르려니 은근 귀찮더라고요 / 근데 이건 얇고 가벼워서 차고 있는 것도 까먹을 정도예요.",
	      "6. 상품명 설명보다 스토리텔링을 우선하고, 상품명은 꼭 필요할 때만 1회 이하로 언급해.",
	      "7. 스토리 순서(중요: 이건 내용의 순서일 뿐, 출력 라벨이 아니야. 상황:/문제:/반전: 같은 라벨을 절대 만들지 마): 불편한 순간, 왜 신경 쓰이는지, 그냥 넘기면 생기는 불편, 제품을 써보는 순간, 예상과 다른 작은 반전, 구체적인 체감 변화, 계속 보게 만드는 마무리, CTA 순서로 잡아.",
	      "8. 자막은 대본 흐름과 같은 순서로 한 줄에 한 문장씩 써. 너무 짧은 키워드가 아니라 자연스러운 존댓말 문장으로 써. 번호/불릿/설명 문장/괄호 안내는 자막 줄에 넣지 마.",
	      "8-1. 자막은 CTA를 제외하고 정확히 8줄로 써. 한 줄은 공백 포함 14~24자(26자 초과 금지 — 화면에서 2줄을 넘어가면 실패야). CTA 문장은 자막 아래에 넣지 말고 CTA 항목에만 넣어. TTS 아래에는 자막 문장을 글자 하나 바꾸지 말고 같은 줄 수, 같은 순서로 그대로 반복해. 자막과 TTS가 다르면 실패야.",
	      "9. CTA는 영상의 마지막 음성 문장이야. 자막 마지막 줄에 CTA를 반복하지 말고, CTA 항목에만 분리해서 써.",
	      "10. 영상 프로그램은 CTA 음성이 끝난 뒤 기존 쿠팡 CTA 화면을 약 3초 보여주고, 이어서 네이버 브랜드커넥트/쇼핑커넥트 CPA용 추가 CTA 화면인 `왼쪽아래 링크를 클릭 후`, 한 줄 띄고 `지금 바로`, 한 줄 띄고 `확인하세요 :)` 화면과 왼쪽 아래 모서리를 가리키는 왕복 화살표를 약 5초 자동으로 보여준 뒤 썸네일을 아주 짧게 보여주고 종료해.",
	      "10-1. 이 추가 CTA는 기존 쿠팡 CTA를 대체하지 않고, 네이버 브랜드커넥트/쇼핑커넥트 링크가 있을 때 CPA 클릭 흐름을 보강하는 화면이야.",
	      "10-2. 추가 CTA 문구는 영상 프로그램이 자동으로 넣으므로, 자막이나 CTA 항목에 직접 반복해서 쓰지 마.",
	      "11. 이미지는 해당 대사가 나오는 순간 화면에 뜬다 — 그 문장을 그대로 그려야 해. 이미지1은 대본 1~2번째 문장(후킹/문제 순간)을, 이미지2는 중반의 '제품을 써보는 순간' 문장을, 이미지3은 후반의 '체감 변화' 문장을 그 문장 속 사물·장소·행동 그대로 시각화해서 써. 이미지1/2/3과 썸네일 배경 프롬프트는 제품 컷처럼 한 마디로 끝내면 실패야. 카메라 구도와 앵글, 조명과 색감, 제품의 색·재질·질감·디테일, 배경과 소품, 분위기를 담아 각각 최소 160자 이상 자세히 써.",
	      "12. 이미지1, 이미지2, 이미지3은 선택 생성용이야. 수강생이 원하면 이미지를 만들지 않아도 영상이 나와야 하므로, 각 이미지는 대본 흐름을 보강하는 장면으로만 써.",
	      "13. 썸네일 문구는 8자에서 18자 안팎으로 짧고 강하게 써.",
	      "14. 썸네일 배경 프롬프트에는 세로 9:16, 강한 대비, 실제 후기 느낌, 상품이 잘 보이는 구도, 한글 텍스트가 들어갈 빈 공간을 반드시 넣고, 촬영 각도·조명·배경 질감·감정 분위기까지 담아 최소 220자 이상 자세히 써.",
	      "15. 썸네일 배경 프롬프트는 필수야. 제품 사진 자체보다 실제 활용 상황, 스토리텔링, 비포앤애프터, 첫 3초 후킹과 연결되는 강한 장면으로 써.",
	      "16. 배경 이미지 안에 한글 글자를 직접 넣으라고 쓰지 마.",
	      "17. 가상인물 표시 필요는 실제 촬영 원본 프레임 기준이 아니라, 네가 작성한 썸네일 배경 프롬프트/이미지1/이미지2/이미지3 기준으로 판단해.",
	      "18. AI 생성용 프롬프트에 사람 얼굴이 확실히 들어가면 가상인물 표시 필요: 예로 적고, 어떤 프롬프트 때문인지 판단 이유에 써.",
	      "19. 사람 얼굴은 클릭을 멈추게 하는 효과가 확실할 때만 넣고, 아니면 손/팔/뒷모습/제품 중심 장면을 우선해.",
	      `20. 기존 쿠팡 CTA는 반드시 유지해. CTA는 반드시 정확히 이 문구 그대로 적어: 프로필 링크에서 ${productNo}번 확인. 다른 표현(쿠팡 링크에서, 프로모션 링크에서 등)으로 바꾸면 실패야. 네이버 브랜드커넥트/쇼핑커넥트 링크가 있으면 네이버 브랜드커넥트/쇼핑커넥트 CPA 추가 CTA: 예로 적고, 없으면 해당 없음으로 적어.`, 
	      "21. 건강/의료/다이어트 효능 표현 리스크가 있으면 먼저 경고 문구를 넣고, 몸의 변화가 아니라 사용 상황의 편의성 변화 중심으로 작성해줘.",
      "22. 첫 문장(후킹)은 일상 속 특정 순간을 콕 집어 저거 내 얘긴데 하고 손가락을 멈추게 만들어. 공감 찌르기, 의외의 반전, 놓치면 손해, 궁금증 유발 중 하나로 강하게 열되, 예시를 그대로 베끼지 말고 이번 상품에 맞게 새로 써.",
      "22-1. 후킹 금지 시작: 오늘 소개할 제품은, 이 제품은 ~입니다, 상품명이나 기능부터 나열, 밋밋한 인사/자기소개. 이렇게 시작하면 실패야.",
      "22-2. 후킹: 라벨 아래에는 대본의 첫 문장 딱 1개만 써. 대본이나 자막 전체를 후킹: 아래에 반복해서 넣으면 실패야.",
      "23. 말투는 실제 사람이 편하게 말하듯 자연스러운 구어체 존댓말로 써. ~더라고요, ~거든요, ~잖아요, 은근, 생각보다, 솔직히 같은 진짜 대화체를 살리고, 같은 어미를 연달아 반복하지 마.",
      "23-1. 번역투/설명체/광고 멘트는 금지야. ~하는 제품입니다, 탁월합니다, 만족도가 높습니다, 강력 추천합니다처럼 딱딱하고 AI가 쓴 듯한 문장은 한 줄도 쓰면 실패야.",
      "24. 스토리텔링은 문장마다 다음이 궁금해지는 고리로 이어. 정보를 한 번에 다 주지 말고 근데, 알고 보니, 여기서부터 처럼 조금씩 흘리며 끝까지 보게 만들어.",
      "24-1. 제품 장점은 스펙 나열이 아니라 쓰고 나서 달라진 구체적인 순간으로 보여줘. 성능이 좋습니다가 아니라 저녁 먹고 바로 소파에 앉을 수 있게 됐어요처럼 실제 장면으로 써.",
      "25. [완성 대본 톤 예시 — 감만 잡고 절대 베끼지 마] 아래는 다른 상품의 말투/리듬 참고용이야. 그대로 가져오면 실패고, 이번 상품에 맞는 새 대본을 본문 7~8문장(문장당 12~24자)으로 써. 예시A(주방,공감형): 설거지 끝냈는데 싱크대 물때 보면 한숨 나오지 않으세요 / 저도 매번 수세미로 박박 문지르다 손목까지 아팠거든요 / 근데 이거 하나 걸어뒀더니 물때가 아예 안 생기더라고요 / 처음엔 반신반의했는데 일주일 지나니까 확실히 달라요 / 이제 저녁 먹고 바로 쉴 수 있어서 이게 제일 좋아요. 예시B(수면,후기형): 저 원래 새벽에 두세 번씩 깨는 사람이었거든요 / 베개 탓인가 싶어서 큰맘 먹고 바꿔봤어요 / 첫날은 별 느낌 없었는데 사흘째부터 아침까지 안 깨더라고요 / 목이 안 배기니까 확실히 개운해요 / 요즘은 이거 없으면 잠을 못 잘 것 같아요. 예시C(생활가전,경고형): 이거 모르고 그냥 쓰는 분들 은근 많더라고요 / 저도 전기요금 보고 나서야 알았어요 / 알고 보니 대기전력이 계속 새고 있던 거였어요 / 이거 꽂아두고 이번 달 요금 보고 깜짝 놀랐어요 / 진작 알았으면 좋았을 텐데 싶더라고요.",
      "",
    ].filter(Boolean).join("\n"),
    "utf8",
  );
}

// 3) 샘플 작업의 props를 복제해서 새 작업 정보로 바꾼다.
//    배포 ZIP에 sample-001이 빠져 있어도 수강생 작업은 반드시 만들어져야 하므로,
//    샘플 파일이 없으면 기본 props를 직접 만든다.
const samplePropsPath = path.join(projectRoot, "jobs", DEFAULT_JOB_ID, "render", "shopping_shorts_props.json");
// 기본 BGM: public/bgm 폴더의 곡을 새 작업마다 자동 적용한다. 다른 곡으로 바꾸려면 파일명만 교체.
const DEFAULT_BGM_SRC = "bgm/mixkit-beautiful-dream-493.mp3";
function createFallbackProps() {
  return {
    videoSrc: `jobs/${jobId}/source.mp4`,
    productName,
    productNo,
    durationSec: 24,
    sourceDurationSec: 24,
    sourceClips: [],
    hook: "",
    captions: [],
    imageOverlays: [],
    adBadge: {
      text: "광고",
      position: "top-right",
    },
    cta: `프로필 링크에서 ${productNo}번 확인`,
    // 기본 BGM: public/bgm 폴더에 넣은 CC0 곡 파일명을 src에 적으면 새 작업마다 자동 적용된다(예: "bgm/기본곡.mp3").
    backgroundMusic: {
      volume: 0.055,
      title: "",
      src: DEFAULT_BGM_SRC,
      fadeInSec: 1,
      fadeOutSec: 1,
    },
    thumbnailTail: {
      durationSec: 0.6,
      text: `제품번호 ${productNo}`,
    },
  };
}
const props = existsSync(samplePropsPath) ? JSON.parse(readFileSync(samplePropsPath, "utf8")) : createFallbackProps();

const replaceJobPath = (value) =>
  typeof value === "string" ? value.replaceAll(`jobs/${DEFAULT_JOB_ID}/`, `jobs/${jobId}/`) : value;

const walk = (node) => {
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = walk(value);
    return out;
  }
  return replaceJobPath(node);
};

let nextProps = walk(props);
nextProps.productName = productName;
nextProps.productNo = productNo;
nextProps.videoSrc = `jobs/${jobId}/source.mp4`;
nextProps.productInfo = sourceBundle.productInfo || undefined;
nextProps.sourceVideoCount = preparedClips.length;
nextProps.sourceClips = preparedClips.map((clip) => ({
  index: clip.index,
  originalName: clip.originalName,
  src: clip.publicSrc,
  durationSec: clip.durationSec,
}));
nextProps.cta = `프로필 링크에서 ${productNo}번 확인`;

// 작업을 새로 만들면 편집기 데이터(timeline)도 새로 시작한다 — 낡은 편집 상태(BGM 누락 등) 잔존 방지.
rmSync(path.join(projectRoot, "editor-data", jobId), {recursive: true, force: true});

// 새 작업에는 샘플의 음성/이미지가 없으므로 비워둔다 (편집기에서 새로 만든다)
nextProps.narrationSrc = undefined;
nextProps.imageOverlays = [];
nextProps.scenes = [];
// BGM은 작업별 자산이 아니라 공용 리소스(public/bgm)라 지우지 않고 기본곡을 적용한다.
nextProps.backgroundMusic = {
  volume: 0.055,
  fadeInSec: 1,
  fadeOutSec: 1,
  ...(nextProps.backgroundMusic || {}),
  src: (nextProps.backgroundMusic && nextProps.backgroundMusic.src) || DEFAULT_BGM_SRC,
  title: (nextProps.backgroundMusic && nextProps.backgroundMusic.title) || "잔잔한 드림 (Beautiful Dream)",
};
if (nextProps.thumbnailTail) {
  nextProps.thumbnailTail = {...nextProps.thumbnailTail, durationSec: 0.6, src: undefined, text: `제품번호 ${productNo}`};
}
if (nextProps.ctaBackground) {
  nextProps.ctaBackground = undefined;
}

const durationSec = probeDurationSec(targetVideo);
if (durationSec) {
  nextProps.sourceDurationSec = durationSec;
  nextProps.durationSec = Math.min(Number(nextProps.durationSec || durationSec), durationSec);
}

writeFileSync(propsPath, JSON.stringify(nextProps, null, 2), "utf8");

// 4) 현재 작업 전환
writeFileSync(currentJobPath, JSON.stringify({jobId}, null, 2), "utf8");

console.log("");
console.log(`완료: ${productNo}번(${productName}) 작업이 만들어졌습니다.`);
console.log(`작업 폴더: ${jobRoot}`);
console.log("(이 작업은 편집기를 다시 켜면 열립니다 — 자세한 다음 순서는 아래 안내를 참고하세요)");
