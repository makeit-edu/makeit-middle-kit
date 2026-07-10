import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {extname, join} from "node:path";

const TITLE_FOLDER_PARTS = ["01_1주차_애드센스승인", "01_제목넣는곳"];
const CANONICAL_TITLE_FILE_NAMES = {
  1: "사이트1_제목200개.txt",
  2: "사이트2_제목200개.txt",
  3: "사이트3_제목200개.txt",
};
const ALIASES = {
  1: ["사이트1", "사이트01", "site1", "site01", "1번", "1번째", "첫번째", "첫번째사이트", "사이트첫번째", "첫째"],
  2: ["사이트2", "사이트02", "site2", "site02", "2번", "2번째", "두번째", "두번째사이트", "사이트두번째", "둘째"],
  3: ["사이트3", "사이트03", "site3", "site03", "3번", "3번째", "세번째", "세번째사이트", "사이트세번째", "셋째"],
};

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
  return CANONICAL_TITLE_FILE_NAMES[Number(siteNumber)] || `사이트${siteNumber}_제목200개.txt`;
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

export function detectSiteNumberFromFilename(fileName) {
  const normalized = compact(fileName);

  for (const [siteNumber, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => normalized.includes(compact(alias)))) {
      return Number(siteNumber);
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

export function parseStructuredTitleCatalog(text) {
  const parentPattern = /^\[(\d+)\s*\/\s*(\d+)\]\s*카테고리\s*(\d+)\s*:\s*(.+?)\s*\((\d+)\s*개\)\s*$/;
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

    const parentMatch = line.match(parentPattern);
    if (parentMatch) {
      finishParent();
      currentParent = newParentCategory({
        number: Number(parentMatch[3]),
        name: parentMatch[4],
        expectedCount: Number(parentMatch[5]),
      });
      return;
    }

    const childMatch = line.match(childPattern);
    if (childMatch) {
      finishChild();
      if (!currentParent || Number(childMatch[1]) !== Number(currentParent.number)) {
        warnings.push(`줄 ${lineNumber}: 대표 카테고리 없이 세부 카테고리가 나왔습니다.`);
        return;
      }
      currentChild = newChildCategory({
        parentNumber: Number(childMatch[1]),
        number: Number(childMatch[2]),
        name: childMatch[3],
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

  categories.forEach((category) => {
    const titleCount = category.children.reduce((sum, child) => sum + child.titles.length, 0);
    if (category.expectedCount && titleCount !== category.expectedCount) {
      warnings.push(`카테고리 ${category.number} "${category.name}" 제목 수가 ${titleCount}개입니다. 기대값은 ${category.expectedCount}개입니다.`);
    }
    if (category.children.length !== 4) {
      warnings.push(`카테고리 ${category.number} "${category.name}" 세부 카테고리가 ${category.children.length}개입니다. 기대값은 4개입니다.`);
    }
  });

  const categoryNumbers = new Set(categories.map((category) => Number(category.number)));
  if (categories.length > 0) {
    for (let index = 1; index <= 5; index += 1) {
      if (!categoryNumbers.has(index)) {
        warnings.push(`카테고리 ${index}번이 제목 파일에서 발견되지 않았습니다.`);
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
  const shouldUseNumberedLines = numberedLines.length >= 5;
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
  if (structured.entries.length > 0) return structured;

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
