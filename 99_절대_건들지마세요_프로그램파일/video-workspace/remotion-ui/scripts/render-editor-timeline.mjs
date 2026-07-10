import {execFileSync, spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import path from "node:path";
import {
  FINISHED_VIDEO_DIR,
  ensureNodeModules,
  programRoot,
  projectRootFromScript,
  resolveJobPaths,
  studentRoot,
  windowsLocalPath,
} from "./job-config.mjs";
import {ensureHeadlessShell} from "./ensure-headless-shell.mjs";
import {requireLicense} from "../../../scripts/lib/env.mjs";

// 진입 게이트: 수강 코드(MAKEIT_MIDDLE_LICENSE) 검증 (PRD D9 — 2주차 실사용 진입 스크립트 공통)
requireLicense({scriptLabel: "영상 렌더링"});

const projectRoot = projectRootFromScript(import.meta.url);
ensureNodeModules(projectRoot);

const jobPaths = resolveJobPaths(projectRoot);
const timelinePath = path.join(jobPaths.timelineDir, "timeline.json");
const jobRoot = jobPaths.jobRoot;
const publicJobRoot = jobPaths.publicJobRoot;
const defaultPropsPath = jobPaths.defaultPropsPath;
const renderDir = jobPaths.renderDir;
const propsPath = path.join(jobRoot, "render", "editor_props.json");
const lastRenderPath = path.join(jobPaths.timelineDir, "last-render.json");
// Remotion에 내장된 ffmpeg/ffprobe를 사용한다 (시스템 설치 불필요)
const remotionCli = windowsLocalPath(path.join(projectRoot, "node_modules", "@remotion", "cli", "remotion-cli.js"));

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const progressFile = argValue("--progress-file");
const exportQuality = argValue("--quality") === "fast" ? "fast" : "high";
// 쿠팡용/네이버용 버전 (영상 파일을 2개 따로 만든다). --variant coupang|naver, 없으면 기존 동작(둘 다).
const renderVariant = argValue("--variant");
const NAVER_CTA_VOICE_TEXT = "왼쪽 아래 링크에서 확인해 보세요";
const terminalProgressEnabled = !hasFlag("--json");
const terminalProgressStartedAt = Date.now();

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

function printTerminalProgress(payload) {
  if (!terminalProgressEnabled) return;
  const safe = Math.max(0, Math.min(100, Number(payload.progress) || 0));
  const elapsedSec = (Date.now() - terminalProgressStartedAt) / 1000;
  const remainingSec = safe > 1 && safe < 100 ? (elapsedSec * (100 - safe)) / safe : 0;
  const percentText = `${Math.round(safe)}`.padStart(3, " ");
  const remainingText = safe >= 100 ? "0초" : formatSeconds(remainingSec);
  process.stdout.write(
    `\r${progressBar(safe)} ${percentText}% | ${payload.message || "영상 제작 중"} | 경과 ${formatSeconds(elapsedSec)} | 남은 예상 ${remainingText}   `,
  );
  if (payload.status === "done" || payload.status === "error") process.stdout.write("\n");
}

function reportProgress(update) {
  const previous = progressFile && existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, "utf8")) : {};
  const payload = {
    ...previous,
    status: update.status || "running",
    message: update.message || "영상을 준비하는 중입니다",
    progress: Math.max(0, Math.min(100, Number(update.progress || 0))),
    quality: exportQuality,
    updatedAt: new Date().toISOString(),
  };
  if (progressFile) {
    mkdirSync(path.dirname(progressFile), {recursive: true});
    writeFileSync(progressFile, JSON.stringify(payload, null, 2), "utf8");
  }
  printTerminalProgress(payload);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
      reject(new Error(tail || `명령 실행 실패: ${command} ${args.join(" ")}`));
    });
  });
}

async function withProgressEstimate({startProgress, endProgress, message, estimateSec}, task) {
  const localStartedAt = Date.now();
  const safeStart = Math.max(0, Math.min(100, startProgress));
  const safeEnd = Math.max(safeStart, Math.min(100, endProgress));
  const tick = () => {
    const elapsed = (Date.now() - localStartedAt) / 1000;
    const ratio = Math.min(0.94, elapsed / Math.max(estimateSec, 1));
    const current = Math.min(safeEnd - 0.5, safeStart + (safeEnd - safeStart) * ratio);
    reportProgress({message, progress: current});
  };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const result = await task();
    clearInterval(timer);
    reportProgress({message: `${message} 완료`, progress: safeEnd});
    return result;
  } catch (error) {
    clearInterval(timer);
    throw error;
  }
}

// (Codespaces 전환) 윈도우 공유 폴더(robocopy 미러링) 우회는 제거 — 렌더는 항상 프로젝트 폴더에서 직접 수행한다.
function prepareRenderProjectRoot() {
  return projectRoot;
}

function pathInRenderProject(filePath, renderProjectRoot) {
  if (renderProjectRoot === projectRoot) return windowsLocalPath(filePath);
  return path.join(renderProjectRoot, path.relative(projectRoot, filePath));
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate)) || null;
}

function resolveBrowserExecutable() {
  // 중요: 시스템에 설치된 Chrome/Edge를 렌더 브라우저로 쓰면, 수강생이 그 브라우저를
  // 켜둔 상태(대부분 그렇다)에서 headless 인스턴스가 렌더용 로컬 서버(localhost)에
  // 붙지 못해 "Visited localhost but got no response" 오류로 렌더가 실패한다.
  // 그래서 기본값은 Remotion 전용 Chrome Headless Shell(사용자 브라우저와 완전 분리)이며,
  // 환경변수로 실행 파일을 '명시적으로' 지정한 경우에만 그 브라우저를 사용한다.
  const fromEnv = process.env.REMOTION_BROWSER_EXECUTABLE || process.env.BROWSER_EXECUTABLE || "";
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return null;
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

function envValue(key) {
  const studentEnv = parseEnvFile(path.join(studentRoot(projectRoot), ".env.local"));
  const localEnv = parseEnvFile(path.join(projectRoot, ".env.local"));
  const programEnv = parseEnvFile(path.join(programRoot(projectRoot), ".env.local"));
  return process.env[key] || localEnv[key] || programEnv[key] || studentEnv[key];
}

function safeFilePart(value) {
  return (
    String(value || "")
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "shopping-short"
  );
}

function roundTime(value) {
  return Number(value.toFixed(2));
}

const CTA_HOLD_SEC = 3; // 쿠팡 프로필 링크 CTA 유지 시간(진현님 요청: 3초)
const SECONDARY_CTA_HOLD_SEC = 5; // 네이버 추가 CTA 화면 유지 시간(진현님 요청: 5초)
const SECONDARY_CTA_TEXT = "왼쪽아래 링크를 클릭 후\n\n지금 바로\n\n확인하세요 :)";
const THUMBNAIL_TAIL_SEC = 0.6;

function briefThumbnailTailSec(value) {
  const duration = Number(value || THUMBNAIL_TAIL_SEC);
  if (!Number.isFinite(duration) || duration <= 0) return THUMBNAIL_TAIL_SEC;
  return Math.max(0.35, Math.min(duration, 0.8));
}

function cleanCaptionText(text) {
  return String(text || "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function extendFinalCtaCaption(captions, timeline) {
  const nextCaptions = captions.map((caption) => ({...caption, text: cleanCaptionText(caption.text)}));
  const ctaIndex = nextCaptions.map((caption) => caption.variant === "cta").lastIndexOf(true);
  if (ctaIndex === -1) return nextCaptions;

  const cta = nextCaptions[ctaIndex];
  const timelineAudioEndSec = ctaIndex === nextCaptions.length - 1 ? Number(timeline.audio?.durationSec || 0) : 0;
  const previousHoldSec = Number(cta.ctaHoldSec || 0);
  const ctaVoiceEndSec =
    Number(cta.ctaVoiceEndSec || 0) ||
    timelineAudioEndSec ||
    (previousHoldSec > 0 ? Number(cta.endSec || 0) - previousHoldSec : Number(cta.endSec || 0));
  if (!Number.isFinite(ctaVoiceEndSec) || ctaVoiceEndSec <= 0) return nextCaptions;

  nextCaptions[ctaIndex] = {
    ...cta,
    ctaVoiceEndSec: roundTime(ctaVoiceEndSec),
    ctaHoldSec: CTA_HOLD_SEC,
    endSec: roundTime(ctaVoiceEndSec + CTA_HOLD_SEC),
  };
  return nextCaptions;
}

function repositionImageOverlays(timeline, captions) {
  const overlays = Array.isArray(timeline.imageOverlays) ? timeline.imageOverlays : [];
  if (overlays.length === 0) return overlays;

  // 이미지가 대본과 어울리도록 "자막 문장 경계"에 맞춰 배치한다.
  // 기획안 규칙: 이미지1=후킹 문장, 이미지2=제품을 써보는 순간(중반), 이미지3=체감 변화(후반 본문).
  // 그래서 이미지1=첫 문장, 이미지2=중간 문장, 이미지3=마지막 본문 문장이 "말해지는 동안" 표시한다.
  const bodyCaps = captions
    .filter((caption) => caption.variant !== "cta" && Number(caption.endSec || 0) > Number(caption.startSec || 0))
    .sort((a, b) => Number(a.startSec || 0) - Number(b.startSec || 0));

  const ctaCaption = [...captions].reverse().find((caption) => caption.variant === "cta");
  const usableEndSec = Math.max(Number(ctaCaption?.startSec || 0) || Number(timeline.durationSec || 0) - 2, 6);

  // 문장 구간을 이미지 표시 구간으로 바꾼다(최소 1.6초는 보이게, CTA 침범 금지).
  const spanForCaption = (caption) => {
    const startSec = Math.max(0, Number(caption.startSec || 0));
    const endSec = Math.min(Math.max(Number(caption.endSec || 0), startSec + 1.6), usableEndSec - 0.2);
    return {startSec: roundTime(startSec), endSec: roundTime(Math.max(endSec, startSec + 0.8))};
  };

  const n = bodyCaps.length;
  const anchors = n > 0
    ? [bodyCaps[0], bodyCaps[Math.min(n - 1, Math.floor(n / 2))], bodyCaps[n - 1]]
    : [];

  return overlays.map((overlay, index) => {
    if (index >= 3 || anchors.length === 0) return overlay;
    const span = spanForCaption(anchors[Math.min(index, anchors.length - 1)]);
    return {
      ...overlay,
      startSec: span.startSec,
      endSec: span.endSec,
      transition: overlay.transition || "soft-fade",
    };
  });
}

function buildSecondaryCta(timeline, captions, variant) {
  const ctaCaption = [...captions].reverse().find((caption) => caption.variant === "cta");
  // 네이버 버전: "왼쪽 아래 링크에서 확인하세요" 음성·자막이 나오는 순간부터
  // 화살표 화면이 같이 뜨도록 시작을 CTA 자막 시작점으로 앞당긴다(둘이 겹쳐 5초 유지).
  const startSec =
    variant === "naver" ? Number(ctaCaption?.startSec || 0) : Number(ctaCaption?.endSec || 0);
  if (!Number.isFinite(startSec) || startSec <= 0) return null;

  const previous = timeline.secondaryCta || {};
  return {
    ...previous,
    text: String(previous.text || SECONDARY_CTA_TEXT),
    startSec: roundTime(startSec),
    durationSec: SECONDARY_CTA_HOLD_SEC,
    endSec: roundTime(startSec + SECONDARY_CTA_HOLD_SEC),
    arrow: previous.arrow === false ? false : true,
  };
}

function applyEndingRules(timeline, variant) {
  const tailSec = briefThumbnailTailSec(timeline.thumbnailTail?.durationSec);
  const captions = extendFinalCtaCaption(Array.isArray(timeline.captions) ? timeline.captions : [], timeline);
  const captionEndSec = captions.reduce((max, caption) => Math.max(max, Number(caption.endSec || 0)), 0);
  // 쿠팡용 버전은 네이버 추가 CTA 화면(왼쪽아래 링크)을 넣지 않는다.
  const secondaryCta = variant === "coupang" ? null : buildSecondaryCta(timeline, captions, variant);
  const visibleEndSec = Math.max(captionEndSec, Number(secondaryCta?.endSec || 0));
  const durationSec = roundTime(Math.max(visibleEndSec + tailSec, 1));

  return {
    ...timeline,
    durationSec,
    captions,
    secondaryCta,
    imageOverlays: repositionImageOverlays(timeline, captions),
    thumbnailTail: {
      ...(timeline.thumbnailTail || {}),
      durationSec: tailSec,
    },
    editorNotes: {
      ...(timeline.editorNotes || {}),
      ctaHoldSec: CTA_HOLD_SEC,
      secondaryCtaHoldSec: secondaryCta ? SECONDARY_CTA_HOLD_SEC : 0,
      thumbnailTailSec: tailSec,
    },
  };
}

function cleanVoiceText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function probeDuration(filePath) {
  const stdout = run(process.execPath, [
    remotionCli,
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    windowsLocalPath(filePath),
  ]);
  return Number(stdout.trim());
}

async function generateElevenLabsSegment({apiKey, voiceId, modelId, voiceSettings, text, outputPath}) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: voiceSettings,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new Error(
        "ElevenLabs API 키가 올바르지 않습니다. " +
          "99_절대_건들지마세요_프로그램파일/.env.local 파일에서 ELEVENLABS_API_KEY 값을 실제 ElevenLabs 키로 바꾼 뒤 다시 실행해주세요.",
      );
    }
    throw new Error(`ElevenLabs 음성 생성 실패: ${response.status} ${body}`);
  }

  writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function regenerateEditorNarration(timeline, renderedAt, onProgress = () => {}) {
  const captions = Array.isArray(timeline.captions) ? timeline.captions : [];
  const voiceItems = captions
    .map((caption, index) => ({
      index,
      text: cleanVoiceText(caption.text),
      caption: String(caption.text || ""),
      emphasis: Boolean(caption.emphasis),
      variant: caption.variant === "cta" ? "cta" : "caption",
    }))
    .filter((item) => item.text.length > 0);

  if (voiceItems.length === 0) {
    throw new Error("새 음성을 만들 자막 문장이 없습니다.");
  }

  onProgress({
    message: "새 음성을 준비하는 중입니다",
    progress: 5,
  });

  const apiKey = envValue("ELEVENLABS_API_KEY");
  if (!apiKey || apiKey.includes("your-") || apiKey.startsWith("your")) {
    throw new Error(
      "ElevenLabs API 키가 아직 실제 값으로 입력되지 않았습니다. " +
        "99_절대_건들지마세요_프로그램파일/.env.local 파일에서 ELEVENLABS_API_KEY= 뒤에 실제 ElevenLabs API 키를 넣고 저장한 뒤 다시 실행해주세요.",
    );
  }

  const voiceConfig = JSON.parse(readFileSync(path.join(projectRoot, "config", "voice_presets.json"), "utf8"));
  const previousAudio = timeline.audio || {};
  const presetId = previousAudio.presetId || "lively-reaction";
  const preset = voiceConfig.presets.find((item) => item.id === presetId) || voiceConfig.presets[0];
  const speed = Number(previousAudio.speed || preset.voiceSettings?.speed || 1);
  const modelId = String(previousAudio.modelId || voiceConfig.modelId || "eleven_multilingual_v2");
  const voiceId = String(previousAudio.voiceId || envValue("ELEVENLABS_VOICE_ID") || "DtyPtKRq6hp0tIhLTanw");
  const suffix = `editor_${renderedAt}`;
  const segmentDir = path.join(jobRoot, "audio", `${suffix}_segments`);
  const publicNarrationPath = path.join(publicJobRoot, `narration_${suffix}.mp3`);
  // 같은 문장+같은 목소리 설정은 다시 생성하지 않고 재사용한다 (ElevenLabs 크레딧 절약)
  const voiceCacheDir = path.join(jobRoot, "audio", "voice-cache");
  mkdirSync(segmentDir, {recursive: true});
  mkdirSync(voiceCacheDir, {recursive: true});
  mkdirSync(publicJobRoot, {recursive: true});

  const voiceSettings = {...preset.voiceSettings, speed};
  const cacheKeyOf = (text) =>
    createHash("sha1")
      .update(JSON.stringify({voiceId, modelId, voiceSettings, text}))
      .digest("hex");

  const segmentReports = [];
  const concatLines = [];
  let reusedCount = 0;

  for (const [voiceIndex, item] of voiceItems.entries()) {
    const voiceStartProgress = 10 + Math.round((voiceIndex / voiceItems.length) * 55);
    const voiceEndProgress = 10 + Math.round(((voiceIndex + 1) / voiceItems.length) * 55);
    const voiceMessage = `${voiceIndex + 1}/${voiceItems.length} 문장 음성 만드는 중`;
    onProgress({
      message: voiceMessage,
      progress: voiceStartProgress,
    });

    const outputPath = path.join(segmentDir, `seg_${String(item.index + 1).padStart(2, "0")}.mp3`);
    const cachePath = path.join(voiceCacheDir, `${cacheKeyOf(item.text)}.mp3`);
    if (existsSync(cachePath)) {
      copyFileSync(cachePath, outputPath);
      reusedCount += 1;
      onProgress({
        message: `${voiceIndex + 1}/${voiceItems.length} 문장 기존 음성 재사용`,
        progress: voiceEndProgress,
      });
    } else {
      await withProgressEstimate(
        {
          startProgress: voiceStartProgress,
          endProgress: voiceEndProgress,
          message: voiceMessage,
          estimateSec: 14,
        },
        () =>
          generateElevenLabsSegment({
            apiKey,
            voiceId,
            modelId,
            voiceSettings,
            text: item.text,
            outputPath,
          }),
      );
      copyFileSync(outputPath, cachePath);
    }

    const durationSec = probeDuration(outputPath);
    // 자막 표시 시간 = 그 문장 음성의 실제 길이. (옛 자막 길이로 늘리면 음성보다 길어져 싱크가 누적으로 밀린다)
    const displayDurationSec = Math.max(durationSec, 0.05);
    segmentReports.push({
      index: item.index,
      text: item.text,
      caption: item.caption,
      outputPath: windowsLocalPath(outputPath),
      durationSec,
      displayDurationSec,
    });
    concatLines.push(`file '${outputPath.replaceAll("'", "'\\''")}'`);
  }

  onProgress({
    message: reusedCount > 0 ? `음성을 하나로 합치는 중 (${reusedCount}문장은 기존 음성 재사용)` : "음성을 하나로 합치는 중",
    progress: 72,
  });

  const concatPath = path.join(segmentDir, "concat.txt");
  writeFileSync(concatPath, concatLines.join("\n"), "utf8");
  run(process.execPath, [
    remotionCli,
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c",
    "copy",
    windowsLocalPath(publicNarrationPath),
    "-y",
  ]);

  let cursor = 0;
  const nextCaptions = segmentReports.map((segment) => {
    const original = captions[segment.index] || {};
    const startSec = roundTime(cursor);
    const endSec = roundTime(cursor + segment.displayDurationSec);
    cursor = endSec;
    return {
      ...original,
      startSec,
      endSec,
      text: segment.caption,
      variant: original.variant === "cta" ? "cta" : "caption",
    };
  });

  const captionEndSec = nextCaptions.at(-1)?.endSec || Number(timeline.durationSec || 0);
  const totalAudioSec = probeDuration(publicNarrationPath);
  const narrationSrc = `jobs/${path.basename(jobRoot)}/${path.basename(publicNarrationPath)}`;
  const nextNarration = nextCaptions.map((caption) => ({
    text: cleanVoiceText(caption.text),
    caption: caption.text,
    emphasis: Boolean(caption.emphasis),
    ...(caption.variant === "cta" ? {variant: "cta"} : {}),
  }));
  const ctaCaption = nextCaptions.find((caption) => caption.variant === "cta");

  return {
    timeline: applyEndingRules({
      ...timeline,
      durationSec: roundTime(Math.max(captionEndSec, 1)),
      narration: nextNarration,
      narrationText: nextNarration.map((item) => item.text).join(" "),
      captions: nextCaptions,
      narrationSrc,
      finalCta: ctaCaption
        ? {
            ...(timeline.finalCta || {}),
            voiceText: cleanVoiceText(ctaCaption.text),
            caption: ctaCaption.text,
            variant: "cta",
          }
        : timeline.finalCta,
      audio: {
        ...previousAudio,
        provider: "elevenlabs",
        mode: "segmented",
        presetId: preset.id,
        modelId,
        speed,
        voiceId,
        outputPath: publicNarrationPath,
        durationSec: totalAudioSec,
        segments: segmentReports,
        regeneratedAt: new Date().toISOString(),
      },
      editorNotes: {
        ...(timeline.editorNotes || {}),
        voiceRegenerationRequested: false,
        voiceRegeneratedAt: new Date().toISOString(),
      },
    }),
    report: {
      provider: "elevenlabs",
      voiceId,
      modelId,
      presetId: preset.id,
      speed,
      outputPath: publicNarrationPath,
      narrationSrc,
      totalAudioSec,
      segmentCount: segmentReports.length,
      reusedSegments: reusedCount,
    },
  };
}

async function main() {
if (!existsSync(timelinePath)) {
  if (!existsSync(defaultPropsPath)) {
    throw new Error(`편집 타임라인과 기본 샘플 props가 모두 없습니다: ${timelinePath}`);
  }
  mkdirSync(path.dirname(timelinePath), {recursive: true});
  copyFileSync(defaultPropsPath, timelinePath);
}

mkdirSync(renderDir, {recursive: true});
mkdirSync(path.dirname(propsPath), {recursive: true});

reportProgress({
  message: "편집 내용을 준비하는 중입니다",
  progress: 3,
});

const timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
// 네이버용 버전은 마지막 쿠팡 CTA 문장(프로필 링크…)을 네이버 안내로 바꾼다. 자막·음성이 함께 반영된다.
if (renderVariant === "naver" && Array.isArray(timeline.captions)) {
  const ctaIdx = timeline.captions.map((c) => c.variant === "cta").lastIndexOf(true);
  if (ctaIdx !== -1) {
    timeline.captions = timeline.captions.map((c, i) =>
      i === ctaIdx ? {...c, text: NAVER_CTA_VOICE_TEXT} : c,
    );
  }
}
const renderedAt = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
let renderTimeline = timeline;
let voiceReport = null;

if (timeline.editorNotes?.voiceRegenerationRequested) {
  const result = await regenerateEditorNarration(timeline, renderedAt, reportProgress);
  renderTimeline = result.timeline;
  voiceReport = result.report;
  writeFileSync(timelinePath, JSON.stringify(renderTimeline, null, 2), "utf8");
}

renderTimeline = applyEndingRules(renderTimeline, renderVariant);
writeFileSync(timelinePath, JSON.stringify(renderTimeline, null, 2), "utf8");

const fps = Number(renderTimeline.fps || 30);
const durationSec = Math.max(1, Number(renderTimeline.durationSec || 24));
// 영상 틀(root.tsx)과 동일한 90초 안전 상한. 둘이 어긋나면 "frame range not inbetween" 오류가 난다.
const totalFrames = Math.min(Math.ceil(durationSec * fps), fps * 90);
const variantSuffix = renderVariant === "coupang" ? "_쿠팡" : renderVariant === "naver" ? "_네이버" : "";
// 렌더 내부 파일명은 영문만 쓴다 — 윈도우에서 렌더 엔진이 한글 파일명을 다른 형태로 저장해
// 이후 복사(copyFileSync)가 ENOENT로 실패하는 문제가 있었다. 수강생이 보는 완성영상 파일명은
// node가 직접 만들므로 한글이어도 안전하다.
const asciiVariant = renderVariant === "coupang" ? "_coupang" : renderVariant === "naver" ? "_naver" : "";
const outputFile = `${jobPaths.jobId}${asciiVariant}__editor__${renderedAt}.mp4`;
const outputPath = path.join(renderDir, outputFile);

writeFileSync(propsPath, JSON.stringify({...renderTimeline, fps}, null, 2), "utf8");

const entryPoint = windowsLocalPath(path.join(projectRoot, "remotion", "src", "index.ts"));
const browserExecutable = resolveBrowserExecutable();
reportProgress({
  message: "윈도우 렌더링용 작업공간을 준비하는 중입니다",
  progress: voiceReport ? 78 : 16,
});
const renderProjectRoot = prepareRenderProjectRoot();
const renderRemotionCli = pathInRenderProject(remotionCli, renderProjectRoot);
const renderEntryPoint = pathInRenderProject(entryPoint, renderProjectRoot);
const renderOutputPath = pathInRenderProject(outputPath, renderProjectRoot);
const renderPropsPath = pathInRenderProject(propsPath, renderProjectRoot);

reportProgress({
  message: "영상을 제작하는 중입니다",
  progress: voiceReport ? 82 : 20,
});

// 렌더 전에 전용 브라우저가 실제로 설치돼 있는지 확인하고, 깨져 있으면 스스로 고친다.
// (Remotion의 자체 설치는 윈도우에서 조용히 실패할 수 있어 여기서 보장해야 한다)
if (!browserExecutable) {
  ensureHeadlessShell(renderProjectRoot, {
    log: (message) => reportProgress({message, progress: voiceReport ? 80 : 18}),
  });
}

const renderArgs = [
  renderRemotionCli,
  "render",
  renderEntryPoint,
  "ShoppingShorts",
  renderOutputPath,
  `--props=${renderPropsPath}`,
  `--frames=0-${totalFrames - 1}`,
  "--codec=h264",
  "--hardware-acceleration=if-possible",
  "--overwrite",
];
if (browserExecutable) renderArgs.push(`--browser-executable=${browserExecutable}`);

const stdout = await withProgressEstimate(
  {
    startProgress: voiceReport ? 82 : 20,
    endProgress: 98,
    message: "영상 파일 렌더링 중",
    estimateSec: Math.max(45, Math.min(240, durationSec * 4)),
  },
  () =>
    runAsync(process.execPath, renderArgs, {
      cwd: windowsLocalPath(renderProjectRoot),
      env: {...process.env},
    }),
);

// 렌더가 "성공한 척" 조용히 끝나는 경우를 잡는다 — 결과 mp4가 없으면 그건 실패다.
// (윈도우에서 브라우저 압축 해제가 멈추면 렌더 프로세스가 오류 없이 종료 코드 0으로 죽는다)
if (!existsSync(renderOutputPath)) {
  const tail = stdout.split(/\r?\n/).filter(Boolean).slice(-5).join("\n");
  throw new Error(
    [
      "영상 렌더링이 결과 파일을 만들지 못한 채 끝났습니다.",
      "터미널에 '진단 --week=2' 를 입력해 상태를 확인한 뒤, '영상만들기' 를 다시 실행해주세요.",
      tail ? `마지막 렌더 로그:\n${tail}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

if (renderOutputPath !== outputPath) {
  mkdirSync(path.dirname(outputPath), {recursive: true});
  copyFileSync(renderOutputPath, outputPath);
}

// 완성영상은 [02_2주차_쇼핑숏폼자동화/완성영상] 폴더에 `제품번호_제품명(_쿠팡/네이버)_완성영상.mp4`로 저장한다.
// (진현님 확정: 완성본은 완성영상 폴더 한곳에, 알아보기 쉬운 이름으로. 재제작하면 같은 이름에 덮어쓴다.)
let finishedProductNo = String(renderTimeline.productNo || "");
if (!finishedProductNo) {
  try {
    const sc = JSON.parse(readFileSync(path.join(jobRoot, "source-clips.json"), "utf8"));
    finishedProductNo = String(sc.productNo || "");
  } catch {
    finishedProductNo = "";
  }
}
const finishedDir = path.join(studentRoot(projectRoot), FINISHED_VIDEO_DIR);
const finishedName = `${finishedProductNo ? `${finishedProductNo}_` : ""}${safeFilePart(renderTimeline.productName)}${variantSuffix}_완성영상.mp4`;
let finishedPath = null;
try {
  mkdirSync(finishedDir, {recursive: true});
  finishedPath = path.join(finishedDir, finishedName);
  // 복사 소스를 견고하게 찾는다: 예상 경로 → 렌더 폴더에서 방금 만들어진 최신 mp4 순서로.
  let copySource = [outputPath, renderOutputPath].find((candidate) => candidate && existsSync(candidate));
  if (!copySource && existsSync(renderDir)) {
    // 이번 렌더(jobId+variant 접두)의 파일만 폴백 후보로 삼는다 — 다른 상품/다른 버전 파일 오채택 방지.
    const prefix = `${jobPaths.jobId}${asciiVariant}`;
    const recent = readdirSync(renderDir)
      .filter((file) => file.toLowerCase().endsWith(".mp4") && file.startsWith(prefix))
      .map((file) => ({file, mtime: statSync(path.join(renderDir, file)).mtimeMs}))
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (recent && Date.now() - recent.mtime < 10 * 60 * 1000) copySource = path.join(renderDir, recent.file);
  }
  if (!copySource) throw new Error(`렌더 결과 mp4를 찾지 못했습니다 (${outputPath})`);
  copyFileSync(copySource, finishedPath);
  console.log(`[완성영상] 저장 완료: ${windowsLocalPath(finishedPath)}`);
} catch (error) {
  finishedPath = null;
  // 실패를 조용히 넘기지 않는다 — 원인을 화면에 보여줘야 고칠 수 있다.
  console.warn(`[경고] 완성영상 폴더 저장에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
  console.warn(`  시도한 위치: ${windowsLocalPath(path.join(finishedDir, finishedName))}`);
  console.warn(`  영상 원본은 여기 있습니다: ${windowsLocalPath(outputPath)}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  outputPath,
  finishedPath,
  outputFile,
  propsPath,
  exportQuality,
  durationSec,
  totalFrames,
  voiceRegenerated: Boolean(voiceReport),
  voiceReport,
  remotionStdoutTail: stdout.split("\n").slice(-20),
};
writeFileSync(lastRenderPath, JSON.stringify(report, null, 2), "utf8");

reportProgress({
  status: "done",
  message: "완성되었습니다",
  progress: 100,
});

if (hasFlag("--json")) {
  process.stdout.write(JSON.stringify(report));
} else {
  console.log(`편집기 렌더 완료: ${outputPath}`);
}
}

main().catch((error) => {
  const message = error?.message || String(error);
  reportProgress({
    status: "error",
    message,
    progress: 0,
  });
  console.error("");
  console.error("[안내] 영상 만들기가 중간에 멈췄습니다.");
  console.error(message);
  console.error("");
  process.exit(1);
});
