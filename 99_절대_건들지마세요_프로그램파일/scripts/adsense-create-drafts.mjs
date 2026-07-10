#!/usr/bin/env node

import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {readTitleEntries, resolveTitleFile} from "./title-files.mjs";
import {keysGuideMessage, requireLicense} from "./lib/env.mjs";

const programRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(programRoot);
const GPT54_MINI_INPUT_PER_1M = 0.75;
const GPT54_MINI_OUTPUT_PER_1M = 4.5;
const DEFAULT_USD_KRW = 1543.57527;
const DEFAULT_IMAGE_MODEL = "gpt-image-1-mini";
const DEFAULT_IMAGE_QUALITY = "low";
const DEFAULT_IMAGE_SIZE = "1536x1024";
const DEFAULT_IMAGE_OUTPUT_FORMAT = "jpeg";

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function ready(value, placeholders = []) {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return !placeholders.some((token) => lowered.includes(token));
}

function sitePrefix(siteNumber) {
  return `ADSENSE_SITE_${String(siteNumber).padStart(2, "0")}`;
}

function cleanHtml(text) {
  return text
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableText(value) {
  return stripTags(value)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function hashText(value, length = 8) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, length);
}

function sanitizeEnglishSlug(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .split("-")
    .filter(Boolean)
    .slice(0, 8)
    .join("-");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "";
  if (slug.length < 8) return "";
  return slug;
}

function fallbackSlug(title) {
  const englishWords = String(title)
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  const words = (englishWords || [])
    .filter((word) => !["the", "and", "for", "with", "from", "into", "about"].includes(word))
    .slice(0, 6);
  if (words.length >= 2) return sanitizeEnglishSlug(words.join("-"));
  return `info-guide-${hashText(title)}`;
}

function compactKoreanPhrase(title) {
  const cleaned = String(title)
    .normalize("NFC")
    .replace(/[()[\]{}"'“”‘’!?.,:;|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "핵심 정리";
  const words = cleaned.split(" ").slice(0, 3).join(" ");
  return words.length > 18 ? `${words.slice(0, 18).trim()} 정리` : `${words} 정리`;
}

function introHeadingForTitle(title) {
  const phrase = compactKoreanPhrase(title);
  const candidate = `${phrase}를 이해하기 위한 핵심`;
  if (comparableText(candidate) === comparableText(title)) return "핵심 내용을 먼저 정리하면";
  return candidate;
}

function headingBlock(level, text) {
  if (level === 3) {
    return `<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${escapeHtml(text)}</h3>\n<!-- /wp:heading -->`;
  }
  return `<!-- wp:heading -->\n<h2 class="wp-block-heading">${escapeHtml(text)}</h2>\n<!-- /wp:heading -->`;
}

function withClass(tagHtml, className) {
  if (/\sclass\s*=/.test(tagHtml)) {
    return tagHtml.replace(/\sclass=(["'])(.*?)\1/i, (_match, quote, classes) => ` class=${quote}${classes} ${className}${quote}`);
  }
  return tagHtml.replace(/^<([a-z0-9]+)\b/i, `<$1 class="${className}"`);
}

function wrapBlock(block) {
  const trimmed = block.trim();
  const tagMatch = trimmed.match(/^<([a-z0-9]+)\b/i);
  const tag = tagMatch ? tagMatch[1].toLowerCase() : "";

  if (tag === "h2") {
    return `<!-- wp:heading -->\n${withClass(trimmed, "wp-block-heading")}\n<!-- /wp:heading -->`;
  }
  if (tag === "h3") {
    return `<!-- wp:heading {"level":3} -->\n${withClass(trimmed, "wp-block-heading")}\n<!-- /wp:heading -->`;
  }
  if (tag === "p") {
    return `<!-- wp:paragraph -->\n${trimmed}\n<!-- /wp:paragraph -->`;
  }
  if (tag === "ul" || tag === "ol") {
    return `<!-- wp:list -->\n${withClass(trimmed, "wp-block-list")}\n<!-- /wp:list -->`;
  }
  if (tag === "figure" && /<table\b/i.test(trimmed)) {
    return `<!-- wp:table -->\n${trimmed}\n<!-- /wp:table -->`;
  }
  if (tag === "table") {
    return `<!-- wp:table -->\n<figure class="wp-block-table">${trimmed}</figure>\n<!-- /wp:table -->`;
  }
  return `<!-- wp:paragraph -->\n<p>${escapeHtml(stripTags(trimmed))}</p>\n<!-- /wp:paragraph -->`;
}

function wrapPlainHtmlAsBlocks(html) {
  const blocks = [];
  const pattern = /<(h2|h3|p|ul|ol|figure|table)\b[\s\S]*?<\/\1>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    blocks.push(wrapBlock(match[0]));
  }
  if (blocks.length > 0) return blocks.join("\n\n");

  const text = stripTags(html);
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<!-- wp:paragraph -->\n<p>${escapeHtml(paragraph)}</p>\n<!-- /wp:paragraph -->`)
    .join("\n\n");
}

function normalizeArticleHtml(rawHtml, title) {
  let html = cleanHtml(rawHtml)
    .replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi, (_match, attrs, inner) => `<h2${attrs}>${inner}</h2>`)
    .trim();

  if (!/<!--\s*wp:/i.test(html)) {
    html = wrapPlainHtmlAsBlocks(html);
  }

  html = html.replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi, (_match, _attrs, inner) => {
    const text = stripTags(inner);
    return `<h2 class="wp-block-heading">${escapeHtml(text || introHeadingForTitle(title))}</h2>`;
  });

  const firstHeadingPattern = /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/i;
  const firstHeading = html.match(firstHeadingPattern);
  if (!firstHeading) {
    html = `${headingBlock(2, introHeadingForTitle(title))}\n\n${html}`;
  } else {
    const level = Number(firstHeading[1]);
    const text = stripTags(firstHeading[3]);
    const replacementText = comparableText(text) === comparableText(title) ? introHeadingForTitle(title) : text;
    if (level !== 2 || replacementText !== text || !/\bwp-block-heading\b/.test(firstHeading[2])) {
      html = html.replace(firstHeadingPattern, `<h2 class="wp-block-heading">${escapeHtml(replacementText)}</h2>`);
    }
  }

  if (!/<!--\s*wp:/i.test(html)) {
    html = wrapPlainHtmlAsBlocks(html);
  }

  return html.trim();
}

function validateArticleHtml(html, title) {
  if (/<h1\b/i.test(html)) throw new Error("본문에 h1 태그가 남아 있음");
  if (!/<!--\s*wp:/i.test(html)) throw new Error("본문에 Gutenberg 블록 주석이 없음");
  const firstH2 = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  if (!firstH2) throw new Error("본문 첫 소제목 h2를 찾지 못함");
  const firstH2Text = stripTags(firstH2[1]);
  if (comparableText(firstH2Text) === comparableText(title)) {
    throw new Error("제목과 첫 h2 소제목이 같음");
  }
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n").trim();
}

function extractJsonObject(text) {
  const raw = String(text || "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) throw new Error("JSON 객체를 찾지 못함");
  return JSON.parse(raw.slice(first, last + 1));
}

function safeFilename(input) {
  return input
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function titleKey(title) {
  return normalizeSpaces(title)
    .normalize("NFC")
    .toLowerCase();
}

function readJsonArray(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function compactDraftHistoryEntry(item) {
  if (!item?.ok || !normalizeSpaces(item.title)) return null;
  return {
    site: Number(item.site || 1),
    title: normalizeSpaces(item.title),
    postId: Number(item.postId || 0),
    status: item.status || "draft",
    slug: normalizeSpaces(item.slug || ""),
    categoryId: Number(item.categoryId || 0),
    parentCategoryId: Number(item.parentCategoryId || 0),
    categoryIds: Array.isArray(item.categoryIds) ? item.categoryIds.map((id) => Number(id)).filter((id) => id > 0) : [],
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function mergeDraftHistory(...entryGroups) {
  const merged = new Map();
  for (const entries of entryGroups) {
    for (const entry of entries || []) {
      const compact = compactDraftHistoryEntry(entry);
      if (!compact) continue;
      merged.set(titleKey(compact.title), compact);
    }
  }
  return Array.from(merged.values());
}

function readDraftHistory(outputDir, visibleOutputDir) {
  return mergeDraftHistory(
    readJsonArray(join(outputDir, "draft-history.json")),
    readJsonArray(join(outputDir, "last-run.json")),
    readJsonArray(join(visibleOutputDir, "draft-history.json")),
    readJsonArray(join(visibleOutputDir, "last-run.json")),
  );
}

function parseDate(input) {
  if (!input) return null;
  const match = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`날짜 형식은 YYYY-MM-DD 여야 함: ${input}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0));
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function defaultStartDate(mode) {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0));
  if (mode === "future-daily") {
    utc.setUTCDate(utc.getUTCDate() + 1);
    return utc;
  }
  utc.setUTCDate(utc.getUTCDate() - 30);
  return utc;
}

function postDateForIndex(index, mode, startDate) {
  if (mode === "none") return null;
  const date = new Date(startDate.getTime());
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString();
}

function extractUsage(data) {
  const usage = data.usage || {};
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);
  return {inputTokens, outputTokens, totalTokens};
}

function estimateCost({model, inputTokens, outputTokens, usdKrw}) {
  const modelName = String(model || "").toLowerCase();
  let inputPer1m = GPT54_MINI_INPUT_PER_1M;
  let outputPer1m = GPT54_MINI_OUTPUT_PER_1M;
  if (!modelName.includes("gpt-5.4-mini")) {
    inputPer1m = GPT54_MINI_INPUT_PER_1M;
    outputPer1m = GPT54_MINI_OUTPUT_PER_1M;
  }
  const usd = (inputTokens / 1_000_000) * inputPer1m + (outputTokens / 1_000_000) * outputPer1m;
  return {
    estimatedUsd: Number(usd.toFixed(6)),
    estimatedKrw: Number((usd * usdKrw).toFixed(1)),
    inputPer1m,
    outputPer1m,
    usdKrw,
  };
}

function openAiResponsesUrl() {
  return env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
}

function openAiImagesUrl() {
  return env.OPENAI_IMAGES_URL || "https://api.openai.com/v1/images/generations";
}

function mergeUsage(...items) {
  return items.reduce(
    (acc, item) => {
      acc.inputTokens += Number(item?.inputTokens || 0);
      acc.outputTokens += Number(item?.outputTokens || 0);
      acc.totalTokens += Number(item?.totalTokens || 0);
      return acc;
    },
    {inputTokens: 0, outputTokens: 0, totalTokens: 0},
  );
}

const KOREAN_STOPWORDS = new Set([
  "방법",
  "가이드",
  "정리",
  "정보",
  "핵심",
  "초보자",
  "완벽",
  "알아보기",
  "알아야",
  "필요한",
  "그리고",
  "비교",
  "이해",
  "체크리스트",
  "주의사항",
  "뜻",
  "의미",
  "기본",
  "활용",
  "사용법",
]);

function normalizeSpaces(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeFocusKeyword(value, title) {
  const cleaned = normalizeSpaces(value)
    .replace(/[()[\]{}"'“”‘’!?.,:;|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned && cleaned.length <= 30 && !/^\d+$/.test(cleaned)) return cleaned;

  const words =
    normalizeSpaces(title)
      .replace(/[()[\]{}"'“”‘’!?.,:;|/\\]+/g, " ")
      .match(/[\p{L}\p{N}]{2,}/gu) || [];
  const filtered = words
    .map((word) => word.trim())
    .filter((word) => word && !KOREAN_STOPWORDS.has(word) && !/^\d+$/.test(word))
    .slice(0, 2);
  if (filtered.length > 0) return filtered.join(" ").slice(0, 30).trim();

  return compactKoreanPhrase(title).replace(/\s*정리$/, "").slice(0, 30).trim() || "핵심 주제";
}

function ensureKeywordInAlt(altText, focusKeyword, title) {
  const keyword = normalizeFocusKeyword(focusKeyword, title);
  const cleanedAlt = normalizeSpaces(altText);
  if (cleanedAlt && cleanedAlt.includes(keyword) && cleanedAlt.length <= 120) return cleanedAlt;
  return `${keyword} 핵심 내용을 설명하는 ${compactKoreanPhrase(title).replace(/\s*정리$/, "")} 대표 이미지`.slice(0, 120).trim();
}

function ensureMetaDefaults(meta, title) {
  const focusKeyword = normalizeFocusKeyword(meta?.focusKeyword, title);
  const slug = sanitizeEnglishSlug(meta?.slug) || fallbackSlug(title);
  const excerpt = normalizeSpaces(meta?.excerpt || `${title}에 대해 핵심 개념과 확인할 점을 정리한 글입니다.`).slice(0, 180);
  const categoryHint = normalizeSpaces(meta?.categoryHint || focusKeyword).slice(0, 40) || focusKeyword;
  const featuredImageAlt = ensureKeywordInAlt(meta?.featuredImageAlt, focusKeyword, title);
  const featuredImageCaption = normalizeSpaces(meta?.featuredImageCaption || `${focusKeyword}의 핵심 내용을 시각적으로 정리한 이미지입니다.`).slice(0, 140);
  const imageLabel = normalizeSpaces(meta?.imageLabel || focusKeyword || compactKoreanPhrase(title)).slice(0, 24);

  return {
    slug,
    excerpt,
    focusKeyword,
    categoryHint,
    featuredImageAlt,
    featuredImageCaption,
    imageLabel,
  };
}

function wordpressBaseUrl(siteUrl) {
  let url = String(siteUrl || "").trim().replace(/^["']+|["']+$/g, "");
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

function wordpressCredentials(username, appPassword) {
  return Buffer.from(`${String(username || "").trim()}:${String(appPassword || "").trim()}`).toString("base64");
}

async function findExistingPostByTitle({siteUrl, username, appPassword, title}) {
  const credentials = wordpressCredentials(username, appPassword);
  const url = `${wordpressBaseUrl(siteUrl)}/wp-json/wp/v2/posts?context=edit&status=draft,pending,future,publish&search=${encodeURIComponent(title)}&per_page=50&_fields=id,title,status`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {Authorization: `Basic ${credentials}`, Accept: "application/json"},
      });
      if (!response.ok) throw new Error(`상태 코드 ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("응답 형식이 목록이 아님");
      const key = titleKey(title);
      return (
        data.find((post) => {
          const postTitle = stripTags(post?.title?.raw || post?.title?.rendered || "");
          return titleKey(postTitle) === key;
        }) || null
      );
    } catch (error) {
      if (attempt === 3) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`  (주의: 중복 확인 실패 - ${message} / 중복 확인 없이 발행을 진행함)`);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  return null;
}

function categoryIsDefault(category) {
  const label = `${category?.slug || ""} ${category?.name || ""}`.toLowerCase();
  return label.includes("uncategorized") || label.includes("미분류");
}

function categoryMatchText(category) {
  return normalizeSpaces(`${stripTags(category?.name || "")} ${stripTags(category?.description || "")} ${category?.slug || ""}`).toLowerCase();
}

function categoryTokens({title, meta}) {
  const raw = normalizeSpaces(`${title} ${meta.focusKeyword || ""} ${meta.categoryHint || ""}`);
  const tokens = raw.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const filtered = tokens
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token && !KOREAN_STOPWORDS.has(token) && !/^\d+$/.test(token));
  const keyword = normalizeFocusKeyword(meta.focusKeyword, title).toLowerCase();
  const categoryHint = normalizeSpaces(meta.categoryHint).toLowerCase();
  return Array.from(new Set([keyword, categoryHint, ...filtered].filter(Boolean)));
}

function scoreCategory(category, context) {
  const text = categoryMatchText(category);
  const name = normalizeSpaces(category?.name || "").toLowerCase();
  const tokens = categoryTokens(context);
  const focusKeyword = normalizeFocusKeyword(context.meta.focusKeyword, context.title).toLowerCase();
  const categoryHint = normalizeSpaces(context.meta.categoryHint).toLowerCase();
  const isChildCategory = Number(category?.parent || 0) > 0;
  let score = 0;

  if (focusKeyword) {
    if (name.includes(focusKeyword)) score += 30;
    if (text.includes(focusKeyword)) score += 24;
    if (isChildCategory && text.includes(focusKeyword)) score += 30;
  }

  if (categoryHint && categoryHint !== focusKeyword) {
    if (name.includes(categoryHint)) score += 10;
    if (text.includes(categoryHint)) score += 6;
  }

  for (const token of tokens) {
    if (!token) continue;
    if (name.includes(token)) score += 8;
    if (text.includes(token)) score += Math.min(8, token.length + 2);
  }

  if (isChildCategory) score += 2;
  if (normalizeSpaces(category?.description || "")) score += 1;
  if (categoryIsDefault(category)) score -= 50;
  return score;
}

function selectBestCategory(categories, context) {
  const valid = (Array.isArray(categories) ? categories : []).filter((category) => Number(category?.id || 0) > 0 && normalizeSpaces(category?.name));
  if (valid.length === 0) return null;

  const nonDefault = valid.filter((category) => !categoryIsDefault(category));
  const candidates = nonDefault.length > 0 ? nonDefault : valid;
  const scored = candidates
    .map((category) => ({category, score: scoreCategory(category, context)}))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (Number(b.category.parent || 0) !== Number(a.category.parent || 0)) return Number(b.category.parent || 0) - Number(a.category.parent || 0);
      return String(a.category.name || "").localeCompare(String(b.category.name || ""), "ko");
    });

  const best = scored[0];
  if (!best) return null;
  return {
    id: Number(best.category.id),
    name: normalizeSpaces(best.category.name),
    slug: normalizeSpaces(best.category.slug),
    parentId: Number(best.category.parent || 0),
    score: best.score,
  };
}

function comparableCategoryName(value) {
  return normalizeSpaces(stripTags(value || ""))
    .normalize("NFC")
    .toLowerCase();
}

function categoryResult(category, {score, source}) {
  return {
    id: Number(category.id),
    name: normalizeSpaces(category.name),
    slug: normalizeSpaces(category.slug),
    parentId: Number(category.parent || 0),
    score,
    source,
  };
}

function titleEntryHasCategory(titleEntry) {
  return Boolean(normalizeSpaces(titleEntry?.parentCategory || "") || normalizeSpaces(titleEntry?.childCategory || ""));
}

function categoryIdsForPayload(selectedCategory) {
  const ids = [];
  const parentId = Number(selectedCategory?.parentId || 0);
  const categoryId = Number(selectedCategory?.id || 0);

  if (parentId > 0) ids.push(parentId);
  if (categoryId > 0 && !ids.includes(categoryId)) ids.push(categoryId);

  return ids;
}

function selectMappedCategory(categories, titleEntry) {
  if (!titleEntry?.childCategory && !titleEntry?.parentCategory) return null;

  const valid = (Array.isArray(categories) ? categories : []).filter((category) => Number(category?.id || 0) > 0 && normalizeSpaces(category?.name));
  if (valid.length === 0) return null;

  const parentName = comparableCategoryName(titleEntry.parentCategory);
  const childName = comparableCategoryName(titleEntry.childCategory);
  const parentCategory = parentName
    ? valid.find((category) => Number(category.parent || 0) === 0 && comparableCategoryName(category.name) === parentName)
    : null;

  if (childName) {
    const childCandidates = valid.filter((category) => Number(category.parent || 0) > 0 && comparableCategoryName(category.name) === childName);
    const childUnderParent = parentCategory
      ? childCandidates.find((category) => Number(category.parent || 0) === Number(parentCategory.id))
      : null;
    const selectedChild = childUnderParent || childCandidates[0];
    if (selectedChild) return categoryResult(selectedChild, {score: 999, source: "title-file-child"});
  }

  if (parentCategory) return categoryResult(parentCategory, {score: 700, source: "title-file-parent"});
  return null;
}

async function createWordPressCategory({siteUrl, username, appPassword, name, description = "", parentId = 0}) {
  const credentials = wordpressCredentials(username, appPassword);
  const payload = {
    name: normalizeSpaces(name),
    description: normalizeSpaces(description),
  };
  if (Number(parentId || 0) > 0) payload.parent = Number(parentId);

  const response = await fetch(`${wordpressBaseUrl(siteUrl)}/wp-json/wp/v2/categories`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`워드프레스 카테고리 생성 응답을 해석하지 못함: ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data.message || body.slice(0, 300);
    throw new Error(`워드프레스 카테고리 생성 실패: ${message}`);
  }

  return data;
}

async function ensureMappedCategory({categories, titleEntry, siteUrl, username, appPassword}) {
  if (!titleEntryHasCategory(titleEntry)) return null;

  const valid = Array.isArray(categories) ? categories : [];
  const parentName = normalizeSpaces(titleEntry.parentCategory || "");
  const childName = normalizeSpaces(titleEntry.childCategory || "");
  const parentDescription = normalizeSpaces(titleEntry.parentCategoryDescription || "");
  const childDescription = normalizeSpaces(titleEntry.childCategoryDescription || "");
  const parentComparableName = comparableCategoryName(parentName);
  const childComparableName = comparableCategoryName(childName);

  let parentCategory = parentComparableName
    ? valid.find((category) => Number(category.parent || 0) === 0 && comparableCategoryName(category.name) === parentComparableName)
    : null;

  if (!parentCategory && parentName) {
    parentCategory = await createWordPressCategory({
      siteUrl,
      username,
      appPassword,
      name: parentName,
      description: parentDescription,
    });
    valid.push(parentCategory);
  }

  if (childComparableName) {
    let childCategory = valid.find((category) => {
      if (Number(category.parent || 0) <= 0) return false;
      if (comparableCategoryName(category.name) !== childComparableName) return false;
      if (parentCategory) return Number(category.parent || 0) === Number(parentCategory.id);
      return true;
    });

    if (!childCategory && childName) {
      childCategory = await createWordPressCategory({
        siteUrl,
        username,
        appPassword,
        name: childName,
        description: childDescription,
        parentId: Number(parentCategory?.id || 0),
      });
      valid.push(childCategory);
    }

    if (childCategory) return categoryResult(childCategory, {score: 999, source: "title-file-child"});
  }

  if (parentCategory) return categoryResult(parentCategory, {score: 700, source: "title-file-parent"});
  return null;
}

async function fetchWordPressCategories({siteUrl, username, appPassword}) {
  const credentials = wordpressCredentials(username, appPassword);
  const collected = [];
  let page = 1;

  while (true) {
    const url = `${wordpressBaseUrl(siteUrl)}/wp-json/wp/v2/categories?per_page=100&page=${page}&hide_empty=false&orderby=name&order=asc&_fields=id,name,slug,description,parent`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
    });

    const body = await response.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`워드프레스 카테고리 응답을 해석하지 못함: ${body.slice(0, 200)}`);
    }

    if (!response.ok) {
      const message = data.message || body.slice(0, 300);
      throw new Error(`워드프레스 카테고리 조회 실패: ${message}`);
    }

    if (!Array.isArray(data) || data.length === 0) break;
    collected.push(...data);

    const totalPages = Number(response.headers.get("x-wp-totalpages") || 0);
    if (totalPages > 0 && page >= totalPages) break;
    if (data.length < 100) break;
    page += 1;
  }

  return collected;
}

async function generatePostMeta({apiKey, model, title}) {
  const systemPrompt = [
    "너는 한국어 글 제목을 보고 워드프레스 발행 메타를 만드는 편집자다.",
    "반드시 JSON 객체만 출력한다. 설명, 코드블록, 마크다운은 출력하지 않는다.",
    "slug는 제목의 핵심 의미를 영어로 옮긴 소문자 영문 slug여야 한다.",
    "slug는 한국어 로마자 표기가 아니라 의미 번역이어야 하며, 3~6개 영어 단어와 하이픈만 사용한다.",
    "focusKeyword는 제목에서 가장 중요한 한국어 대표키워드 1개 또는 짧은 키워드구여야 한다.",
    "categoryHint는 글을 넣을 워드프레스 카테고리를 고르기 위한 한국어 주제 힌트여야 한다.",
  ].join("\n");

  const userPrompt = [
    `글 제목: ${title}`,
    "아래 JSON 형식으로만 답해.",
    "{",
    '  "slug": "semantic-english-slug",',
    '  "excerpt": "120자 안팎의 한국어 요약문",',
    '  "focusKeyword": "대표키워드 한국어 1개",',
    '  "categoryHint": "카테고리 선택용 한국어 주제 힌트",',
    '  "featuredImageAlt": "대표키워드를 자연스럽게 1회 포함한 대표이미지 대체 텍스트 한국어 1문장",',
    '  "featuredImageCaption": "대표이미지 캡션 한국어 1문장",',
    '  "imageLabel": "이미지 안에 넣기 좋은 6~14자 한국어 핵심 문구"',
    "}",
  ].join("\n");

  const response = await fetch(openAiResponsesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {role: "system", content: systemPrompt},
        {role: "user", content: userPrompt},
      ],
      max_output_tokens: 700,
    }),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`OpenAI 메타 응답을 해석하지 못함: ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data.error?.message || body.slice(0, 300);
    throw new Error(`OpenAI 메타 생성 실패: ${message}`);
  }

  const parsed = extractJsonObject(extractOutputText(data));

  return {
    meta: ensureMetaDefaults(parsed, title),
    usage: extractUsage(data),
  };
}

function fallbackPostMeta(title) {
  return ensureMetaDefaults({
    slug: fallbackSlug(title),
    excerpt: `${title}에 대해 핵심 개념과 확인할 점을 정리한 글입니다.`,
    featuredImageAlt: `${title} 주제를 설명하는 대표 이미지`,
    featuredImageCaption: `${title}의 핵심 내용을 시각적으로 정리한 이미지입니다.`,
    imageLabel: compactKoreanPhrase(title),
  }, title);
}

function imageMimeType(outputFormat) {
  if (outputFormat === "png") return "image/png";
  if (outputFormat === "webp") return "image/webp";
  return "image/jpeg";
}

function imageExtensionFromMimeType(mimeType, fallback) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return fallback === "jpeg" ? "jpg" : fallback;
}

function estimateImageCostUsd({model, quality, size}) {
  const table = {
    "gpt-image-1-mini": {
      low: {"1024x1024": 0.005, "1024x1536": 0.006, "1536x1024": 0.006},
      medium: {"1024x1024": 0.011, "1024x1536": 0.015, "1536x1024": 0.015},
      high: {"1024x1024": 0.036, "1024x1536": 0.052, "1536x1024": 0.052},
    },
    "gpt-image-1": {
      low: {"1024x1024": 0.011, "1024x1536": 0.016, "1536x1024": 0.016},
      medium: {"1024x1024": 0.042, "1024x1536": 0.063, "1536x1024": 0.063},
      high: {"1024x1024": 0.167, "1024x1536": 0.25, "1536x1024": 0.25},
    },
  };
  return table[model]?.[quality]?.[size] || 0;
}

function buildImagePrompt({title, meta}) {
  return [
    "Create one original WordPress featured thumbnail image for a Korean informational article.",
    `Article title: ${title}`,
    `Representative keyword for relevance and alt text: ${meta.focusKeyword || compactKoreanPhrase(title)}`,
    `Core visual phrase: ${meta.imageLabel || compactKoreanPhrase(title)}`,
    "Style: clean, trustworthy, editorial thumbnail, useful for an AdSense approval preparation site.",
    "Aspect ratio and composition: landscape 3:2 WordPress featured image, safe for blog-card thumbnail cropping, with the main subject centered and enough clean margin on all sides.",
    "Composition: one clear visual metaphor or scene that matches the article topic, simple background, strong focal point, mobile-readable at small size.",
    "Do not include any visible text, letters, logos, brand marks, real person faces, copyrighted characters, fake official documents, medical/legal/financial claims, sensational before-after imagery, or clickbait elements.",
    "Use a calm educational mood. Make it look like a relevant article thumbnail, not a generic stock image.",
  ].join("\n");
}

async function generateFeaturedImage({apiKey, title, meta, usdKrw}) {
  const imageModel = env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const imageQuality = env.IMAGE_QUALITY || DEFAULT_IMAGE_QUALITY;
  const imageSize = env.IMAGE_SIZE || DEFAULT_IMAGE_SIZE;
  const imageOutputFormat = env.IMAGE_OUTPUT_FORMAT || DEFAULT_IMAGE_OUTPUT_FORMAT;

  const response = await fetch(openAiImagesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: imageModel,
      prompt: buildImagePrompt({title, meta}),
      n: 1,
      size: imageSize,
      quality: imageQuality,
      output_format: imageOutputFormat,
    }),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`OpenAI 이미지 응답을 해석하지 못함: ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data.error?.message || body.slice(0, 300);
    throw new Error(`OpenAI 대표이미지 생성 실패: ${message}`);
  }

  const imageItem = data.data?.[0] || {};
  let buffer;
  let mimeType = imageMimeType(imageOutputFormat);
  let extension = imageOutputFormat === "jpeg" ? "jpg" : imageOutputFormat;

  if (imageItem.b64_json) {
    buffer = Buffer.from(imageItem.b64_json, "base64");
  } else if (imageItem.url) {
    const imageResponse = await fetch(imageItem.url);
    if (!imageResponse.ok) {
      throw new Error(`OpenAI 이미지 URL 다운로드 실패: HTTP ${imageResponse.status}`);
    }
    mimeType = imageResponse.headers.get("content-type") || mimeType;
    extension = imageExtensionFromMimeType(mimeType, imageOutputFormat);
    buffer = Buffer.from(await imageResponse.arrayBuffer());
  } else {
    throw new Error("OpenAI 이미지 API가 b64_json 또는 url 이미지를 반환하지 않음");
  }

  const estimatedUsd = estimateImageCostUsd({model: imageModel, quality: imageQuality, size: imageSize});
  return {
    buffer,
    mimeType,
    extension,
    imageModel,
    imageQuality,
    imageSize,
    imageOutputFormat,
    usage: data.usage || null,
    estimatedUsd,
    estimatedKrw: Number((estimatedUsd * usdKrw).toFixed(1)),
  };
}

async function uploadFeaturedImage({siteUrl, username, appPassword, title, meta, generatedImage}) {
  const credentials = wordpressCredentials(username, appPassword);
  const mediaUrl = `${wordpressBaseUrl(siteUrl)}/wp-json/wp/v2/media`;
  const uploadResponse = await fetch(mediaUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": generatedImage.mimeType,
      "Content-Disposition": `attachment; filename="${meta.slug}.${generatedImage.extension}"`,
      Accept: "application/json",
    },
    body: generatedImage.buffer,
  });

  const uploadBody = await uploadResponse.text();
  let uploadData;
  try {
    uploadData = JSON.parse(uploadBody);
  } catch {
    throw new Error(`대표이미지 업로드 응답을 해석하지 못함: ${uploadBody.slice(0, 200)}`);
  }
  if (!uploadResponse.ok) {
    const message = uploadData.message || uploadBody.slice(0, 300);
    throw new Error(`대표이미지 업로드 실패: ${message}`);
  }

  const mediaId = Number(uploadData.id);
  if (!mediaId) throw new Error("대표이미지 업로드 후 미디어 ID를 받지 못함");

  const updateResponse = await fetch(`${mediaUrl}/${mediaId}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      title: `${title} 대표이미지`,
      alt_text: meta.featuredImageAlt,
      caption: meta.featuredImageCaption,
      description: meta.featuredImageCaption,
    }),
  });

  const updateBody = await updateResponse.text();
  let updateData = {};
  if (updateBody) {
    try {
      updateData = JSON.parse(updateBody);
    } catch {
      // 원본 업로드는 성공했으므로 응답 내용만 오류 메시지에 포함한다.
    }
  }

  if (!updateResponse.ok) {
    const message = updateData.message || updateBody.slice(0, 300);
    throw new Error(`대표이미지 정보 저장 실패: ${message}`);
  }

  if (normalizeSpaces(updateData.alt_text || "") !== normalizeSpaces(meta.featuredImageAlt)) {
    throw new Error("대표이미지 alt 텍스트 저장 확인 실패");
  }

  const sourceUrl = normalizeSpaces(updateData.source_url || uploadData.source_url || updateData.guid?.rendered || uploadData.guid?.rendered || "");
  if (!sourceUrl) {
    throw new Error("대표이미지 URL을 받지 못해 본문 이미지 블록을 만들 수 없음");
  }

  return {
    id: mediaId,
    sourceUrl,
    altText: meta.featuredImageAlt,
    caption: meta.featuredImageCaption,
  };
}

function buildArticleImageBlock({media}) {
  const caption = normalizeSpaces(media.caption);
  const escapedCaption = escapeHtml(caption);
  const escapedAlt = escapeHtml(media.altText);
  const escapedSrc = escapeHtml(media.sourceUrl);

  return [
    `<!-- wp:image {"id":${media.id},"sizeSlug":"large","linkDestination":"none","className":"makeit-adsense-inline-featured-image"} -->`,
    `<figure class="wp-block-image size-large makeit-adsense-inline-featured-image"><img src="${escapedSrc}" alt="${escapedAlt}" class="wp-image-${media.id}">${caption ? `<figcaption class="wp-element-caption">${escapedCaption}</figcaption>` : ""}</figure>`,
    "<!-- /wp:image -->",
  ].join("\n");
}

function insertImageBlockIntoArticle(html, imageBlock) {
  const blocks = String(html || "")
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) return imageBlock;
  const insertIndex = blocks.length <= 4 ? Math.min(2, blocks.length) : Math.min(Math.max(3, Math.floor(blocks.length / 2)), blocks.length - 1);
  blocks.splice(insertIndex, 0, imageBlock);
  return blocks.join("\n\n").trim();
}

function validateInlineImageBlock(html, media) {
  if (!html.includes(`<!-- wp:image {"id":${media.id},`)) {
    throw new Error("본문 이미지 블록 삽입 확인 실패");
  }
  if (!html.includes(`wp-image-${media.id}`)) {
    throw new Error("본문 이미지 미디어 ID 연결 확인 실패");
  }
  if (!html.includes(`alt="${escapeHtml(media.altText)}"`)) {
    throw new Error("본문 이미지 alt 텍스트 삽입 확인 실패");
  }
}

function postContentText(post) {
  const content = post?.content;
  if (typeof content === "string") return content;
  if (typeof content?.raw === "string") return content.raw;
  if (typeof content?.rendered === "string") return content.rendered;
  return "";
}

function postHasInlineImage(post, media) {
  const content = postContentText(post);
  return content.includes(`wp-image-${media.id}`) || content.includes(`"id":${media.id}`);
}

async function generateArticle({apiKey, model, title, minChars}) {
  const systemPrompt = [
    "너는 애드센스 승인용 정보성 글을 작성하는 한국어 에디터다.",
    "허위 정보, 과장, 출처 없는 단정, 의료/법률/금융 확정 조언을 피한다.",
    "검색 의도에 맞는 실용적인 정보, 구체적인 체크리스트, 주의사항, 단계별 설명을 포함한다.",
    "출력은 워드프레스 블록편집기가 개별 블록으로 인식할 수 있는 Gutenberg-compatible HTML 본문만 작성한다.",
    "반드시 Gutenberg 블록 주석을 사용한다. 예: <!-- wp:heading -->, <!-- wp:paragraph -->, <!-- wp:list -->, <!-- wp:table -->.",
    "h1은 절대 쓰지 않는다. 첫 본문 블록은 h2여야 한다.",
    "첫 h2 소제목은 글 제목과 같으면 안 된다. 제목을 복사하지 말고, 핵심 정리형 소제목으로 다르게 쓴다.",
    "h2, h3, p, ul, ol, li, strong, figure/table 태그를 자연스럽게 사용한다.",
    "코드블록, 마크다운, 설명문, JSON-LD, script, iframe은 출력하지 않는다.",
    "광고 클릭 유도 문구, 구매 강요 문구, 애드센스 정책 위반 가능 문구는 넣지 않는다.",
  ].join("\n");

  const userPrompt = [
    `제목: ${title}`,
    `최소 글자수: 한국어 기준 ${minChars}자 이상`,
    "요청:",
    "- 초보자가 실제로 이해하고 따라할 수 있게 작성",
    "- 첫 문단은 검색자가 왜 이 글을 읽어야 하는지 자연스럽게 설명",
    "- 중간에 체크리스트 또는 단계별 절차 포함",
    "- 마지막은 요약과 주의사항으로 마무리",
    "- 제목과 요약글은 사람이 나중에 직접 다듬을 예정이므로 본문만 출력",
    "- 첫 h2는 제목과 다른 문구로 작성",
    "- 본문 전체를 워드프레스 블록 주석으로 감싼 HTML로 출력",
  ].join("\n");

  const response = await fetch(openAiResponsesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {role: "system", content: systemPrompt},
        {role: "user", content: userPrompt},
      ],
      max_output_tokens: Number(env.ARTICLE_MAX_OUTPUT_TOKENS || 9000),
    }),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`OpenAI 응답을 해석하지 못함: ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data.error?.message || body.slice(0, 300);
    throw new Error(`OpenAI API 실패: ${message}`);
  }

  const html = normalizeArticleHtml(extractOutputText(data), title);
  if (!html) throw new Error("OpenAI가 빈 본문을 반환함");
  validateArticleHtml(html, title);
  return {html, usage: extractUsage(data)};
}

async function createDraftPost({siteUrl, username, appPassword, title, html, date, meta, featuredMediaId, selectedCategory}) {
  const credentials = wordpressCredentials(username, appPassword);
  const payload = {
    title,
    content: html,
    status: "draft",
    slug: meta.slug,
    excerpt: meta.excerpt,
  };
  if (date) payload.date = date;
  if (featuredMediaId) payload.featured_media = featuredMediaId;
  const categoryIds = categoryIdsForPayload(selectedCategory);
  if (categoryIds.length > 0) payload.categories = categoryIds;

  const response = await fetch(`${wordpressBaseUrl(siteUrl)}/wp-json/wp/v2/posts?context=edit`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`워드프레스 응답을 해석하지 못함: ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data.message || body.slice(0, 300);
    throw new Error(`워드프레스 임시글 생성 실패: ${message}`);
  }

  return data;
}

async function updateDraftPostContent({siteUrl, username, appPassword, postId, html, featuredMediaId, selectedCategory}) {
  const credentials = wordpressCredentials(username, appPassword);
  const payload = {content: html};
  if (featuredMediaId) payload.featured_media = featuredMediaId;
  const categoryIds = categoryIdsForPayload(selectedCategory);
  if (categoryIds.length > 0) payload.categories = categoryIds;

  const response = await fetch(`${wordpressBaseUrl(siteUrl)}/wp-json/wp/v2/posts/${postId}?context=edit`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`워드프레스 본문 재확인 응답을 해석하지 못함: ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data.message || body.slice(0, 300);
    throw new Error(`워드프레스 본문 이미지 복구 실패: ${message}`);
  }

  return data;
}

// 라이센스 게이트(수강 코드 확인) 통과 후, process.env 우선 + .env.local 보조로 설정을 읽는다 (PRD D8·D9)
const env = requireLicense({scriptLabel: "애드센스 승인글 만들기"});
const site = Number(argValue("site", "1"));
const limit = Number(argValue("limit", "0"));
const includeUsedTitles = ["1", "true", "yes"].includes(argValue("include-used", "0").toLowerCase());
const dryRun = ["1", "true", "yes"].includes(argValue("dry-run", "0").toLowerCase());
const prefix = sitePrefix(site);
const model = env.ARTICLE_MODEL || "gpt-5.4-mini";
const minChars = Number(env.ARTICLE_MIN_CHARS || 3000);
const titlesPath = resolveTitleFile(projectRoot, site, argValue("titles", ""));
const outputDir = join(programRoot, "makeit-adsense", "outputs", `site-${String(site).padStart(2, "0")}`);
const visibleOutputDir = join(
  projectRoot,
  "01_1주차_애드센스승인",
  "02_생성결과_확인용",
  `site-${String(site).padStart(2, "0")}`,
);
const dateMode = argValue("date-mode", "past-daily");
const startDate = parseDate(argValue("start-date", "")) || defaultStartDate(dateMode);
const usdKrw = Number(env.ARTICLE_USD_KRW || DEFAULT_USD_KRW);

if (!dryRun && !ready(env.OPENAI_API_KEY, ["sk-your"])) {
  console.error(keysGuideMessage("OpenAI API 키"));
  process.exit(1);
}

const siteUrl = env[`${prefix}_URL`];
const username = env[`${prefix}_USER`];
const appPassword = env[`${prefix}_APP_PASSWORD`];

if (!dryRun && (!ready(siteUrl, ["example.com", "example-"]) || !ready(username, ["your-admin-id"]) || !ready(appPassword, ["xxxx"]))) {
  console.error(`${prefix} 연결 정보가 부족합니다. 워드프레스 주소, 관리자 아이디, 애플리케이션 비밀번호가 필요해요.`);
  console.error(keysGuideMessage(`사이트${site} 워드프레스 연결 정보`));
  process.exit(1);
}

const titleCatalog = readTitleEntries(titlesPath);
const allTitleEntries = titleCatalog.entries;
const previousDraftHistory = readDraftHistory(outputDir, visibleOutputDir);
const usedTitleKeys = new Set(previousDraftHistory.map((entry) => titleKey(entry.title)));
const availableTitleEntries = includeUsedTitles
  ? allTitleEntries
  : allTitleEntries.filter((entry) => !usedTitleKeys.has(titleKey(entry.title)));
const titleEntries = limit > 0 ? availableTitleEntries.slice(0, limit) : availableTitleEntries;
const titles = titleEntries.map((entry) => entry.title);
if (titles.length === 0) {
  if (allTitleEntries.length > 0 && previousDraftHistory.length > 0 && !includeUsedTitles) {
    console.error("새로 만들 제목이 없음. 이전에 성공한 제목은 자동으로 건너뜀. 다시 만들려면 --include-used=1을 붙이면 됨.");
  } else {
    console.error("제목 목록이 비어 있음. titles.txt에 제목을 한 줄에 하나씩 넣어야 함.");
  }
  process.exit(1);
}

let wordpressCategories = [];
if (!dryRun) {
  try {
    wordpressCategories = await fetchWordPressCategories({siteUrl, username, appPassword});
  } catch (categoryError) {
    const message = categoryError instanceof Error ? categoryError.message : String(categoryError);
    console.log(`카테고리 자동 선택 준비 실패: ${message}`);
  }
}

mkdirSync(outputDir, {recursive: true});
mkdirSync(visibleOutputDir, {recursive: true});

console.log(`애드센스 사이트 ${site}번 임시글 생성 시작`);
console.log(`제목 파일: ${titlesPath}`);
console.log(`제목 ${titles.length}개 선택 / 전체 ${allTitleEntries.length}개 / 이전 성공 ${previousDraftHistory.length}개 자동 제외 / 모델 ${model} / 본문 ${minChars}자 이상 목표`);
if (limit > 0) {
  console.log(`요청 개수: ${limit}개 / 사용된 제목은 건너뛰고 다음 제목부터 진행`);
}
if (titleCatalog.categories.length > 0) {
  console.log(`제목 파일 카테고리 매핑: 대표 ${titleCatalog.categories.length}개 / 세부 ${titleCatalog.categories.reduce((sum, category) => sum + category.children.length, 0)}개`);
}
if (titleCatalog.warnings.length > 0) {
  console.log("제목 파일 점검 경고:");
  titleCatalog.warnings.forEach((warning) => console.log(`- ${warning}`));
}
console.log(`워드프레스 카테고리 ${wordpressCategories.length}개 확인 / 글마다 제목에 맞춰 자동 선택`);
console.log("본문 전체는 화면에 출력하지 않고, 워드프레스 임시글과 outputs 폴더에만 저장함.");
if (dateMode !== "none") {
  console.log(`임시글 날짜: ${dateMode} / 시작 날짜 ${dateOnly(startDate)} / 하루 1개씩 분산`);
}
console.log("=".repeat(44));

if (dryRun) {
  console.log("DRY RUN: 실제 글/이미지 생성과 워드프레스 업로드는 하지 않음.");
  titles.forEach((title, index) => console.log(`[${index + 1}/${titles.length}] ${title}`));
  process.exit(0);
}

const results = [];
for (let index = 0; index < titles.length; index += 1) {
  const titleEntry = titleEntries[index];
  const title = titleEntry.title;
  try {
    console.log(`[${index + 1}/${titles.length}] 생성 중: ${title}`);
    const existingPost = await findExistingPostByTitle({siteUrl, username, appPassword, title});
    if (existingPost) {
      results.push({site, title, ok: true, skipped: true, reason: "duplicate-on-wordpress", postId: existingPost.id, status: existingPost.status});
      console.log(`  건너뜀: 워드프레스에 같은 제목의 글이 이미 있음 (ID ${existingPost.id} / 상태 ${existingPost.status})`);
      continue;
    }
    let meta = fallbackPostMeta(title);
    let metaUsage = {inputTokens: 0, outputTokens: 0, totalTokens: 0};
    try {
      const generatedMeta = await generatePostMeta({apiKey: env.OPENAI_API_KEY, model, title});
      meta = generatedMeta.meta;
      metaUsage = generatedMeta.usage;
    } catch (metaError) {
      const message = metaError instanceof Error ? metaError.message : String(metaError);
      console.log(`  메타 보정: ${message}`);
    }

    const {html, usage: articleUsage} = await generateArticle({apiKey: env.OPENAI_API_KEY, model, title, minChars});
    const usage = mergeUsage(metaUsage, articleUsage);
    let selectedCategory = null;
    if (titleEntryHasCategory(titleEntry)) {
      selectedCategory = await ensureMappedCategory({categories: wordpressCategories, titleEntry, siteUrl, username, appPassword});
      if (!selectedCategory) {
        console.log("  카테고리 매핑: 제목 파일의 대표/세부 카테고리를 찾지 못해 자동 점수 선택을 건너뜀");
      }
    } else {
      selectedCategory = selectBestCategory(wordpressCategories, {title, meta});
    }
    const generatedImage = await generateFeaturedImage({apiKey: env.OPENAI_API_KEY, title, meta, usdKrw});
    const featuredMedia = await uploadFeaturedImage({siteUrl, username, appPassword, title, meta, generatedImage});
    const htmlWithImage = insertImageBlockIntoArticle(html, buildArticleImageBlock({media: featuredMedia}));
    validateArticleHtml(htmlWithImage, title);
    validateInlineImageBlock(htmlWithImage, featuredMedia);
    const localPath = join(outputDir, `${String(index + 1).padStart(3, "0")}_${safeFilename(title)}.html`);
    const visiblePath = join(visibleOutputDir, `${String(index + 1).padStart(3, "0")}_${safeFilename(title)}.html`);
    writeFileSync(localPath, htmlWithImage, "utf8");
    writeFileSync(visiblePath, htmlWithImage, "utf8");

    const postDate = postDateForIndex(index, dateMode, startDate);
    let post = await createDraftPost({siteUrl, username, appPassword, title, html: htmlWithImage, date: postDate, meta, featuredMediaId: featuredMedia.id, selectedCategory});
    if (!postHasInlineImage(post, featuredMedia)) {
      post = await updateDraftPostContent({siteUrl, username, appPassword, postId: post.id, html: htmlWithImage, featuredMediaId: featuredMedia.id, selectedCategory});
    }
    if (!postHasInlineImage(post, featuredMedia)) {
      throw new Error("워드프레스 임시글 본문에 이미지 블록이 저장되지 않았습니다.");
    }
    const textCost = estimateCost({model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usdKrw});
    const estimatedUsd = Number((textCost.estimatedUsd + generatedImage.estimatedUsd).toFixed(6));
    const estimatedKrw = Number((textCost.estimatedKrw + generatedImage.estimatedKrw).toFixed(1));
    results.push({
      site,
      title,
      ok: true,
      postId: post.id,
      date: post.date || postDate,
      status: "draft",
      slug: post.slug || meta.slug,
      focusKeyword: meta.focusKeyword,
      featuredImageAlt: meta.featuredImageAlt,
      featuredMediaId: featuredMedia.id,
      featuredImageUrl: featuredMedia.sourceUrl,
      inlineImageInserted: true,
      inlineImageMediaId: featuredMedia.id,
      postContentImageVerified: true,
      inlineImageAlt: featuredMedia.altText,
      inlineImageCaption: featuredMedia.caption,
      mappedParentCategory: titleEntry.parentCategory || "",
      mappedChildCategory: titleEntry.childCategory || "",
      mappedChildCategoryDescription: titleEntry.childCategoryDescription || "",
      categoryId: selectedCategory?.id || 0,
      parentCategoryId: selectedCategory?.parentId || 0,
      categoryIds: categoryIdsForPayload(selectedCategory),
      categoryName: selectedCategory?.name || "",
      categoryScore: selectedCategory?.score ?? null,
      categorySelectionSource: selectedCategory?.source || "none",
      imageModel: generatedImage.imageModel,
      imageQuality: generatedImage.imageQuality,
      imageSize: generatedImage.imageSize,
      imageOutputFormat: generatedImage.imageOutputFormat,
      editLink: post.link || "",
      localPath,
      visiblePath,
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      text_estimated_usd: textCost.estimatedUsd,
      text_estimated_krw: textCost.estimatedKrw,
      image_estimated_usd: generatedImage.estimatedUsd,
      image_estimated_krw: generatedImage.estimatedKrw,
      estimated_usd: estimatedUsd,
      estimated_krw: estimatedKrw,
    });
    const categorySourceLabel = selectedCategory?.source ? `(${selectedCategory.source})` : "";
    const categoryLabel = selectedCategory ? ` / 카테고리 ${selectedCategory.name}${categorySourceLabel}` : " / 카테고리 미지정";
    console.log(`  완료: 임시글 ID ${post.id} / slug ${post.slug || meta.slug} / 키워드 ${meta.focusKeyword} / OpenAI 대표이미지+본문이미지 ${featuredMedia.id}${categoryLabel} / 날짜 ${post.date || postDate || "기본값"} / 약 ${estimatedKrw}원`);
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|certificate/i.test(message)) {
      message += " → 사이트 주소를 확인해주세요. https:// 를 포함한 전체 도메인(예: https://example.com)인지, 오타가 없는지 확인한 뒤 다시 실행하면 됩니다.";
    }
    results.push({site, title, ok: false, error: message});
    console.log(`  실패: ${message}`);
  }
}

writeFileSync(join(outputDir, "last-run.json"), JSON.stringify(results, null, 2), "utf8");
writeFileSync(join(visibleOutputDir, "last-run.json"), JSON.stringify(results, null, 2), "utf8");
const draftHistory = mergeDraftHistory(previousDraftHistory, results);
writeFileSync(join(outputDir, "draft-history.json"), JSON.stringify(draftHistory, null, 2), "utf8");
writeFileSync(join(visibleOutputDir, "draft-history.json"), JSON.stringify(draftHistory, null, 2), "utf8");

const costSummary = results.reduce(
  (acc, item) => {
    if (!item.ok || item.skipped) return acc;
    acc.success += 1;
    acc.input_tokens += Number(item.input_tokens || 0);
    acc.output_tokens += Number(item.output_tokens || 0);
    acc.total_tokens += Number(item.total_tokens || 0);
    acc.text_estimated_usd += Number(item.text_estimated_usd || 0);
    acc.text_estimated_krw += Number(item.text_estimated_krw || 0);
    acc.image_estimated_usd += Number(item.image_estimated_usd || 0);
    acc.image_estimated_krw += Number(item.image_estimated_krw || 0);
    acc.estimated_usd += Number(item.estimated_usd || 0);
    acc.estimated_krw += Number(item.estimated_krw || 0);
    return acc;
  },
  {
    site,
    model,
    imageModel: env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    imageQuality: env.IMAGE_QUALITY || DEFAULT_IMAGE_QUALITY,
    imageSize: env.IMAGE_SIZE || DEFAULT_IMAGE_SIZE,
    success: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    text_estimated_usd: 0,
    text_estimated_krw: 0,
    image_estimated_usd: 0,
    image_estimated_krw: 0,
    estimated_usd: 0,
    estimated_krw: 0,
    usd_krw: usdKrw,
  },
);
costSummary.text_estimated_usd = Number(costSummary.text_estimated_usd.toFixed(6));
costSummary.text_estimated_krw = Number(costSummary.text_estimated_krw.toFixed(1));
costSummary.image_estimated_usd = Number(costSummary.image_estimated_usd.toFixed(6));
costSummary.image_estimated_krw = Number(costSummary.image_estimated_krw.toFixed(1));
costSummary.estimated_usd = Number(costSummary.estimated_usd.toFixed(6));
costSummary.estimated_krw = Number(costSummary.estimated_krw.toFixed(1));
writeFileSync(join(outputDir, "cost-summary.json"), JSON.stringify(costSummary, null, 2), "utf8");
writeFileSync(join(visibleOutputDir, "cost-summary.json"), JSON.stringify(costSummary, null, 2), "utf8");

const success = results.filter((item) => item.ok && !item.skipped).length;
const skippedCount = results.filter((item) => item.skipped).length;
console.log("=".repeat(44));
console.log(`완료: 성공 ${success}개 / 중복 건너뜀 ${skippedCount}개 / 실패 ${results.length - success - skippedCount}개`);
console.log(`결과 기록: ${join(outputDir, "last-run.json")}`);
console.log(`누적 기록: ${join(outputDir, "draft-history.json")}`);
console.log(`비용 기록: ${join(outputDir, "cost-summary.json")}`);
console.log("워드프레스에는 모두 임시글로 저장됨. 제목과 요약글은 사람이 직접 확인한 뒤 발행해야 함.");

if (success !== results.length) process.exitCode = 1;
