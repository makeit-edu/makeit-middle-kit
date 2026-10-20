import {readFileSync, renameSync, writeFileSync} from "node:fs";

export function categoryKey(entry) {
  return JSON.stringify([entry.parentCategoryNumber || 0, entry.parentCategory || "", entry.childCategoryNumber || 0, entry.childCategory || ""]);
}

export function readTitleRotation(filePath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {lastCategory: ""};
    throw error;
  }
  const state = JSON.parse(text);
  if (state?.version !== 1 || typeof state.lastCategory !== "string") {
    throw new Error("제목 순환 위치 파일을 읽을 수 없습니다. 저장된 진행 기록을 확인해주세요.");
  }
  return state;
}

// 모든 카테고리 순서는 원본 순서로 유지한다. 소진된 카테고리도 위치를
// 찾는 데 사용해야, 마지막 카테고리가 소진된 다음 실행도 이어진다.
export function rotateTitleEntries(entries, {lastCategory = "", usedTitleKeys = new Set(), titleKey, limit = 0} = {}) {
  const groups = new Map();
  const seen = new Set(usedTitleKeys);
  for (const entry of entries) {
    const key = categoryKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    const normalized = titleKey(entry.title);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    groups.get(key).push(entry);
  }
  const keys = [...groups.keys()];
  if (!keys.length) return [];
  const start = (keys.indexOf(lastCategory) + 1) % keys.length;
  const ordered = keys.slice(start).concat(keys.slice(0, start));
  const selected = [];
  const offsets = new Map();
  let added;
  do {
    added = false;
    for (const key of ordered) {
      const offset = offsets.get(key) || 0;
      const entry = groups.get(key)[offset];
      if (!entry) continue;
      selected.push(entry);
      offsets.set(key, offset + 1);
      added = true;
      if (limit > 0 && selected.length >= limit) return selected;
    }
  } while (added);
  return selected;
}

export function saveTitleRotation(filePath, entry) {
  const state = {version: 1, lastCategory: categoryKey(entry)};
  // 중간 쓰기 상태를 남기지 않는다. 작업 폴더에 저장해야 프로그램이
  // 다음 실행에서 다른 임시 폴더에 풀려도 위치가 이어진다.
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(temporary, filePath);
}
