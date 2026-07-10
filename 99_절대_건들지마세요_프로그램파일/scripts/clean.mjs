#!/usr/bin/env node

// 정리 (npm run clean) — 영상 작업의 중간 산출물과 다운로드가 끝난 완성영상을 대화형으로 삭제해
// Codespaces 스토리지(15GB-month)를 확보한다. (PRD 5-7)
// 삭제 전 반드시 목록을 보여주고 확인을 받으며, 완성영상은 "다운로드했는지" 한 번 더 묻는다.
import {execFileSync} from "node:child_process";
import {existsSync, readdirSync, rmSync, statSync} from "node:fs";
import path from "node:path";
import {stdin as input, stdout as output} from "node:process";
import readline from "node:readline/promises";
import {PROGRAM_ROOT, PROJECT_ROOT} from "./lib/env.mjs";

const remotionUiDir = path.join(PROGRAM_ROOT, "video-workspace", "remotion-ui");
const week2Dir = path.join(PROJECT_ROOT, "02_2주차_쇼핑숏폼자동화");

// 폴더/파일의 전체 크기 (바이트)
function sizeOf(targetPath) {
  try {
    const stat = statSync(targetPath);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return readdirSync(targetPath).reduce((sum, name) => sum + sizeOf(path.join(targetPath, name)), 0);
  } catch {
    return 0;
  }
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

// 폴더 바로 아래 항목들을 삭제 후보로 수집한다 (.gitkeep은 보존)
function listChildren(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter((name) => name !== ".gitkeep" && name !== ".DS_Store")
    .map((name) => {
      const fullPath = path.join(dirPath, name);
      return {name, path: fullPath, size: sizeOf(fullPath)};
    })
    .filter((item) => item.size > 0)
    .sort((a, b) => b.size - a.size);
}

// 완성영상(작업 폴더 안 editor_outputs)의 mp4들
function listJobOutputs() {
  const jobsRoot = path.join(remotionUiDir, "jobs");
  if (!existsSync(jobsRoot)) return [];
  const items = [];
  for (const jobId of readdirSync(jobsRoot)) {
    const outDir = path.join(jobsRoot, jobId, "render", "editor_outputs");
    if (!existsSync(outDir)) continue;
    for (const file of readdirSync(outDir)) {
      if (!file.endsWith(".mp4")) continue;
      const fullPath = path.join(outDir, file);
      items.push({name: `${jobId}/${file}`, path: fullPath, size: sizeOf(fullPath)});
    }
  }
  return items.sort((a, b) => b.size - a.size);
}

// 삭제 후보 그룹 정의 — needsDownloadCheck가 true면 "다운로드했는지" 한 번 더 확인
const groups = [
  {
    title: "영상 중간 산출물 (원본 이어붙임·씬 이미지·렌더 임시본)",
    detail: "영상이 이미 완성된 작업이라면 지워도 다시 만들 수 있어요.",
    needsDownloadCheck: false,
    items: listChildren(path.join(remotionUiDir, "public", "jobs")),
  },
  {
    title: "완성영상 (작업 폴더 안)",
    detail: "편집기에서 만든 완성본이에요. 컴퓨터로 다운로드한 뒤에만 지워주세요.",
    needsDownloadCheck: true,
    items: listJobOutputs(),
  },
  {
    title: `완성영상 폴더 (${path.join("02_2주차_쇼핑숏폼자동화", "완성영상")})`,
    detail: "컴퓨터로 다운로드한 뒤에만 지워주세요.",
    needsDownloadCheck: true,
    items: listChildren(path.join(week2Dir, "완성영상")),
  },
  {
    title: `원본 영상 (${path.join("02_2주차_쇼핑숏폼자동화", "영상넣는곳")})`,
    detail: "영상 제작이 끝난 상품의 원본이라면 지워도 됩니다. (아직 작업 중인 상품은 남겨두세요)",
    needsDownloadCheck: false,
    items: listChildren(path.join(week2Dir, "영상넣는곳")),
  },
  {
    title: "내보내기 묶음 (video-workspace/exports)",
    detail: "다운로드용으로 묶어둔 zip이에요. 이미 받았다면 지워도 됩니다.",
    needsDownloadCheck: true,
    items: listChildren(path.join(PROGRAM_ROOT, "video-workspace", "exports")),
  },
  {
    title: "예전 원본 보관함 (video-workspace/raw-videos)",
    detail: "예전 방식에서 쓰던 원본 보관 폴더예요.",
    needsDownloadCheck: false,
    items: listChildren(path.join(PROGRAM_ROOT, "video-workspace", "raw-videos")),
  },
];

function diskUsageLine() {
  try {
    const out = execFileSync("df", ["-h", PROJECT_ROOT], {encoding: "utf8"}).trim().split("\n");
    const cols = (out[1] || "").split(/\s+/);
    if (cols.length >= 5) return `사용 ${cols[2]} / 전체 ${cols[1]} (사용률 ${cols[4]})`;
  } catch {
    // df를 못 쓰는 환경이면 표시 생략
  }
  return "";
}

console.log("");
console.log("==================================================");
console.log(" 정리 — 영상 중간 산출물을 지워서 저장 공간을 확보합니다");
console.log("==================================================");
const usage = diskUsageLine();
if (usage) console.log(`현재 디스크: ${usage}`);
console.log("삭제 전에 항목별로 확인을 받고, 확인한 것만 지웁니다.");

const totalCandidates = groups.reduce((sum, group) => sum + group.items.length, 0);
if (totalCandidates === 0) {
  console.log("");
  console.log("지울 만한 중간 산출물이 없어요. 저장 공간이 깨끗한 상태입니다!");
  process.exit(0);
}

if (!input.isTTY) {
  console.log("");
  console.log("정리는 물어보면서 지우는 기능이라, 터미널에서 직접 실행해야 해요.");
  console.log("VS Code 아래쪽 터미널 창에서 npm run clean 을 입력해주세요.");
  process.exit(0);
}

const rl = readline.createInterface({input, output});
let freedBytes = 0;
let deletedCount = 0;

for (const group of groups) {
  if (group.items.length === 0) continue;
  const groupSize = group.items.reduce((sum, item) => sum + item.size, 0);

  console.log("");
  console.log(`----- ${group.title} — ${group.items.length}개, ${formatSize(groupSize)} -----`);
  console.log(group.detail);
  for (const item of group.items.slice(0, 15)) {
    console.log(`  - ${item.name} (${formatSize(item.size)})`);
  }
  if (group.items.length > 15) console.log(`  ... 외 ${group.items.length - 15}개`);

  if (group.needsDownloadCheck) {
    const downloaded = (await rl.question("이 영상(파일)들을 컴퓨터로 다운로드해 두셨나요? (y = 네, 받았어요 / 엔터 = 아직): ")).trim().toLowerCase();
    if (downloaded !== "y") {
      console.log("  → 아직 안 받으셨군요. 이 그룹은 건너뛸게요. (다운로드 후 다시 정리를 실행해주세요)");
      continue;
    }
  }

  const answer = (await rl.question(`위 ${group.items.length}개를 삭제할까요? (y = 삭제 / 엔터 = 건너뛰기): `)).trim().toLowerCase();
  if (answer !== "y") {
    console.log("  → 건너뛸게요.");
    continue;
  }

  for (const item of group.items) {
    try {
      rmSync(item.path, {recursive: true, force: true});
      freedBytes += item.size;
      deletedCount += 1;
    } catch (error) {
      console.log(`  [확인 필요] ${item.name} 삭제 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`  → ${formatSize(group.items.reduce((sum, item) => sum + item.size, 0))} 정리 완료`);
}

rl.close();

console.log("");
console.log("==================================================");
if (deletedCount === 0) {
  console.log("이번에는 아무것도 지우지 않았어요.");
} else {
  console.log(`정리 완료! ${deletedCount}개 항목, 총 ${formatSize(freedBytes)}를 확보했습니다.`);
  const after = diskUsageLine();
  if (after) console.log(`현재 디스크: ${after}`);
}
console.log("완성영상은 Codespace가 아니라 내 컴퓨터에 보관하는 게 안전해요. (30일 미접속 시 삭제 정책)");
console.log("==================================================");
