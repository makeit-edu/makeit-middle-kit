// 영상을 만드는 스크립트 (한글 명령 '영상만들기' 가 실행)
//
// 하는 일:
//   1. 수강생이 기획안 txt에서 고른 후보의 [05 영상 만들기용] 블록을 붙여넣으면 그대로 읽어
//   2. 후킹, 자막, CTA, 썸네일 문구를 자동으로 뽑고
//   3. 현재 작업(job)의 타임라인에 자막을 넣은 뒤
//   4. 일레븐랩스로 음성을 만들고 Remotion으로 영상을 렌더링한다 (= 영상 생성)
//   5. 완성본을 [02_2주차_쇼핑숏폼자동화/완성영상] 폴더에 저장하고, 편집기를 자동으로 연다
//
// ※ 영상 생성은 "오직 이 프로그램"이 한다. 코덱스는 기획안 txt와 후보 블록만 만든다.
// ※ 입력은 "전체 붙여넣기" 한 번이면 끝 — 한 줄씩 묻지 않는다.
import {execFileSync, spawn} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import {ensureNodeModules, hideInternalFolders, looksMojibake, projectRootFromScript, readTextSmart, resolveJobPaths, studentRoot, windowsLocalPath} from "./job-config.mjs";
import {requireLicense} from "../../../scripts/lib/env.mjs";

// 진입 게이트: 수강 코드(MAKEIT_MIDDLE_LICENSE) 검증 (PRD D9 — 2주차 실사용 진입 스크립트 공통)
requireLicense({scriptLabel: "영상 만들기"});

const projectRoot = projectRootFromScript(import.meta.url);
ensureNodeModules(projectRoot);

const jobPaths = resolveJobPaths(projectRoot);
const timelinePath = path.join(jobPaths.timelineDir, "timeline.json");
const defaultPropsPath = jobPaths.defaultPropsPath;

if (!existsSync(defaultPropsPath)) {
  console.error("\n[안내] 아직 상품 작업이 없습니다. 먼저 터미널에 '새상품 1' 처럼 상품번호와 함께 입력해 작업을 만들어주세요.\n");
  process.exit(1);
}
mkdirSync(jobPaths.timelineDir, {recursive: true});
if (!existsSync(timelinePath)) copyFileSync(defaultPropsPath, timelinePath);

// 코덱스가 기획안 txt를 엉뚱한 곳에 저장했으면 원본 영상이 있던 제품 폴더로 자동 이동
ensurePlanningFileInProductFolder();
// 코덱스가 만든 .git/.agents 폴더를 탐색기에서 숨긴다
hideInternalFolders(projectRoot);

// 예전 일반 숫자 섹션 형식에서 두 번호 사이의 텍스트를 잘라낸다.
function sliceBetweenNumberedSections(text, startNumber, endNumber) {
  const startPattern = new RegExp(`(^|\\n)\\s*${startNumber}[.)]\\s+`, "m");
  const startMatch = startPattern.exec(text);
  if (!startMatch) return "";
  const i = startMatch.index + startMatch[0].length;
  const endPattern = new RegExp(`(^|\\n)\\s*${endNumber}[.)]\\s+`, "m");
  const endMatch = endPattern.exec(text.slice(i));
  return text.slice(i, endMatch ? i + endMatch.index : undefined);
}

function sliceBetweenTextMarkers(text, startMarker, endMarker) {
  const i = text.indexOf(startMarker);
  if (i < 0) return "";
  const j = text.indexOf(endMarker, i + startMarker.length);
  return text.slice(i + startMarker.length, j < 0 ? undefined : j);
}

function fieldValue(parts) {
  return (parts || []).join("\n").trim();
}

function cleanSingleLineValue(text) {
  return String(text || "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function sameCtaFamily(left, right) {
  const a = String(left || "").replace(/\s+/g, "");
  const b = String(right || "").replace(/\s+/g, "");
  if (!a || !b) return false;
  return a === b || (a.includes("프로필링크") && b.includes("프로필링크"));
}

function splitTextLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .map((s) => s.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean);
}

function yesNoValue(text) {
  const value = String(text || "").trim();
  if (/아니오|아니요|no|false|없음|불필요/i.test(value)) return false;
  return /예|yes|true|필요|있음/i.test(value);
}

// ---- 기획안 저장 위치 안전망 ----
// 코덱스가 기획안 txt를 엉뚱한 곳(jobs 폴더 등)에 저장했으면, 원본 영상이 있던 제품 폴더
// 바로 아래(source-clips.json의 mustSavePlanningFileHere)로 자동으로 옮긴다.
// 못 찾으면 영상 제작은 그대로 진행한다(05는 붙여넣은 블록만으로 동작).
function findPlanningTxt(dir, pattern, results, seen, depth) {
  if (depth > 4 || !existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      findPlanningTxt(full, pattern, results, seen, depth + 1);
    } else if (pattern.test(entry.name.normalize("NFC")) && !seen.has(full)) {
      seen.add(full);
      results.push(full);
    }
  }
}

function ensurePlanningFileInProductFolder() {
  const scPath = path.join(jobPaths.jobRoot, "source-clips.json");
  if (!existsSync(scPath)) return;
  let sc;
  try {
    sc = JSON.parse(readFileSync(scPath, "utf8"));
  } catch {
    return;
  }
  const target = sc.mustSavePlanningFileHere || sc.planningFilePath;
  const planningDir = sc.planningDir;
  const productNo = String(sc.productNo || "");
  if (!target || !planningDir || !productNo) return;
  if (existsSync(target)) return; // 이미 제품 폴더에 정상 저장됨

  // 코덱스가 다른 곳에 저장한 기획안 txt를 찾는다 (번호_..._기획안.txt — 구 형식 쇼핑숏폼_기획안도 포함)
  const pattern = new RegExp(`^${productNo}_.*(기획|계획)안\\.txt$`); // 코덱스가 "계획안"으로 살짝 바꿔 저장하는 경우도 잡는다
  const results = [];
  const seen = new Set();
  for (const root of [jobPaths.jobRoot, path.join(projectRoot, "jobs"), studentRoot(projectRoot)]) {
    findPlanningTxt(root, pattern, results, seen, 0);
  }
  if (results.length === 0) return; // 못 찾으면 조용히 진행

  try {
    mkdirSync(planningDir, {recursive: true});
    copyFileSync(results[0], target);
    console.log(`\n[정리] 기획안을 제품 폴더로 옮겼습니다:\n  ${windowsLocalPath(target)}\n`);
  } catch {
    // 이동 실패해도 영상 제작은 계속 진행
  }
}

function parseSelectedVideoBlock(text) {
  const source = text;
  const labels = new Map([
    ["후킹", "hook"],
    ["대본", "script"],
    ["자막", "captions"],
    ["TTS", "tts"],
    ["CTA", "cta"],
    ["썸네일 문구", "thumb"],
    ["광고 표시", "ad"],
    ["가상인물 표시 필요", "virtualPerson"],
    ["가상인물 판단 이유", "virtualPersonReason"],
  ]);
  const fields = {};
  // 코덱스가 상황:/문제:/반전: 같은 잘못된 라벨을 만들어도 그 뒤의 "실제 문장"은 살려서
  // 자막으로 쓸 수 있게 모아둔다. (메타 정보성 라벨은 제외)
  const unknownSentences = [];
  const metaLabelPattern = /썸네일|광고|가상|인물|판단|기준|저장|위치|링크|상품|번호|리스크|표시|AI|메모|이미지|배경/i;
  let current = "";
  let matched = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([^:：]{1,32})[:：]\s*(.*)$/.exec(line);
    if (match) {
      const label = match[1].trim();
      const key = labels.get(label);
      if (key) {
        matched = true;
        current = key;
        fields[current] = [match[2].trim()].filter(Boolean);
        continue;
      }
      if (!metaLabelPattern.test(label)) {
        const value = match[2].trim();
        if (value) unknownSentences.push(value);
      }
      current = "";
      continue;
    }
    if (current) fields[current].push(line);
  }
  if (!matched || (!fields.hook && !fields.captions && !fields.cta)) return null;

  const script = fieldValue(fields.script);
  const tts = fieldValue(fields.tts);
  let captions = splitTextLines(fieldValue(fields.captions));
  if (captions.length === 0) captions = splitTextLines(tts);
  if (captions.length === 0) captions = splitTextLines(script);
  if (captions.length === 0 && unknownSentences.length > 0) {
    // 잘못된 라벨(상황:/문제: 등)에서 건진 문장으로 자막을 복구한다.
    captions = unknownSentences.slice();
    console.log("[정리] 기획안 형식이 어긋나 있어서, 문장만 뽑아 자막으로 복구했습니다.");
  }
  const cta = cleanSingleLineValue(fieldValue(fields.cta));
  if (cta && captions.length > 0 && sameCtaFamily(captions.at(-1), cta)) {
    captions = captions.slice(0, -1);
  }
  // 후킹은 반드시 '첫 문장 1개'만 쓴다. 코덱스가 후킹: 아래에 대본 전체를 반복해서 넣는
  // 사고가 실제로 있었고(7문장), 그대로 두면 12초짜리 통짜 자막+음성이 앞에 붙어
  // 같은 내용이 두 번 재생되는 영상이 된다.
  const hookLines = splitTextLines(fieldValue(fields.hook));
  const hookText = cleanSingleLineValue(hookLines[0] || "");
  if (hookLines.length > 1) {
    console.log("[정리] 후킹에 여러 문장이 들어 있어서 첫 문장만 사용했습니다.");
  }
  // 후킹 문장이 자막 1번째 줄과 같으면 중복 재생(같은 문장 2번)을 막기 위해 자막에서 뺀다.
  if (hookText && captions.length > 0 && hookText.replace(/\s+/g, "") === captions[0].replace(/\s+/g, "")) {
    captions = captions.slice(1);
  }

  return {
    hook: hookText,
    captions,
    cta,
    thumb: cleanSingleLineValue(fieldValue(fields.thumb)),
    adText: yesNoValue(fieldValue(fields.virtualPerson)) ? "광고\n가상인물" : "광고",
    virtualPerson: yesNoValue(fieldValue(fields.virtualPerson)),
  };
}

// 예전 일반 숫자 답변에서 후킹/자막/CTA/썸네일을 뽑아낸다.
function parseNumberedCodexAnswer(text) {
  const lines = (block) => block.split(/\r?\n/).map((s) => s.trim());

  const captions = lines(sliceBetweenNumberedSections(text, "3", "4"))
    .filter((s) => s && !s.startsWith("-") && !s.startsWith("※") && !/^\(/.test(s) && !s.includes("자막") && !/^\d+[.)]/.test(s));

  const cta = lines(sliceBetweenNumberedSections(text, "5", "6"))
    .filter((s) => s && !s.startsWith("-") && !s.startsWith("※") && !s.includes("CTA"))[0] || "";

  const thumb = lines(sliceBetweenNumberedSections(text, "6", "7"))
    .filter((s) => s && !s.startsWith("-") && !s.startsWith("※") && !s.includes("썸네일"))[0] || "";

  const hookLines = lines(sliceBetweenNumberedSections(text, "1", "2"))
    .filter((s) => s && !s.includes("후킹") && !s.startsWith("※") && !s.startsWith("→") && !s.startsWith("-") && !/^\(/.test(s));
  let hook = (hookLines[0] || "")
    .replace(/^[^—:\-]{0,12}[—:\-]\s*/, "")
    .replace(/^["'“”']|["'“”']$/g, "")
    .trim();

  return {hook, captions, cta, thumb, adText: "광고", virtualPerson: false};
}

// 썸네일 문구(한 줄)를 화면에서 안 잘리게 두 줄로 균형 분할한다
function splitTwoLines(text) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length <= 7) return t; // 짧으면 한 줄 그대로
  const mid = t.length / 2;
  const spaces = [];
  for (let k = 0; k < t.length; k += 1) if (t[k] === " ") spaces.push(k);
  if (spaces.length === 0) {
    const c = Math.ceil(mid);
    return `${t.slice(0, c)}\n${t.slice(c)}`;
  }
  let best = spaces[0];
  for (const s of spaces) if (Math.abs(s - mid) < Math.abs(best - mid)) best = s;
  return `${t.slice(0, best)}\n${t.slice(best + 1)}`;
}

// 붙여넣은 여러 줄 텍스트를 받는다. 마지막 입력 후 잠깐(0.8초) 멈추면 끝난 걸로 본다.
// → 수강생은 "전체 복사 → 붙여넣기"만 하면 되고, 종료 키를 누를 필요가 없다.
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
      timer = setTimeout(finish, 800);
    };
    rl.on("line", onLine);
    rl.on("close", finish);
  });
}

// ---- 기획안 자동 인식 (제품 폴더에 기획안이 있으면 붙여넣기 없이 유형만 고르게 한다) ----
// 진현님 방침: 자동 인식이 안 되면 억지로 하지 말고 기존 "복사 붙여넣기"로 폴백한다.
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
    // 기획안을 못 읽으면 그냥 붙여넣기로 간다.
  }
  return null;
}

function splitPlanCandidates(planText) {
  const re = /\[(?:후보|추천안)\s*([123])\s*[:：]?\s*([^\]]*)\]/g;
  const marks = [];
  let m;
  while ((m = re.exec(planText))) marks.push({num: m[1], label: (m[2] || "").trim(), idx: m.index});
  return marks
    .map((mk, i) => ({
      num: mk.num,
      label: mk.label,
      body: planText.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : undefined),
    }))
    // "[후보 한눈에 보기]" 요약처럼 실제 작업 블록이 없는 항목은 후보로 치지 않는다.
    .filter((c) => c.body.includes("[05 영상 만들기용]") || c.body.includes("[04 이미지 만들기용]"));
}

function extractVideoBlockFromCandidate(body) {
  const i = body.indexOf("[05 영상 만들기용]");
  return i >= 0 ? body.slice(i) : body;
}

console.log("");
console.log("==================================================");
console.log(` 영상 만들기 — 현재 작업: ${jobPaths.jobId}`);
console.log("==================================================");
console.log("");

const rl = readline.createInterface({input: process.stdin, output: process.stdout});

// 기획안 txt가 제품 폴더에 있으면 자동으로 읽어 "유형만" 고르게 한다. 없거나 인식이 안 되면 붙여넣기로 폴백.
let pasted = null;
const planText = loadPlanningText();
const candidates = planText ? splitPlanCandidates(planText) : [];
if (candidates.length > 0) {
  console.log("기획안을 찾았어요. 어떤 유형으로 만들까요?");
  candidates.forEach((c) => console.log(`  ${c.num}. ${c.label || `후보 ${c.num}`}`));
  console.log("  4. 기획안 직접 붙여넣기 (찾은 기획안을 그대로 쓰지 않을 때)");
  console.log("");
  let pick = null;
  let manualPaste = false;
  try {
    const nums = candidates.map((c) => c.num).join("/");
    const ans = (await rl.question(`유형 번호를 입력하세요 (${nums}/4, 엔터=${candidates[0].num}번): `)).trim();
    if (ans === "4") {
      manualPaste = true;
    } else {
      pick = candidates.find((c) => c.num === ans);
      if (ans && !pick) console.log(`  (${ans}번 후보가 없어 ${candidates[0].num}번으로 진행합니다)`);
      pick = pick || candidates[0];
    }
  } catch {
    if (!manualPaste) pick = candidates[0];
  }
  if (manualPaste) {
    console.log("\n직접 붙여넣기 모드로 진행합니다.\n");
  } else if (pick) {
    pasted = extractVideoBlockFromCandidate(pick.body);
    console.log(`\n[${pick.label || `후보 ${pick.num}`}] 유형으로 만듭니다.\n`);
  }
}
if (pasted === null) {
  console.log("기획안 txt에서 선택한 후보의 [05 영상 만들기용] 블록을 복사한 뒤, 이 창에 그대로 붙여넣어 주세요.");
  console.log("예전 일반 숫자 형식의 코덱스 답변도 사용할 수 있습니다.");
  console.log("(붙여넣고 1~2초만 기다리면 자동으로 인식합니다. 한 줄씩 입력할 필요 없어요.)");
  console.log("");
  pasted = await readPastedText(rl);
}
const {hook, captions, cta, thumb, adText, virtualPerson} = parseSelectedVideoBlock(pasted) || parseNumberedCodexAnswer(pasted);

if (captions.length === 0) {
  rl.close();
  console.log("");
  console.log("[안내] 기획안에서 자막을 찾지 못했습니다. 이 기획안은 잘못 만들어진 상태입니다.");
  console.log("");
  console.log("보통 코덱스에 붙여넣은 프롬프트 한글이 깨져서 생기는 문제입니다. 이렇게 해결하세요:");
  console.log("  1. 코덱스에 아래 한 줄을 그대로 입력해서 기획안을 다시 만들어 주세요.");
  console.log(`     Read the file jobs/${jobPaths.jobId}/codex-folder-prompt.txt in this workspace and follow its instructions exactly.`);
  console.log("  2. 새 기획안이 만들어지면 터미널에 '영상만들기' 를 다시 입력하세요.");
  console.log("");
  process.exit(0);
}

console.log("");
console.log("붙여넣은 내용을 읽었어요. 이렇게 뽑았습니다:");
console.log("");
if (hook) console.log(`  [1. 후킹]   ${hook}`);
console.log(`  [자막]      ${captions.length}줄`);
captions.forEach((c, i) => console.log(`     ${i + 1}. ${c}`));
if (cta) console.log(`  [CTA]       ${cta}`);
if (cta) console.log("  [추가 CTA]  왼쪽아래 링크를 클릭 후 / 지금 바로 / 확인하세요 :)");
if (thumb) console.log(`  [썸네일]    ${thumb}`);
console.log(`  [표시]      ${virtualPerson ? "광고 + 가상인물" : "광고"}`);
console.log("");

// 대본이 짧으면 완성 영상이 20초 목표에 못 미친다 — 렌더 전에 미리 알려준다.
// (음성 1.2배속 기준 실측 약 8.5자/초 + 쿠팡 CTA 화면 3초 + 썸네일 0.6초)
const spokenChars = [hook, ...captions, cta].join("").replace(/\s+/g, "").length;
const estimatedSec = Math.round(spokenChars / 8.5 + 3.6);
if (estimatedSec < 19) {
  console.log(`[주의] 대본이 짧아 완성 영상이 약 ${estimatedSec}초로 예상됩니다 (목표 20~35초).`);
  console.log("       더 긴 영상을 원하면 코덱스로 기획안을 다시 만들어 주세요 (본문 8문장·150~200자 기준).");
  console.log("       이대로 진행해도 영상은 정상적으로 만들어집니다.");
  console.log("");
}

let ok = "";
// 파이프 입력(비대화형)에서는 rl.question이 영원히 기다리기만 하므로(닫힌 stdin에서
// reject되지 않는 Node 동작) 터미널일 때만 물어보고, 아니면 그대로 진행한다.
if (process.stdin.isTTY) {
  try {
    ok = (await rl.question("이대로 영상 만들까요? (맞으면 엔터 / 다시 붙여넣으려면 n): ")).trim().toLowerCase();
  } catch {
    ok = "";
  }
} else {
  console.log("(비대화형 입력이라 확인 질문 없이 그대로 진행합니다)");
}
rl.close();
if (ok === "n" || ok === "no") {
  console.log("\n취소했습니다. 기획안 txt에서 선택한 후보 블록을 다시 복사해서 터미널에 '영상만들기' 를 다시 입력해주세요.\n");
  process.exit(0);
}

// ---- 타임라인에 자막 주입 ----
// startSec/endSec=0 → render의 minDisplayDuration이 0.4가 되어 자막 표시가 음성 길이를 그대로 따라간다(싱크 일치).
const timeline = JSON.parse(readFileSync(timelinePath, "utf8"));
const built = [];
if (hook) built.push({text: hook, startSec: 0, endSec: 0, emphasis: true, variant: "caption"});
captions.forEach((text) => {
  built.push({text, startSec: 0, endSec: 0, variant: "caption"});
});
if (cta) {
  built.push({text: cta, startSec: 0, endSec: 0, variant: "cta"});
}
timeline.captions = built;
timeline.hook = hook || timeline.hook || "";
timeline.adBadge = {
  ...(timeline.adBadge || {}),
  text: adText || "광고",
  position: "top-right",
};
if (thumb) {
  // 썸네일 문구를 두 줄로 나눠 화면에서 잘리지 않게 크게 보여준다.
  const headline = splitTwoLines(thumb);
  const longest = Math.max(...headline.split("\n").map((l) => l.length));
  const fontSize = longest <= 9 ? 132 : longest <= 12 ? 112 : 96;
  timeline.thumbnailTail = {
    ...(timeline.thumbnailTail || {durationSec: 0.6}),
    headline,
    headlineFontSize: fontSize,
  };
}
timeline.editorNotes = {...(timeline.editorNotes || {}), voiceRegenerationRequested: true};
writeFileSync(timelinePath, JSON.stringify(timeline, null, 2), "utf8");

console.log("");
console.log(`자막 ${built.length}줄을 영상에 넣었습니다. 이제 음성을 만들고 영상을 제작합니다.`);
console.log("(일레븐랩스 음성 생성 + 영상 렌더링 — 2~5분 정도 걸립니다)");
console.log("");

// ---- 영상 생성 (음성 + 렌더) — 쿠팡용/네이버용 영상 파일 2개를 만든다 ----
// render-editor-timeline이 timeline.json을 덮어쓰므로, 원본을 백업해 각 버전마다 깨끗하게 복원한다.
// (본문 음성은 세그먼트 캐시로 공유되고, 버전별로 다른 건 마지막 CTA 문장뿐이라 두 번째는 빠르다.)
const timelineBackup = readFileSync(timelinePath, "utf8");
try {
  // 순서: 네이버 → 쿠팡. 마지막(쿠팡) 상태가 timeline.json에 남아야 편집기에서 다시 만들 때
// CTA가 원래 문구(프로필 링크)로 유지된다. (네이버가 마지막이면 CTA가 네이버 문구로 굳는다)
for (const variant of ["naver", "coupang"]) {
    writeFileSync(timelinePath, timelineBackup, "utf8");
    console.log("");
    console.log(`[${variant === "coupang" ? "쿠팡용" : "네이버용"}] 영상 만드는 중...`);
    execFileSync(
      process.execPath,
      [windowsLocalPath(path.join(projectRoot, "scripts", "render-editor-timeline.mjs")), "--variant", variant],
      {cwd: windowsLocalPath(projectRoot), stdio: "inherit"},
    );
  }
} catch {
  console.log("");
  console.log("[안내] 영상 제작이 중간에 멈췄습니다. [02_2주차_쇼핑숏폼자동화/완성영상] 폴더를 확인해보세요 — 일부 영상은 이미 완성됐을 수 있습니다.");
  process.exit(1);
}

console.log("");
console.log("완료! 쿠팡용·네이버용 영상 2개가 [02_2주차_쇼핑숏폼자동화/완성영상] 폴더에 저장됐습니다.");
console.log("이제 편집기를 자동으로 켭니다...");
// 편집기 서버(node)를 직접 켠다 — Codespaces/맥/윈도우 공통. 브라우저 접속은 아래 안내 기준.
try {
  spawn(process.execPath, [path.join(projectRoot, "scripts", "editor-server.mjs")], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
  }).unref();
} catch {
  console.log("  (편집기 자동 켜기 실패 — 터미널에 '편집기' 를 직접 입력해주세요)");
}
if (process.env.CODESPACE_NAME) {
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
  console.log("  - 잠시 후 화면 안에 미리보기 창이 열리거나, 우측 아래 '포트 4321' 알림이 뜹니다 → 열기를 누르세요.");
  console.log(`  - 브라우저 새 탭에서 열려면: https://${process.env.CODESPACE_NAME}-4321.${domain}`);
} else {
  console.log("  - 잠시 후 브라우저 주소창에 localhost:4321 을 입력하면 편집기가 열립니다.");
}
console.log("  - 영상을 보고 자막·타이밍·이미지를 고친 뒤 '수정한 영상 다시 만들기'를 누르면 됩니다.");
console.log("  - (편집기가 이미 켜져 있었다면 편집기 화면을 새로고침하세요)");
