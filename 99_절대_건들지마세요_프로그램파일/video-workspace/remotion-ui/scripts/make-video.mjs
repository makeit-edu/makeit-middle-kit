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

// "끄기" 계열 값 판정 — [05] 옵션 줄(네이버링크표시/썸네일하단문구 등)에서 쓴다.
function offOptionValue(text) {
  const value = String(text || "").trim().replace(/\s+/g, "");
  return /^(끄기|끔|off|숨기기|숨김|없음|아니오|아니요|no|false)$/i.test(value);
}

// ---- 기획안 [05] 옵션 줄 (영상자동화 개선 기획서 v1.1 — 항목 3·4·7·8) ----
// 수강생이 기획안 [05] 블록에 손으로 한 줄씩 추가하는 옵션이다. 코덱스는 이 옵션을 만들지 않는다.
// 라벨은 공백을 무시하고 인식한다 ("썸네일 번호"와 "썸네일번호" 모두 인식).
// 여기 등록된 라벨은 자막(unknownSentences)으로 흘러가지 않는다 — 미등록 시 자막 오염 사고가 난다(§2-2).
const planOptionLabels = new Map([
  ["말속도", "voiceSpeed"], // [항목 4] 음성 속도 (0.7~1.2)
  ["음량고르게", "audioNormalize"], // [항목 3] 음량 정규화 켜기
  ["네이버링크표시", "naverLinkDisplay"], // [항목 7] 네이버판 링크 안내 화면 끄기/문구 교체
  ["광고표시문구", "adBadgeText"], // [항목 7] 광고 배지 문구 교체 (완전 끄기는 미지원)
  ["썸네일하단문구", "thumbTailCta"], // [항목 7] 썸네일 하단 CTA 반복 표시 끄기
  ["영상모두쓰기", "useAllClips"], // [항목 8] 원본 클립 전부 사용
  ["영상길이", "videoLength"], // [항목 8] 목표 영상 길이 (초, 90 상한)
  ["썸네일번호", "thumbnailNumber"], // [항목 2] 썸네일 후보 번호 — 값은 '이미지만들기'가 사용, 여기서는 자막 오염 방지용 인식만
  ["참조이미지", "referenceImage"], // [항목 1] 방어 등록 — 실수로 넣어도 오염되지 않게 인식만 하고 무시
]);

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
  // 수강생이 [05] 블록에 손으로 넣은 옵션 줄 (기획서 v1.1 항목 3·4·7·8) — 자막과 분리해서 모은다.
  const options = {};
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
      // [05] 옵션 줄 인식 — 옵션은 항상 "라벨: 값" 한 줄이라 다음 줄을 이어붙이지 않는다.
      const optionKey = planOptionLabels.get(label.replace(/\s+/g, ""));
      if (optionKey) {
        options[optionKey] = match[2].trim();
        current = "";
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
    options,
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

  return {hook, captions, cta, thumb, adText: "광고", virtualPerson: false, options: {}};
}

// ---- [05] 옵션 검증·정규화 (기획서 v1.1 항목 3·4·7·8) ----
// 옵션 줄 원문을 확인해 timeline에 넣을 확정 값(normalized), 확인 화면 요약(summary),
// 초보 눈높이 안내 문구(notes)로 나눈다. 잘못된 값은 조용히 망가뜨리지 않고 안내 후 무시한다.
function normalizePlanOptions(raw, virtualPerson) {
  const normalized = {};
  const summary = [];
  const notes = [];

  // [항목 4] 말속도: 0.7~1.2 범위 밖은 클램프 (ElevenLabs 허용 범위 — API 400 방지)
  if (raw.voiceSpeed !== undefined) {
    const value = Number(String(raw.voiceSpeed).replace(/[^\d.]/g, ""));
    if (Number.isFinite(value) && value > 0) {
      const clamped = Math.min(1.2, Math.max(0.7, value));
      if (clamped !== value) notes.push(`말속도는 0.7~1.2 사이만 가능해서 ${clamped}(으)로 맞췄어요.`);
      normalized.voiceSpeed = clamped;
      summary.push(`말속도 ${clamped}`);
      notes.push("말속도를 바꾸면 음성 전체가 1회 새로 생성됩니다 (일레븐랩스 크레딧 소모). 줄을 지우면 원래 속도로 돌아와요.");
    } else {
      notes.push(`'말속도: ${raw.voiceSpeed}' 값을 숫자로 읽지 못해 이번에는 적용하지 않았어요. (예: 말속도: 1.0)`);
    }
  }

  // [항목 3] 음량고르게: '예'일 때만 켠다. 줄이 없거나 '아니오'면 기존과 완전히 동일하게 동작.
  // '켜기'/'on'/'ㅇ' 처럼 인식 못 하는 값은 조용히 무시하지 않고 안내한다 (말속도·영상길이와 같은 규칙).
  if (raw.audioNormalize !== undefined) {
    if (yesNoValue(raw.audioNormalize)) {
      normalized.audioNormalize = true;
      summary.push("음량 고르게 켜기");
      notes.push("음량 고르게를 켜면 영상 만들기가 몇 초 더 걸릴 수 있어요.");
    } else if (!offOptionValue(raw.audioNormalize)) {
      notes.push(`'음량고르게: ${raw.audioNormalize}' 값은 인식하지 못해 이번에는 적용하지 않았어요 — 켜려면 '음량고르게: 예' 라고 적어주세요.`);
    }
  }

  // [항목 8] 영상모두쓰기: '예'일 때만 켠다. (인식 못 하는 값은 위와 같은 규칙으로 안내)
  if (raw.useAllClips !== undefined) {
    if (yesNoValue(raw.useAllClips)) {
      normalized.useAllClips = true;
      summary.push("원본 영상 모두 쓰기");
    } else if (!offOptionValue(raw.useAllClips)) {
      notes.push(`'영상모두쓰기: ${raw.useAllClips}' 값은 인식하지 못해 이번에는 적용하지 않았어요 — 켜려면 '영상모두쓰기: 예' 라고 적어주세요.`);
    }
  }

  // [항목 8] 영상길이: 숫자 검증 + 90초 안전 상한 클램프
  if (raw.videoLength !== undefined) {
    const value = Number(String(raw.videoLength).replace(/[^\d.]/g, ""));
    if (Number.isFinite(value) && value > 0) {
      const clamped = Math.min(90, value);
      if (clamped !== value) notes.push("영상길이는 최대 90초까지만 가능해서 90초로 맞췄어요.");
      normalized.targetDurationSec = clamped;
      summary.push(`영상길이 ${clamped}초`);
      notes.push("음성이 끝난 뒤에는 자막 없는 배경 화면과 음악만 이어져요 (시청지속률에는 불리할 수 있어요).");
    } else {
      notes.push(`'영상길이: ${raw.videoLength}' 값을 숫자로 읽지 못해 이번에는 적용하지 않았어요. (예: 영상길이: 30)`);
    }
  }

  // [항목 7] 네이버링크표시: '끄기' 또는 '문구A / 문구B / 문구C' 교체. 네이버판 전용.
  if (raw.naverLinkDisplay !== undefined) {
    notes.push("'네이버링크표시' 옵션은 네이버용 영상에만 적용됩니다 (쿠팡용에는 원래 이 화면이 없어요).");
    if (offOptionValue(raw.naverLinkDisplay)) {
      normalized.secondaryCtaDisabled = true;
      summary.push("네이버 링크 안내 화면 끄기");
    } else if (/^(예|yes|true|켜기|킴|표시)$/i.test(String(raw.naverLinkDisplay).trim())) {
      // '예'를 문구 교체("예")로 오인하지 않게 방어 — 이 화면은 원래 켜져 있다.
      notes.push("'네이버링크표시'는 원래 켜져 있어요 — '끄기' 또는 교체 문구(문구A / 문구B / 문구C)만 적을 수 있습니다.");
    } else if (String(raw.naverLinkDisplay).trim()) {
      const lines = String(raw.naverLinkDisplay)
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (lines.length > 0) {
        normalized.secondaryCtaText = lines.join("\n");
        summary.push("네이버 링크 안내 문구 교체");
      }
    }
  }

  // [항목 7] 광고표시문구: 문구 교체만 지원. 완전 끄기는 표시광고법상 필수라 미지원.
  if (raw.adBadgeText !== undefined) {
    const text = String(raw.adBadgeText).trim();
    if (!text || offOptionValue(text)) {
      notes.push("광고 표시는 법(표시광고법)상 필수라 끌 수 없어요 — 문구 교체만 가능합니다. (예: 광고표시문구: 광고입니다)");
    } else {
      normalized.adBadgeText = virtualPerson ? `${text}\n가상인물` : text;
      summary.push(`광고 표시 문구 "${text}"`);
    }
  }

  // [항목 7] 썸네일하단문구: 지금은 '끄기'만 지원.
  if (raw.thumbTailCta !== undefined) {
    if (offOptionValue(raw.thumbTailCta)) {
      normalized.thumbTailCtaHidden = true;
      summary.push("썸네일 하단 문구 끄기");
    } else {
      notes.push("'썸네일하단문구' 옵션은 지금은 '끄기'만 지원해요. (예: 썸네일하단문구: 끄기)");
    }
  }

  // '썸네일번호'(항목 2)는 '이미지만들기'가 사용하고, '참조이미지'(항목 1)는 방어 등록이라 여기서는 건드리지 않는다.

  return {normalized, summary, notes};
}

// 확정된 옵션을 timeline에 주입한다. 옵션 줄이 빠진 항목은 이전에 옵션으로 넣었던 값을 지워
// "옵션 줄을 지우면 원래대로"를 보장한다. (지우는 대상은 전부 이번 개선의 신규 필드이거나
// 렌더가 매번 다시 채우는 파생 필드라, 기존 작업 timeline과 100% 호환된다 — 원칙 4)
function applyPlanOptions(timeline, normalized) {
  // [항목 4] 말속도 → audio.requestedSpeed (렌더에서 최우선 적용)
  if (normalized.voiceSpeed !== undefined) {
    timeline.audio = {...(timeline.audio || {}), requestedSpeed: normalized.voiceSpeed};
  } else if (timeline.audio && timeline.audio.requestedSpeed !== undefined) {
    // 옵션 줄이 사라졌으면: 옵션으로 덮였던 실제 속도 기록(speed)도 함께 지워 프리셋 속도로 되돌린다.
    delete timeline.audio.requestedSpeed;
    delete timeline.audio.speed;
  }

  // [항목 3] 음량고르게 → audio.normalize (렌더에서 loudnorm 수행, 실패 시 원본 음량 폴백)
  if (normalized.audioNormalize) {
    timeline.audio = {...(timeline.audio || {}), normalize: true};
  } else if (timeline.audio && timeline.audio.normalize !== undefined) {
    delete timeline.audio.normalize;
  }

  // [항목 8] 영상모두쓰기 / 영상길이 → 신규 루트 필드 (없으면 렌더가 기존 코드 경로 그대로)
  if (normalized.useAllClips) timeline.useAllClips = true;
  else delete timeline.useAllClips;
  if (normalized.targetDurationSec !== undefined) timeline.targetDurationSec = normalized.targetDurationSec;
  else delete timeline.targetDurationSec;

  // [항목 7] 네이버링크표시 → secondaryCta.disabled / text
  if (normalized.secondaryCtaDisabled) {
    timeline.secondaryCta = {...(timeline.secondaryCta || {}), disabled: true};
  } else if (timeline.secondaryCta && timeline.secondaryCta.disabled !== undefined) {
    delete timeline.secondaryCta.disabled;
  }
  if (normalized.secondaryCtaText !== undefined) {
    timeline.secondaryCta = {...(timeline.secondaryCta || {}), text: normalized.secondaryCtaText};
  } else if (timeline.secondaryCta && timeline.secondaryCta.text !== undefined && !normalized.secondaryCtaDisabled) {
    // 문구 옵션이 사라졌으면 저장된 문구를 지운다 → 렌더가 기본 문구를 다시 채운다(= 원래대로).
    delete timeline.secondaryCta.text;
  }

  // [항목 7] 광고표시문구 → adBadge.text 교체 (미기재면 위에서 세팅한 기본 광고 문구 그대로)
  if (normalized.adBadgeText !== undefined) {
    timeline.adBadge = {...(timeline.adBadge || {}), text: normalized.adBadgeText, position: "top-right"};
  }

  // [항목 7] 썸네일하단문구 → thumbnailTail.hideCta (렌더 컴포넌트는 이미 지원)
  if (normalized.thumbTailCtaHidden) {
    timeline.thumbnailTail = {...(timeline.thumbnailTail || {durationSec: 0.6}), hideCta: true};
  } else if (timeline.thumbnailTail && timeline.thumbnailTail.hideCta !== undefined) {
    delete timeline.thumbnailTail.hideCta;
  }
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
const parsedPlan = parseSelectedVideoBlock(pasted) || parseNumberedCodexAnswer(pasted);
const {hook, captions, cta, thumb, adText, virtualPerson} = parsedPlan;
// [05] 옵션 줄 검증 (기획서 v1.1 항목 3·4·7·8 — 옵션 미기재 = 현행 동작)
const {normalized: planOptions, summary: planOptionSummary, notes: planOptionNotes} = normalizePlanOptions(
  parsedPlan.options || {},
  virtualPerson,
);

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
// [05] 옵션 줄이 있으면 어떻게 적용되는지 보여준다 (없으면 아무것도 출력하지 않음 = 현행 화면 그대로)
if (planOptionSummary.length > 0) console.log(`  [옵션]      ${planOptionSummary.join(" / ")}`);
planOptionNotes.forEach((note) => console.log(`  [안내]      ${note}`));
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
// [05] 옵션을 timeline에 반영한다 (옵션 줄이 없으면 신규 필드를 지워 원래 동작으로 되돌린다).
applyPlanOptions(timeline, planOptions);
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
  // [항목 11] 2회 렌더가 모두 성공한 직후 "영상만들기 직후" 스냅샷을 저장한다 (기획서 원안).
  // 영상만들기를 다시 돌리면 여기서 덮어써서, 편집기의 '원본 복구' 기준점이 항상 최신 직후가 된다.
  // (편집기 서버의 mtime 휴리스틱은 이 스냅샷이 없을 때를 위한 보조 안전망일 뿐이다)
  copyFileSync(timelinePath, path.join(jobPaths.timelineDir, "timeline.initial.json"));
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
