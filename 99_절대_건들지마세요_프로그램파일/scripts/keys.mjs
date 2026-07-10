#!/usr/bin/env node

// 키설정 (npm run keys) — 수강 코드 + API 키 + 워드프레스 정보를 대화형으로 입력받아 .env.local에 저장한다.
// (PRD D8·D9·5-5: 키 2개(OpenAI·ElevenLabs) + 수강 코드 1개, trim + 형식 검증 + 실제 인증 테스트 + 마스킹 출력)
// 입력한 값은 .env.local 파일에만 저장되고, 화면에 다시 출력하지 않습니다.
import {copyFileSync, existsSync, readFileSync, writeFileSync} from "node:fs";
import {stdin as input, stdout as output} from "node:process";
import readline from "node:readline/promises";
import {
  ENV_EXAMPLE_PATH,
  ENV_LOCAL_PATH,
  VALID_LICENSE_CODES,
  maskValue,
} from "./lib/env.mjs";

const placeholders = {
  MAKEIT_MIDDLE_LICENSE: ["your-", "placeholder"],
  OPENAI_API_KEY: ["sk-your", "your-openai", "placeholder"],
  ELEVENLABS_API_KEY: ["your-elevenlabs", "placeholder"],
  URL: ["example.com", "example-"],
  USER: ["your-admin-id", "your-admin"],
  APP_PASSWORD: ["xxxx", "placeholder"],
};

function ensureEnvLocal() {
  if (existsSync(ENV_LOCAL_PATH)) return;
  if (existsSync(ENV_EXAMPLE_PATH)) {
    copyFileSync(ENV_EXAMPLE_PATH, ENV_LOCAL_PATH);
    return;
  }
  writeFileSync(ENV_LOCAL_PATH, "", "utf8");
}

function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const values = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return {lines, values};
}

function ready(kind, value) {
  const text = String(value || "").trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  return !(placeholders[kind] || []).some((token) => lowered.includes(token));
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

// 기존 .env.local의 줄 순서·주석을 유지하면서 값만 갱신한다 (없는 키는 끝에 추가)
function updateEnv(lines, updates) {
  const used = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    used.add(key);
    return `${key}=${updates[key]}`;
  });

  const missing = Object.keys(updates).filter((key) => !used.has(key));
  if (missing.length > 0 && next.length > 0 && next[next.length - 1].trim() !== "") next.push("");
  for (const key of missing) next.push(`${key}=${updates[key]}`);

  return `${next.join("\n").replace(/\s+$/, "")}\n`;
}

// ===== 입력 계층 =====
// 대화형 TTY: readline 인터페이스 하나를 끝까지 재사용한다.
// 파이프(non-TTY): readline의 question 대기 밖에서 도착한 줄은 소리 없이 유실되어
//   다음 await가 영원히 pending(unsettled top-level await, exit 13)된다. 실측으로 확인된 크래시.
//   그래서 non-TTY에서는 stdin "전체"를 먼저 읽어 줄 큐로 만들어두고 질문마다 하나씩 꺼내 쓴다.
const isInteractive = Boolean(input.isTTY && input.setRawMode);
let pipedLines = null;

async function preloadPipedInput() {
  if (isInteractive || pipedLines) return;
  const chunks = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  pipedLines = text.length === 0 ? [] : text.split(/\r?\n/);
  // 마지막 트레일링 뉴라인이 만든 빈 꼬리는 제거 (실제 빈 답(엔터)은 중간 줄로 유지됨)
  if (pipedLines.length > 0 && pipedLines[pipedLines.length - 1] === "") pipedLines.pop();
}

function nextPipedLine() {
  if (!pipedLines || pipedLines.length === 0) return "";
  return pipedLines.shift();
}

// 공통 질문 함수 — TTY면 rl.question, 파이프면 미리 읽어둔 줄 큐에서 소비
async function ask(rl, prompt) {
  if (!isInteractive) {
    output.write(prompt);
    const answer = nextPipedLine();
    output.write("\n");
    return answer;
  }
  return await rl.question(prompt);
}

async function askVisible(rl, question, currentValue, {normalize = (v) => v.trim()} = {}) {
  const suffix = String(currentValue || "").trim() ? " (그대로 두려면 엔터)" : " (건너뛰려면 엔터)";
  const answer = await ask(rl, `${question}${suffix}: `);
  return answer.trim() ? normalize(answer) : String(currentValue || "").trim();
}

// 비밀값 입력 — 화면에 글자를 표시하지 않는다
async function askHidden(rl, question, currentValue) {
  const suffix = String(currentValue || "").trim() ? " (그대로 두려면 엔터)" : "";
  if (!isInteractive) {
    const answer = await ask(rl, `${question}${suffix}: `);
    return answer.trim() || String(currentValue || "").trim();
  }

  output.write(`${question}${suffix}: `);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  let value = "";
  return await new Promise((resolve) => {
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          input.setRawMode(false);
          input.off("data", onData);
          output.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          input.setRawMode(false);
          input.off("data", onData);
          output.write("\n");
          resolve(value.trim() || String(currentValue || "").trim());
          return;
        }
        if (char === "\u0008" || char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    input.on("data", onData);
  });
}

// ===== 실제 인증 테스트 (저장 후 확인용 — 실패해도 저장은 유지) =====

async function testOpenAi(key) {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {Authorization: `Bearer ${key}`},
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return {ok: false, detail: "키가 올바르지 않습니다 (401). 복사가 잘못되지 않았는지 확인해주세요."};
    if (!response.ok) return {ok: false, detail: `상태 코드 ${response.status}. 잠시 후 다시 확인해주세요.`};
    return {ok: true, detail: "인증 확인됨"};
  } catch {
    return {ok: false, detail: "연결 실패 — 인터넷 연결을 확인하고 나중에 다시 실행해주세요."};
  }
}

async function testElevenLabs(key) {
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: {"xi-api-key": key},
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return {ok: false, detail: "키가 올바르지 않습니다 (401). 복사가 잘못되지 않았는지 확인해주세요."};
    if (!response.ok) return {ok: false, detail: `상태 코드 ${response.status}. 잠시 후 다시 확인해주세요.`};
    return {ok: true, detail: "인증 확인됨"};
  } catch {
    return {ok: false, detail: "연결 실패 — 인터넷 연결을 확인하고 나중에 다시 실행해주세요."};
  }
}

async function testWordPress({url, user, appPassword}) {
  if (!url || !user || !appPassword) return {ok: false, detail: "주소·아이디·애플리케이션 비밀번호가 모두 필요합니다."};
  const credentials = Buffer.from(`${user}:${appPassword}`).toString("base64");
  try {
    const response = await fetch(`${url}/wp-json/wp/v2/users/me?context=edit`, {
      headers: {Authorization: `Basic ${credentials}`, Accept: "application/json"},
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return {ok: false, detail: `상태 코드 ${response.status}. 도메인, 관리자 ID, 애플리케이션 비밀번호를 확인해주세요.`};
    }
    return {ok: true, detail: "워드프레스 연결 확인됨"};
  } catch (error) {
    return {ok: false, detail: error instanceof Error ? error.message : String(error)};
  }
}

// ===== 본 흐름 =====

ensureEnvLocal();

const original = readFileSync(ENV_LOCAL_PATH, "utf8");
const {lines, values} = parseEnv(original);

console.log("");
console.log("==================================================");
console.log(" 키설정 — 수강 코드와 API 키를 안전하게 저장합니다");
console.log("==================================================");
console.log("입력한 값은 .env.local 파일에만 저장됩니다. (이 파일은 절대 커밋되지 않아요)");
console.log("API 키 값은 화면에 표시되지 않고, 다시 출력하지도 않습니다.");
console.log("※ 화면공유(줌 등) 중이라면 잠시 공유를 멈추고 진행해주세요.");
console.log("");
console.log("현재 상태");
console.log(`- 수강 코드: ${VALID_LICENSE_CODES.includes(String(values.MAKEIT_MIDDLE_LICENSE || "").trim()) ? "입력됨" : "미입력"}`);
console.log(`- OpenAI API 키: ${ready("OPENAI_API_KEY", values.OPENAI_API_KEY) ? `입력됨 ${maskValue(values.OPENAI_API_KEY)}` : "미입력"}`);
console.log(`- ElevenLabs API 키: ${ready("ELEVENLABS_API_KEY", values.ELEVENLABS_API_KEY) ? `입력됨 ${maskValue(values.ELEVENLABS_API_KEY)}` : "미입력"}`);
console.log("");

// 파이프 입력이면 stdin 전체를 먼저 줄 큐로 읽어둔다 (질문 사이 유실 방지 — 위 입력 계층 주석 참고)
await preloadPipedInput();
const rl = isInteractive ? readline.createInterface({input, output}) : null;
const updates = {};

// 1) 수강 코드 (필수) — 즉시 검증, 3회 실패 시 중단
let licenseCode = String(values.MAKEIT_MIDDLE_LICENSE || "").trim();
const licenseValid = (code) => VALID_LICENSE_CODES.includes(code);
for (let attempt = 1; attempt <= 3; attempt++) {
  const hint = licenseValid(licenseCode) ? " (이미 확인됨 — 그대로 두려면 엔터)" : "";
  const answer = (await ask(rl, `수강 코드를 입력해주세요${hint}: `)).trim();
  if (!answer && licenseValid(licenseCode)) break;
  if (licenseValid(answer)) {
    licenseCode = answer;
    break;
  }
  console.log("  → 수강 코드가 올바르지 않아요. 강의 자료실 공지의 코드를 다시 확인해주세요.");
  if (attempt === 3) {
    console.log("");
    console.log("수강 코드 확인에 3번 실패해서 여기서 멈출게요.");
    console.log("강의 자료실 공지에서 코드를 확인한 뒤, 터미널에 '키설정' 을 다시 입력해주세요.");
    if (rl) rl.close();
    process.exit(1);
  }
}
updates.MAKEIT_MIDDLE_LICENSE = licenseCode;
console.log("  → 수강 코드 확인 완료!");
console.log("");

// 2) 주차 선택
const weekAnswer = (await ask(rl, "어느 주차 키를 설정할까요? [1] 1주차(애드센스)  [2] 2주차(쇼핑숏폼)  [엔터] 전부: ")).trim();
const doWeek1 = weekAnswer === "" || weekAnswer === "1";
const doWeek2 = weekAnswer === "" || weekAnswer === "2";
console.log("");

// 3) OpenAI API 키 (1·2주차 공통) — sk- 접두 형식 검증 (예시값은 "기존 값"으로 치지 않는다)
let openAiKey = await askHidden(rl, "OpenAI API 키를 입력해주세요", ready("OPENAI_API_KEY", values.OPENAI_API_KEY) ? values.OPENAI_API_KEY : "");
if (openAiKey && !openAiKey.startsWith("sk-")) {
  console.log("  → OpenAI 키는 보통 sk- 로 시작해요. 복사할 때 앞뒤가 잘리지 않았는지 확인해주세요.");
  openAiKey = await askHidden(rl, "OpenAI API 키를 다시 입력해주세요 (지금 값을 그대로 쓰려면 엔터)", openAiKey);
  if (openAiKey && !openAiKey.startsWith("sk-")) {
    console.log("  → 형식이 조금 다르지만 입력하신 값을 그대로 저장할게요.");
  }
}
updates.OPENAI_API_KEY = openAiKey;

// 4) 1주차 — 애드센스 사이트 1~3 워드프레스 정보
if (doWeek1) {
  console.log("");
  console.log("----- 1주차: 애드센스 사이트 워드프레스 정보 -----");
  console.log("(아직 준비 안 된 사이트는 엔터로 건너뛰면 됩니다)");
  for (const n of [1, 2, 3]) {
    const prefix = `ADSENSE_SITE_${String(n).padStart(2, "0")}`;
    console.log("");
    const url = await askVisible(rl, `사이트${n} 도메인 (예: https://example.com)`, ready("URL", values[`${prefix}_URL`]) ? values[`${prefix}_URL`] : "", {
      normalize: normalizeUrl,
    });
    if (!url) {
      console.log(`  → 사이트${n}은 건너뛸게요.`);
      continue;
    }
    const user = await askVisible(rl, `사이트${n} 워드프레스 관리자 ID`, ready("USER", values[`${prefix}_USER`]) ? values[`${prefix}_USER`] : "");
    const appPassword = await askHidden(rl, `사이트${n} 애플리케이션 비밀번호`, ready("APP_PASSWORD", values[`${prefix}_APP_PASSWORD`]) ? values[`${prefix}_APP_PASSWORD`] : "");
    updates[`${prefix}_URL`] = url;
    updates[`${prefix}_USER`] = user;
    updates[`${prefix}_APP_PASSWORD`] = appPassword;
  }
}

// 5) 2주차 — ElevenLabs 키 + 쇼핑숏폼 워드프레스
if (doWeek2) {
  console.log("");
  console.log("----- 2주차: 쇼핑숏폼(영상) 정보 -----");
  let elevenKey = await askHidden(rl, "ElevenLabs API 키를 입력해주세요", ready("ELEVENLABS_API_KEY", values.ELEVENLABS_API_KEY) ? values.ELEVENLABS_API_KEY : "");
  if (elevenKey && elevenKey.length < 20) {
    console.log("  → ElevenLabs 키치고는 길이가 짧아요. 복사가 잘 됐는지 확인해주세요.");
    elevenKey = await askHidden(rl, "ElevenLabs API 키를 다시 입력해주세요 (지금 값을 그대로 쓰려면 엔터)", elevenKey);
  }
  updates.ELEVENLABS_API_KEY = elevenKey;

  const hubUrl = await askVisible(rl, "쇼핑숏폼 워드프레스 도메인 (예: https://example.com)", ready("URL", values.HUB_WORDPRESS_URL) ? values.HUB_WORDPRESS_URL : "", {
    normalize: normalizeUrl,
  });
  if (hubUrl) {
    const hubUser = await askVisible(rl, "쇼핑숏폼 워드프레스 관리자 ID", ready("USER", values.HUB_WORDPRESS_USER) ? values.HUB_WORDPRESS_USER : "");
    const hubPassword = await askHidden(rl, "쇼핑숏폼 워드프레스 애플리케이션 비밀번호", ready("APP_PASSWORD", values.HUB_WORDPRESS_APP_PASSWORD) ? values.HUB_WORDPRESS_APP_PASSWORD : "");
    updates.HUB_WORDPRESS_URL = hubUrl;
    updates.HUB_WORDPRESS_USER = hubUser;
    updates.HUB_WORDPRESS_APP_PASSWORD = hubPassword;
  } else {
    console.log("  → 쇼핑숏폼 워드프레스는 건너뛸게요.");
  }
}

if (rl) rl.close();

// 6) 저장
writeFileSync(ENV_LOCAL_PATH, updateEnv(lines, updates), "utf8");
console.log("");
console.log("[OK] .env.local 저장 완료 (값은 다시 출력하지 않습니다)");

// 7) 실제 인증 테스트 — 입력된 값만 확인한다
console.log("");
console.log("입력한 키가 실제로 동작하는지 확인해볼게요. (글이나 영상을 만들지는 않아요)");
let needsRecheck = false;

if (ready("OPENAI_API_KEY", updates.OPENAI_API_KEY)) {
  const result = await testOpenAi(updates.OPENAI_API_KEY);
  console.log(`${result.ok ? "[OK]" : "[확인 필요]"} OpenAI ${maskValue(updates.OPENAI_API_KEY)}: ${result.detail}`);
  if (!result.ok) needsRecheck = true;
} else {
  console.log("[나중에 입력] OpenAI API 키가 아직 비어 있어요.");
  needsRecheck = true;
}

if (doWeek2 && ready("ELEVENLABS_API_KEY", updates.ELEVENLABS_API_KEY)) {
  const result = await testElevenLabs(updates.ELEVENLABS_API_KEY);
  console.log(`${result.ok ? "[OK]" : "[확인 필요]"} ElevenLabs ${maskValue(updates.ELEVENLABS_API_KEY)}: ${result.detail}`);
  if (!result.ok) needsRecheck = true;
}

if (doWeek1) {
  for (const n of [1, 2, 3]) {
    const prefix = `ADSENSE_SITE_${String(n).padStart(2, "0")}`;
    if (!updates[`${prefix}_URL`]) continue;
    const result = await testWordPress({
      url: updates[`${prefix}_URL`],
      user: updates[`${prefix}_USER`],
      appPassword: updates[`${prefix}_APP_PASSWORD`],
    });
    console.log(`${result.ok ? "[OK]" : "[확인 필요]"} 사이트${n} 워드프레스: ${result.detail}`);
    if (!result.ok) needsRecheck = true;
  }
}

if (doWeek2 && updates.HUB_WORDPRESS_URL) {
  const result = await testWordPress({
    url: updates.HUB_WORDPRESS_URL,
    user: updates.HUB_WORDPRESS_USER,
    appPassword: updates.HUB_WORDPRESS_APP_PASSWORD,
  });
  console.log(`${result.ok ? "[OK]" : "[확인 필요]"} 쇼핑숏폼 워드프레스: ${result.detail}`);
  if (!result.ok) needsRecheck = true;
}

console.log("");
if (needsRecheck) {
  console.log("[확인 필요] 위에 표시된 항목을 다시 확인한 뒤, 터미널에 '키설정' 을 다시 입력하면 그 값만 고칠 수 있어요.");
  process.exitCode = 1;
} else {
  // "3개 모두 정상 확인"은 README·키발급 가이드·코치 플레이북이 안내하는 성공 확인 문구 — 바꾸면 문서도 함께 수정할 것
  console.log("3개 모두 정상 확인! 모든 값이 정상 확인됐습니다. 이제 작업을 시작할 준비가 끝났어요.");
}
