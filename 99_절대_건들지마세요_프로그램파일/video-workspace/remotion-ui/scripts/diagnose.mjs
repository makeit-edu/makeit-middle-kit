// 문제 진단 스크립트 (00_문제진단 파일이 실행)
// 프로그램이 이상할 때 더블클릭 한 번으로 환경·파일·인코딩 상태를 점검하고
// 프로젝트 폴더에 "문제진단결과.txt"를 만들어 준다. (이 파일만 공유하면 원인 파악 가능)
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import path from "node:path";
import {
  FINISHED_VIDEO_DIR,
  VIDEO_INBOX_DIR,
  looksMojibake,
  programRoot,
  projectRootFromScript,
  readTextSmart,
  resolveJobPaths,
  studentRoot,
} from "./job-config.mjs";
import {headlessShellReady} from "./ensure-headless-shell.mjs";

const projectRoot = projectRootFromScript(import.meta.url);
const lines = [];
const log = (s = "") => {
  lines.push(s);
  console.log(s);
};

function safeList(dir, limit = 20) {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith(".")).slice(0, limit);
  } catch {
    return null;
  }
}

function encodingOf(filePath) {
  try {
    const buf = readFileSync(filePath);
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "UTF-16LE (문제 가능)";
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "UTF-16BE (문제 가능)";
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "UTF-8 BOM";
    const text = buf.toString("utf8");
    if ((text.match(/�/g) || []).length > 5) return "UTF-8 아님 (CP949 추정 — 문제!)";
    return "UTF-8";
  } catch (error) {
    return `읽기 실패: ${error.message}`;
  }
}

log("==================================================");
log(" 메킷허브 2주차 문제 진단 결과");
log(` 생성 시각: ${new Date().toLocaleString("ko-KR")}`);
log("==================================================");
log("");

// 1. 환경
log("[1] 환경");
log(`  운영체제: ${process.platform} (${process.arch})`);
log(`  Node.js: ${process.version}`);
log(`  프로그램 폴더: ${projectRoot}`);
const sRoot = studentRoot(projectRoot);
log(`  프로젝트 루트: ${sRoot}`);
log(`  프로그램 루트: ${programRoot(projectRoot)}`);
log("");

// 2. 필수 구성
log("[2] 필수 구성");
const checks = [
  ["node_modules (01 설치)", path.join(projectRoot, "node_modules")],
  ["편집기 index.html", path.join(projectRoot, "editor", "index.html")],
  ["BGM 곡", path.join(projectRoot, "public", "bgm", "mixkit-beautiful-dream-493.mp3")],
  ["영상넣는곳", path.join(sRoot, VIDEO_INBOX_DIR)],
  ["완성영상 폴더", path.join(sRoot, FINISHED_VIDEO_DIR)],
];
for (const [name, p] of checks) log(`  ${existsSync(p) ? "O" : "X"} ${name}`);
// 렌더용 브라우저 — 압축이 중간에 깨진 채 남는 윈도우 함정이 있어 exe까지 확인한다
const shellOk = headlessShellReady(projectRoot);
log(`  ${shellOk ? "O" : "X"} 영상 제작용 브라우저 (Headless Shell)${shellOk ? "" : " — '영상만들기' 를 실행하면 자동으로 다시 설치됩니다"}`);
const envLocal = [path.join(sRoot, ".env.local"), path.join(programRoot(projectRoot), ".env.local")].find((p) => existsSync(p));
if (envLocal) {
  const env = readFileSync(envLocal, "utf8");
  log(`  O .env.local (OpenAI키:${/OPENAI_API_KEY=\S{10,}/.test(env) ? "입력됨" : "비어있음"}, ElevenLabs키:${/ELEVENLABS_API_KEY=\S{10,}/.test(env) ? "입력됨" : "비어있음"})`);
} else {
  log("  X .env.local (터미널에 '키설정' 을 입력해주세요)");
}
log("");

// 3. 현재 작업
log("[3] 현재 작업");
const jobPaths = resolveJobPaths(projectRoot);
log(`  현재 작업: ${jobPaths.jobId}`);
const scPath = path.join(jobPaths.jobRoot, "source-clips.json");
if (existsSync(scPath)) {
  try {
    const sc = JSON.parse(readFileSync(scPath, "utf8"));
    log(`  상품: ${sc.productNo} ${sc.productName || ""}`);
    log(`  제품 폴더: ${sc.inputDir || "(없음)"} ${sc.inputDir && existsSync(sc.inputDir) ? "(존재)" : "(경로 확인 필요)"}`);
  } catch {
    log("  source-clips.json 읽기 실패");
  }
} else {
  log("  (작업 없음 — 터미널에 '새상품 <상품번호>' 를 먼저 입력)");
}
log("");

// 4. 기획안 파일 상태 (가장 자주 문제 되는 곳)
log("[4] 기획안 파일");
let planFound = false;
if (existsSync(scPath)) {
  try {
    const sc = JSON.parse(readFileSync(scPath, "utf8"));
    for (const dir of [...new Set([sc.planningDir, sc.inputDir])]) {
      if (!dir || !existsSync(dir)) continue;
      for (const n of readdirSync(dir)) {
        if (!/(기획|계획)안\.txt$/.test(n.normalize("NFC"))) continue;
        planFound = true;
        const full = path.join(dir, n);
        const enc = encodingOf(full);
        const text = readTextSmart(full);
        const broken = looksMojibake(text);
        const labels = ["후킹:", "대본:", "자막:", "TTS:", "CTA:"].map((l) => `${l.slice(0, -1)}${text.includes(l) ? "O" : "X"}`).join(" ");
        const candidates = (text.match(/\[(?:후보|추천안)\s*[123]/g) || []).length;
        log(`  파일: ${n.normalize("NFC")}`);
        log(`  인코딩: ${enc}${broken ? "  << 한글 깨짐 감지!" : ""}`);
        log(`  라벨: ${labels} | 후보 ${candidates}개`);
        if (broken || enc.includes("문제")) {
          log("  → 조치: 코덱스에서 기획안을 다시 만들어 주세요 (UTF-8 저장 안내 포함된 v3.0.7 프롬프트 사용)");
        }
      }
    }
  } catch {
    log("  기획안 확인 실패");
  }
}
if (!planFound) log("  (기획안 txt 없음 — 코덱스로 아직 안 만들었거나 다른 위치에 저장됨)");
log("");

// 5. 완성영상
log("[5] 완성영상 폴더");
const doneList = safeList(path.join(sRoot, FINISHED_VIDEO_DIR));
if (doneList && doneList.length > 0) doneList.forEach((n) => log(`  - ${n.normalize("NFC")}`));
else log("  (비어 있음)");
log("");

// 6. 최근 렌더 기록
log("[6] 최근 렌더 기록");
const lastRenderPath = path.join(jobPaths.timelineDir, "last-render.json");
if (existsSync(lastRenderPath)) {
  try {
    const r = JSON.parse(readFileSync(lastRenderPath, "utf8"));
    log(`  시각: ${r.generatedAt || "?"}`);
    log(`  완성영상 복사: ${r.finishedPath ? "성공 → " + r.finishedPath : "실패 또는 미기록"}`);
  } catch {
    log("  기록 읽기 실패");
  }
} else {
  log("  (아직 렌더 기록 없음)");
}
log("");
log("==================================================");
log(" 진단 끝 — 이 내용이 '문제진단결과.txt' 파일로 저장되었습니다.");
log(" 문제가 있으면 그 파일을 그대로 공유해 주세요.");
log("==================================================");

// UTF-8 BOM으로 저장 (윈도우 메모장 호환)
const outPath = path.join(sRoot, "문제진단결과.txt");
writeFileSync(outPath, "﻿" + lines.join("\r\n"), "utf8");
