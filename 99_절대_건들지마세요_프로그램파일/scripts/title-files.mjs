import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {extname, join} from "node:path";
import {siteNumbers} from "./lib/sites.mjs";

const TITLE_FOLDER_PARTS = ["애드센스 승인글", "01_제목넣는곳"];
// 사이트 순서를 가리키는 우리말 표현 — 파일명 자동 찾기에 쓴다
const ORDINALS = {
  1: ["첫번째", "첫째", "일번"],
  2: ["두번째", "둘째", "이번"],
  3: ["세번째", "셋째", "삼번"],
  4: ["네번째", "넬째", "사번"],
  5: ["다섯번째", "다섯째", "오번"],
  6: ["여섯번째", "여섯째", "육번"],
  7: ["일곱번째", "일곱째", "칠번"],
  8: ["여덟번째", "여덟째", "팔번"],
  9: ["아홉번째", "아홉째", "구번"],
  10: ["열번째", "열째", "십번"],
};

// 사이트 1~10 의 표준 제목 파일명 — 사이트1제목.txt … 사이트10제목.txt
const CANONICAL_TITLE_FILE_NAMES = Object.fromEntries(
  siteNumbers().map((n) => [n, `사이트${n}제목.txt`]),
);

// 파일명을 그대로 안 써도 찾아지도록 하는 별칭들
const ALIASES = Object.fromEntries(
  siteNumbers().map((n) => [
    n,
    [
      `사이트${n}`,
      `사이트${String(n).padStart(2, "0")}`,
      `site${n}`,
      `site${String(n).padStart(2, "0")}`,
      `${n}번`,
      `${n}번째`,
      ...(ORDINALS[n] || []),
      ...(ORDINALS[n] || []).map((word) => `${word}사이트`),
      ...(ORDINALS[n] || []).map((word) => `사이트${word}`),
    ],
  ]),
);

export function titleDir(projectRoot) {
  return join(projectRoot, ...TITLE_FOLDER_PARTS);
}

function compact(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-()[\]{}.,]/g, "");
}

function isUsableTitleFile(fileName) {
  const ext = extname(fileName).toLowerCase();
  return ext === ".txt" || ext === ".md";
}

export function canonicalTitleFileName(siteNumber) {
  return CANONICAL_TITLE_FILE_NAMES[Number(siteNumber)] || `사이트${siteNumber}제목.txt`;
}

function sameFileName(left, right) {
  return String(left || "").normalize("NFC") === String(right || "").normalize("NFC");
}

function exactCanonicalTitleCandidate(projectRoot, siteNumber) {
  const dir = titleDir(projectRoot);
  if (!existsSync(dir)) return null;

  const canonicalName = canonicalTitleFileName(siteNumber);
  const matches = readdirSync(dir)
    .filter(isUsableTitleFile)
    .filter((fileName) => sameFileName(fileName, canonicalName))
    .map((fileName) => {
      const filePath = join(dir, fileName);
      if (!statSync(filePath).isFile()) return null;
      return {
        fileName,
        filePath,
        siteNumber: Number(siteNumber),
        titleCount: countUsableTitleLines(filePath),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "ko"));

  return matches[0] || null;
}

// 별칭이 파일명 안에 들어 있는지 보되, 숫자 경계를 지킨다.
//
// 그냥 includes 로 보면 '사이트1' 이 '사이트10제목.txt' 에도 맞아버려
// 사이트10 의 제목이 사이트1 로 가는 사고가 난다. 사이트가 3개일 때는
// 드러나지 않던 문제다(두 자릿수 번호가 없었으니까).
function aliasMatches(normalized, alias) {
  const needle = compact(alias);
  if (!needle) return false;
  const endsWithDigit = /\d$/.test(needle);

  let from = 0;
  for (;;) {
    const at = normalized.indexOf(needle, from);
    if (at === -1) return false;
    const nextChar = normalized[at + needle.length];
    // 숫자로 끝나는 별칭(사이트1, site1, 1번…) 뒤에 숫자가 더 오면
    // 그건 다른 사이트 번호다.
    if (!(endsWithDigit && nextChar && /\d/.test(nextChar))) return true;
    from = at + 1;
  }
}

export function detectSiteNumberFromFilename(fileName) {
  const normalized = compact(fileName);

  // 큰 번호부터 본다 — 위 경계 규칙과 함께 걸어 두는 이중 방어.
  const numbers = Object.keys(ALIASES)
    .map(Number)
    .sort((a, b) => b - a);

  for (const siteNumber of numbers) {
    if (ALIASES[siteNumber].some((alias) => aliasMatches(normalized, alias))) {
      return siteNumber;
    }
  }

  return null;
}

export function countUsableTitleLines(filePath) {
  if (!existsSync(filePath)) return 0;
  return readTitleList(filePath).length;
}

export function cleanTitle(line, {removeNumbering = false} = {}) {
  let value = line
    .replace(/^\uFEFF/, "")
    .replace(/^\s*[-*•]\s+/, "");

  if (removeNumbering) {
    value = value
      .replace(/^\s*\(?\d{1,4}\)?[.)\-\s]+/, "")
      .replace(/^\s*\[[^\]]+\]\s*/, "");
  }

  return value.trim();
}

function isNumberedTitleLine(line) {
  return /^\s*\(?\d{1,4}\)?[.)\-\s]+/.test(line);
}

function isIgnoredLine(line) {
  const value = line.replace(/^\uFEFF/, "").trim();
  if (!value || value.startsWith("#")) return true;
  if (/^_{5,}$/.test(value)) return true;
  if (/^\[\d+\s*\/\s*\d+\]\s*카테고리/.test(value)) return true;
  if (/^카테고리\s*\d+\s*:/.test(value)) return true;
  if (/^카테고리\s*구성$/.test(value)) return true;
  if (/^카테고리\s*설명$/.test(value)) return true;
  if (/^세부\s*카테고리\s*설명$/.test(value)) return true;
  if (/^세부\s*카테고리\s*\d/.test(value)) return true;
  if (/^글\s*제목\s*\d+\s*개$/.test(value)) return true;
  if (/^진행\s*상황\s*:/.test(value)) return true;
  if (/^다음을\s*입력/.test(value)) return true;
  if (/^다음\s*카테고리/.test(value)) return true;
  if (/^다음$/.test(value)) return true;
  if (/^\d+\s*개\s*글\s*제목\s*추천\s*완료/.test(value)) return true;
  if (/^총\s*\d+\s*개의/.test(value)) return true;
  return false;
}

function categoryDescriptionFromChildren(children) {
  const descriptions = children
    .map((child) => child.description)
    .filter(Boolean);
  if (descriptions.length === 0) return "";
  return descriptions.slice(0, 2).join(" ");
}

function newParentCategory({number, name, expectedCount = 0}) {
  return {
    number,
    name: name.trim(),
    expectedCount,
    description: "",
    children: [],
  };
}

function newChildCategory({parentNumber, number, name}) {
  return {
    parentNumber,
    number,
    name: name.trim(),
    description: "",
    descriptionLines: [],
    titles: [],
    phase: "description",
  };
}

function stripCategoryTitleDecorations(line) {
  return cleanTitle(line, {removeNumbering: true});
}

// 카테고리 머릿줄은 챗봇마다 조금씩 다르게 나온다. 실측으로 확인된 세 가지 —
//   [1/5] 카테고리 1: 이름 (30개)     ← 우리 표준
//   **[1/5] 카테고리 1: 이름**        ← 마크다운 볼드가 붙고 개수가 없음
//   카테고리 1: 이름                  ← 머리표와 개수가 둘 다 없음
// 예전 정규식은 첫 번째만 읽었고, 나머지는 매칭도 무시도 안 돼서
// 그 뒤에 오는 제목이 통째로 버려졌다(카테고리 없이는 제목을 담지 않기 때문).
function stripBold(value) {
  return value.replace(/^\*\*\s*/, "").replace(/\s*\*\*$/, "").trim();
}

export function parseStructuredTitleCatalog(text) {
  const parentPattern = /^(?:\[(\d+)\s*\/\s*(\d+)\]\s*)?카테고리\s*(\d+)\s*:\s*(.+?)(?:\s*\((\d+)\s*개\))?\s*$/;
  const childPattern = /^세부\s*카테고리\s*(\d+)\s*-\s*(\d+)\s*:\s*(.+)$/;
  const categories = [];
  const entries = [];
  const warnings = [];
  let currentParent = null;
  let currentChild = null;

  function finishChild() {
    if (!currentChild || !currentParent) return;
    currentChild.description = currentChild.descriptionLines.join(" ").trim();
    delete currentChild.descriptionLines;
    delete currentChild.phase;
    currentParent.children.push(currentChild);
    currentChild = null;
  }

  function finishParent() {
    finishChild();
    if (!currentParent) return;
    if (!currentParent.description) {
      currentParent.description = categoryDescriptionFromChildren(currentParent.children);
    }
    categories.push(currentParent);
    currentParent = null;
  }

  const rawLines = String(text || "").split(/\r?\n/);
  rawLines.forEach((rawLine, index) => {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    const lineNumber = index + 1;

    if (!line) {
      if (currentChild && currentChild.phase === "description" && currentChild.descriptionLines.length > 0) {
        currentChild.phase = "titles";
      }
      return;
    }

    // 머릿줄 판정에는 볼드를 걷어낸 사본을 쓴다.
    // 제목 줄은 원문 그대로 담아야 하므로 line 은 건드리지 않는다.
    const bare = stripBold(line);

    const parentMatch = bare.match(parentPattern);
    if (parentMatch) {
      finishParent();
      const declared = Number(parentMatch[5]);
      currentParent = newParentCategory({
        number: Number(parentMatch[3]),
        name: stripBold(parentMatch[4]),
        // 개수를 안 적은 형식도 있다. 그 경우 기대값 검사를 건너뛰도록 0 으로 둔다.
        expectedCount: Number.isFinite(declared) ? declared : 0,
      });
      return;
    }

    const childMatch = bare.match(childPattern);
    if (childMatch) {
      finishChild();
      if (!currentParent || Number(childMatch[1]) !== Number(currentParent.number)) {
        warnings.push(`줄 ${lineNumber}: 대표 카테고리 없이 세부 카테고리가 나왔습니다.`);
        return;
      }
      currentChild = newChildCategory({
        parentNumber: Number(childMatch[1]),
        number: Number(childMatch[2]),
        name: stripBold(childMatch[3]),
      });
      return;
    }

    if (isIgnoredLine(line)) return;
    if (!currentParent || !currentChild) return;

    if (currentChild.phase === "description" && isNumberedTitleLine(line)) {
      currentChild.phase = "titles";
    }

    if (currentChild.phase === "description") {
      currentChild.descriptionLines.push(line);
      return;
    }

    const title = stripCategoryTitleDecorations(line);
    if (!title) return;
    currentChild.titles.push(title);
    entries.push({
      title,
      parentCategoryNumber: currentParent.number,
      parentCategory: currentParent.name,
      parentCategoryDescription: currentParent.description,
      childCategoryNumber: currentChild.number,
      childCategory: currentChild.name,
      childCategoryDescription: currentChild.descriptionLines.join(" ").trim(),
    });
  });

  finishParent();

  // 세부 카테고리 개수는 기수마다 다르다 (중급반 200개판은 4개, 150개판은 3개).
  // 숫자를 박아두면 다른 기수 파일마다 거짓 경고가 나므로, 이 파일 안에서
  // 가장 흔한 개수를 기준으로 삼고 거기서 어긋나는 카테고리만 짚는다.
  const childCounts = categories.map((category) => category.children.length).filter((n) => n > 0);
  const commonChildCount = childCounts.length
    ? Number(
        Object.entries(
          childCounts.reduce((acc, n) => ({...acc, [n]: (acc[n] || 0) + 1}), {}),
        ).sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0][0],
      )
    : 0;

  categories.forEach((category) => {
    const titleCount = category.children.reduce((sum, child) => sum + child.titles.length, 0);
    if (category.expectedCount && titleCount !== category.expectedCount) {
      warnings.push(`카테고리 ${category.number} "${category.name}" 제목 수가 ${titleCount}개입니다. 기대값은 ${category.expectedCount}개입니다.`);
    }
    // 카테고리가 하나뿐이면 비교 대상이 없으므로 개수 경고를 내지 않는다
    // (제목을 카테고리 단위로 나눠 쓰는 중간 상태가 정상이다).
    if (categories.length > 1 && commonChildCount && category.children.length !== commonChildCount) {
      warnings.push(`카테고리 ${category.number} "${category.name}" 세부 카테고리가 ${category.children.length}개입니다. 다른 카테고리는 ${commonChildCount}개입니다.`);
    }
  });

  // 예전에는 "1~5번이 다 있어야 한다"고 봤다. 그러면 카테고리를 하나씩 저장하는
  // 중간 상태마다 거짓 경고가 4건씩 나고, 그게 쌓이면 진짜 경고까지 같이 무시된다.
  // 지금은 '있는 번호들 사이의 구멍'만 본다 — 1·2·4 처럼 가운데가 빈 경우만 짚는다.
  const categoryNumbers = new Set(categories.map((category) => Number(category.number)));
  if (categoryNumbers.size > 0) {
    const maxNumber = Math.max(...categoryNumbers);
    for (let index = 1; index <= maxNumber; index += 1) {
      if (!categoryNumbers.has(index)) {
        warnings.push(`카테고리 ${index}번이 빠져 있습니다. (${maxNumber}번까지 있는데 ${index}번만 없습니다)`);
      }
    }
  }

  const parentDescriptions = new Map(categories.map((category) => [Number(category.number), category.description]));
  entries.forEach((entry) => {
    entry.parentCategoryDescription = parentDescriptions.get(Number(entry.parentCategoryNumber)) || "";
  });

  return {categories, entries, warnings};
}

export function extractTitlesFromText(text) {
  const structured = parseStructuredTitleCatalog(text);
  if (structured.entries.length > 0) {
    return structured.entries.map((entry) => entry.title);
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, "").trim())
    .filter((line) => !isIgnoredLine(line));

  const numberedLines = lines.filter(isNumberedTitleLine);
  // 번호 줄이 5개 이상이면 번호 줄만 쓰고 번호를 뗀다. 5개보다 적어도 모든 줄이 "1. 제목" "2) 제목" 모양이면 뗀다
  // (2026-09-23 실측: 제목 2개를 붙여넣었더니 "1. 가족 사칭…" 이 그대로 임시글 제목이 됐다). "2026 기초연금" 처럼 점·괄호가 없는 숫자는 건드리지 않는다.
  const allDotNumbered = lines.length > 0 && lines.every((line) => /^\s*\(?\d{1,4}\)?[.)]\s+\S/.test(line));
  const shouldUseNumberedLines = numberedLines.length >= 5 || allDotNumbered;
  const sourceLines = shouldUseNumberedLines ? numberedLines : lines;

  return sourceLines
    .map((line) => cleanTitle(line, {removeNumbering: shouldUseNumberedLines}))
    .filter(Boolean);
}

export function readTitleList(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`제목 파일을 찾을 수 없음: ${filePath}`);
  }
  return extractTitlesFromText(readFileSync(filePath, "utf8"));
}

export function readTitleEntries(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`제목 파일을 찾을 수 없음: ${filePath}`);
  }

  const text = readFileSync(filePath, "utf8");
  const structured = parseStructuredTitleCatalog(text);
  if (structured.entries.length > 0) {
    // 섞여 있는 파일을 살린다.
    //
    // 수강생이 직접 넣은 제목(카테고리 없이 한 줄씩) 아래에 우리 형식으로 더 뽑아 붙이는
    // 경우가 있다. 예전에는 구조가 하나라도 있으면 그것만 읽어서, 위쪽에 있던
    // 제목이 통째로 사라졌다. 첫 카테고리 줄보다 앞에 있는 제목도 함께 담는다.
    const firstCategoryAt = text.search(/^\s*(?:\*\*\s*)?(?:\[\d+\s*\/\s*\d+\]\s*)?카테고리\s*\d+\s*:/m);
    if (firstCategoryAt > 0) {
      const head = text.slice(0, firstCategoryAt);
      const loose = extractTitlesFromText(head).map((title) => ({
        title,
        parentCategoryNumber: 0,
        parentCategory: "",
        parentCategoryDescription: "",
        childCategoryNumber: 0,
        childCategory: "",
        childCategoryDescription: "",
      }));
      if (loose.length > 0) {
        return {...structured, entries: [...loose, ...structured.entries]};
      }
    }
    return structured;
  }

  return {
    categories: [],
    warnings: [],
    entries: extractTitlesFromText(text).map((title) => ({
      title,
      parentCategoryNumber: 0,
      parentCategory: "",
      parentCategoryDescription: "",
      childCategoryNumber: 0,
      childCategory: "",
      childCategoryDescription: "",
    })),
  };
}

export function listTitleFileCandidates(projectRoot, siteNumber) {
  const dir = titleDir(projectRoot);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(isUsableTitleFile)
    .map((fileName) => {
      const filePath = join(dir, fileName);
      if (!statSync(filePath).isFile()) return null;
      return {
        fileName,
        filePath,
        siteNumber: detectSiteNumberFromFilename(fileName),
        titleCount: countUsableTitleLines(filePath),
      };
    })
    .filter((item) => item && item.siteNumber === siteNumber)
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "ko"));
}

export function resolveTitleFile(projectRoot, siteNumber, explicitPath = "") {
  if (explicitPath) {
    if (!existsSync(explicitPath)) throw new Error(`제목 파일을 찾을 수 없음: ${explicitPath}`);
    return explicitPath;
  }

  const exactCandidate = exactCanonicalTitleCandidate(projectRoot, siteNumber);
  if (exactCandidate) return exactCandidate.filePath;

  const candidates = listTitleFileCandidates(projectRoot, siteNumber);
  const filledCandidates = candidates.filter((candidate) => candidate.titleCount > 0);

  if (filledCandidates.length === 1) return filledCandidates[0].filePath;

  if (filledCandidates.length > 1) {
    const names = filledCandidates.map((candidate) => `- ${candidate.fileName}`).join("\n");
    throw new Error(
      [
        `사이트 ${siteNumber}번으로 보이는 제목 파일이 여러 개 있음.`,
        "헷갈리지 않게 하나만 남기거나, 사용할 파일만 제목을 채워주세요.",
        names,
      ].join("\n"),
    );
  }

  if (candidates.length === 1) return candidates[0].filePath;

  if (candidates.length > 1) {
    const names = candidates.map((candidate) => `- ${candidate.fileName}`).join("\n");
    throw new Error(
      [
        `사이트 ${siteNumber}번으로 보이는 제목 파일은 있지만 제목이 비어 있음.`,
        "사용할 파일 하나에 제목을 한 줄에 하나씩 붙여넣어 주세요.",
        names,
      ].join("\n"),
    );
  }

  throw new Error(
    [
      `사이트 ${siteNumber}번 제목 파일을 찾을 수 없음.`,
      `위치: ${titleDir(projectRoot)}`,
      "파일명에 사이트 번호가 들어가야 함. 예: 사이트1_제목.txt, 첫번째사이트_제목.txt, 사이트 제목_사이트 첫번째.txt",
    ].join("\n"),
  );
}
