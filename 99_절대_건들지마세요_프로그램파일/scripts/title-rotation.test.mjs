import assert from "node:assert/strict";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {readTitleEntries} from "./title-files.mjs";
import {categoryKey, readTitleRotation, rotateTitleEntries, saveTitleRotation} from "./title-rotation.mjs";
import {VALID_LICENSE_CODES} from "./lib/env.mjs";

const titleKey = (title) => title.trim().normalize("NFC").toLowerCase();
const entry = (title, child = 0, parent = 1) => ({title, parentCategoryNumber: parent, childCategoryNumber: child});
const entries = [entry("A1", 1), entry("A2", 1), entry("B1", 2), entry("B2", 2), entry("C1", 1, 2), entry("C2", 1, 2)];
const select = (rows = entries, options = {}) => rotateTitleEntries(rows, {titleKey, ...options});
const titles = (rows) => rows.map((row) => row.title);

test("세부카테고리마다 하나씩 순환하고 같은 세부번호라도 상위가 다르면 구분한다", () => {
  assert.deepEqual(titles(select()), ["A1", "B1", "C1", "A2", "B2", "C2"]);
  assert.deepEqual(titles(select(entries, {limit: 4})), ["A1", "B1", "C1", "A2"]);
});

test("이미 쓴 제목, 소진된 카테고리, 중복 제목을 건너뛴다", () => {
  const usedTitleKeys = new Set(["a1", "a2", "c1"]);
  assert.deepEqual(titles(select([...entries, entry(" b1 ", 1)], {usedTitleKeys})), ["B1", "C2", "B2"]);
  assert.deepEqual(select(entries, {usedTitleKeys: new Set(entries.map((e) => titleKey(e.title)))}), []);
});

test("소진된 카테고리 뒤에서도 저장 위치부터 이어 간다", () => {
  assert.deepEqual(titles(select(entries, {lastCategory: categoryKey(entries[0]), usedTitleKeys: new Set(["a1", "a2"]), limit: 1})), ["B1"]);
});

test("카테고리가 없으면 원래 순서로 고르고 없어진 저장 카테고리는 처음부터 순환한다", () => {
  const plain = [{title: "하나"}, {title: "둘"}];
  assert.deepEqual(titles(select(plain)), ["하나", "둘"]);
  assert.deepEqual(titles(select(entries, {lastCategory: "removed", limit: 2})), ["A1", "B1"]);
  assert.deepEqual(select([]), []);
});

test("실패한 제목은 사용 처리하지 않고 이후 순환에서 재시도한다", () => {
  // A1 실패, B1 성공 후 중단. C를 거쳐 A1을 다시 선택해야 한다.
  assert.deepEqual(titles(select(entries, {lastCategory: categoryKey(entries[2]), usedTitleKeys: new Set(["b1"]), limit: 3})), ["C1", "A1", "B2"]);
});

test("위치를 디스크에 저장하고 새 프로세스에서도 이어 간다", () => {
  const dir = mkdtempSync(join(tmpdir(), "makeit-rotation-"));
  try {
    const file = join(dir, "title-rotation.json");
    assert.equal(readTitleRotation(file).lastCategory, "");
    saveTitleRotation(file, entries[0]);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import {readTitleRotation, rotateTitleEntries} from ${JSON.stringify(new URL("./title-rotation.mjs", import.meta.url).href)};
      const selected = rotateTitleEntries(${JSON.stringify(entries)}, {
        ...readTitleRotation(${JSON.stringify(file)}), titleKey: t => t.toLowerCase(), usedTitleKeys: new Set(["a1"]), limit: 1
      });
      console.log(selected[0].title);
    `], {encoding: "utf8"});
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "B1");
    saveTitleRotation(file, entries[2]);
    assert.equal(readTitleRotation(file).lastCategory, categoryKey(entries[2]));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("손상된 진행 위치를 조용히 초기화하지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "makeit-rotation-"));
  try {
    const file = join(dir, "title-rotation.json");
    for (const text of ["{", "null", '{"version":2,"lastCategory":""}']) {
      writeFileSync(file, text);
      assert.throws(() => readTitleRotation(file));
      assert.equal(readFileSync(file, "utf8"), text);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("실제 제목 파서와 함께 순환해도 원본 파일은 그대로 유지한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "makeit-rotation-"));
  try {
    const file = join(dir, "titles.txt");
    const text = "카테고리 1: 생활\n세부카테고리 1-1: 식사\n1. 아침\n2. 점심\n세부카테고리 1-2: 운동\n3. 걷기\n4. 달리기\n";
    writeFileSync(file, text);
    const catalog = readTitleEntries(file);
    assert.deepEqual(titles(select(catalog.entries)), ["아침", "걷기", "점심", "달리기"]);
    saveTitleRotation(join(dir, "title-rotation.json"), catalog.entries[0]);
    assert.equal(readFileSync(file, "utf8"), text);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("실제 실행 스크립트는 기존 글 확인 직후 저장하고 재실행·dry-run을 안전하게 처리한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "makeit-rotation-cli-"));
  try {
    // 실제 서비스 접속 없이 CLI 전체 경로를 실행한다. 테스트 전용 복사본만 쓴다.
    const scripts = join(dir, "program", "scripts");
    cpSync(new URL(".", import.meta.url), scripts, {recursive: true});
    const titlesFile = join(dir, "titles.txt");
    const original = "카테고리 1: 생활\n세부카테고리 1-1: 식사\n1. 아침\n2. 점심\n세부카테고리 1-2: 운동\n3. 걷기\n4. 달리기\n";
    writeFileSync(titlesFile, original);
    const mock = join(dir, "mock-fetch.mjs");
    writeFileSync(mock, `globalThis.fetch = async (input) => {
      const url = new URL(input);
      const title = url.searchParams.get("search");
      return new Response(JSON.stringify(title ? [{id: 123, title: {raw: title}, status: "draft"}] : []),
        {status: 200, headers: {"content-type": "application/json"}});
    };`);
    const env = {...process.env, MAKEIT_PROJECT_ROOT: dir, MAKEIT_MIDDLE_LICENSE: VALID_LICENSE_CODES[0],
      OPENAI_API_KEY: "test-only", ADSENSE_SITE_01_URL: "https://wordpress.invalid",
      ADSENSE_SITE_01_USER: "test-only", ADSENSE_SITE_01_APP_PASSWORD: "test-only"};
    const run = (...args) => {
      const child = spawnSync(process.execPath, ["--import", mock, join(scripts, "adsense-create-drafts.mjs"), `--titles=${titlesFile}`, "--limit=1", ...args], {env, encoding: "utf8"});
      assert.equal(child.status, 0, child.stdout + child.stderr);
      return child.stdout;
    };
    const output = join(dir, "애드센스 승인글", "02_생성결과_확인용", "site-01");
    const cursor = join(output, "title-rotation.json");
    run("--dry-run=1", "--include-used=1");
    assert.equal(existsSync(cursor), false);
    run();
    const firstCursor = readFileSync(cursor, "utf8");
    assert.match(run("--dry-run=1", "--include-used=1"), /\[1\/1\] 걷기/);
    assert.equal(readFileSync(cursor, "utf8"), firstCursor);
    run();
    const history = JSON.parse(readFileSync(join(output, "draft-history.json"), "utf8"));
    assert.deepEqual(history.map((row) => row.title), ["아침", "걷기"]);
    assert.equal(readFileSync(titlesFile, "utf8"), original);
    // 다른 사이트는 같은 결과 폴더를 공유하지 않는다.
    mkdirSync(join(dir, "other"));
    assert.notEqual(readTitleRotation(cursor).lastCategory, "");
    assert.equal(readTitleRotation(join(dir, "other", "title-rotation.json")).lastCategory, "");
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
