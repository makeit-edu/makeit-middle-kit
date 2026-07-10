#!/usr/bin/env node

// 내보내기 (npm run video:export) — 완성영상 폴더의 mp4를 zip 하나로 묶는다. (PRD 4-3 6단계·5-6)
// 수강생은 zip 파일 하나만 우클릭 → Download 하면 완성영상 여러 개를 한 번에 내려받을 수 있다.
// zip은 .gitignore(*.zip) 대상이라 커밋되지 않는다 — 다운로드 후 '정리'로 지워도 된다.
import {execFileSync} from "node:child_process";
import {existsSync, readdirSync, statSync, unlinkSync} from "node:fs";
import path from "node:path";
import {PROJECT_ROOT} from "./lib/env.mjs";

const finishedDir = path.join(PROJECT_ROOT, "02_2주차_쇼핑숏폼자동화", "완성영상");

function fail(lines) {
  console.error("");
  for (const line of [].concat(lines)) console.error(line);
  console.error("");
  process.exit(1);
}

if (!existsSync(finishedDir)) {
  fail(["완성영상 폴더가 없습니다. 먼저 '영상만들기' 로 영상을 만들어주세요."]);
}

const videos = readdirSync(finishedDir)
  .filter((name) => name.toLowerCase().endsWith(".mp4"))
  .sort();

if (videos.length === 0) {
  fail([
    "완성영상 폴더에 mp4 파일이 없습니다.",
    "먼저 '영상만들기' 로 영상을 만든 뒤 다시 '내보내기' 를 실행해주세요.",
  ]);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
const zipName = `완성영상_모음_${stamp}.zip`;
const zipPath = path.join(finishedDir, zipName);

console.log("");
console.log(`완성영상 ${videos.length}개를 zip 하나로 묶는 중...`);
for (const name of videos) console.log(`  - ${name}`);

try {
  // -j: 폴더 구조 없이 파일만 담는다 (수강생이 풀었을 때 바로 영상이 보이도록)
  execFileSync("zip", ["-q", "-j", zipPath, ...videos.map((name) => path.join(finishedDir, name))], {
    stdio: ["ignore", "inherit", "inherit"],
  });
} catch (error) {
  if (existsSync(zipPath)) {
    try {
      unlinkSync(zipPath);
    } catch {
      // 정리 실패는 무시
    }
  }
  fail([
    "zip 묶기에 실패했습니다.",
    String(error && error.message ? error.message : error).trim(),
    "이 출력을 복사해 문의 채널에 올려주세요. (파일은 하나씩 우클릭 → Download 로도 받을 수 있어요)",
  ]);
}

const sizeMb = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log("");
console.log(`[OK] 묶기 완료: 02_2주차_쇼핑숏폼자동화/완성영상/${zipName} (${sizeMb}MB)`);
console.log("왼쪽 탐색기에서 이 zip 파일을 우클릭 → Download 하면 한 번에 내려받을 수 있어요.");
console.log("다운로드가 끝나면 터미널에 '정리' 를 입력해 공간을 확보하세요.");
