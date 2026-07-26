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

  // readline 이 살아 있으면 raw mode 로 바꿔도 readline 이 입력을 그대로 화면에
  // 찍어 버린다 — 실제로 API 키가 터미널에 통째로 노출됐다. 반드시 멈춰 둔다.
  if (rl) rl.pause();
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  let value = "";
  let onData;
  const finish = () => {
    input.setRawMode(false);
    input.off("data", onData);
    // 몇 글자 들어갔는지만 알려 준다 (값 자체는 화면에 남기지 않는다)
    output.write(value ? `${"\u2022".repeat(Math.min(value.length, 12))}\n` : "\n");
    if (rl) rl.resume();
  };

  return await new Promise((resolve) => {
    onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          finish();
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          const answer = value.trim() || String(currentValue || "").trim();
          finish();
          resolve(answer);
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

// 워드프레스 관리자 ID 는 영문·숫자 계열만 쓸 수 있다. 한글이 섞이면 거의 100%
// 한/영 전환을 안 한 오입력이다 (실사용에서 실제로 터졌고 그대로 통과됐다).
function checkUserId(user) {
  if (!user) return "아이디가 비어 있어요.";
  if (/[\u3131-\u318E\uAC00-\uD7A3]/.test(user)) return "한글이 섞여 있어요. 한/영 키로 영어로 바꾼 뒤 다시 입력해주세요.";
  if (/[^\x20-\x7E]/.test(user)) return "쓸 수 없는 글자가 섞여 있어요. 영어와 숫자로만 입력해주세요.";
  if (/\s/.test(user)) return "중간에 공백이 들어 있어요.";
  return null;
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
    if (response.status === 401 || response.status === 403) {
      return {ok: false, detail: "관리자 ID 또는 애플리케이션 비밀번호가 맞지 않아요. 워드프레스 [사용자 → 프로필]에서 새로 발급해 보세요."};
    }
    if (!response.ok) {
      return {ok: false, detail: `상태 코드 ${response.status}. 도메인이 맞는지 확인해주세요.`};
    }
    // 상태 코드만 보면 안 된다. 일부 사이트는 인증이 틀려도 200 을 돌려준다.
    // context=edit 응답에는 반드시 사용자 id 가 들어 있어야 한다.
    const me = await response.json().catch(() => null);
    if (!me || typeof me.id !== "number") {
      return {ok: false, detail: "로그인은 됐는데 응답이 이상해요. 도메인이 워드프레스 주소가 맞는지 확인해주세요."};
    }
    if (me.username && String(me.username).toLowerCase() !== String(user).toLowerCase()) {
      return {ok: false, detail: `입력한 아이디(${user})와 실제 로그인된 계정(${me.username})이 달라요.`};
    }
    return {ok: true, detail: `워드프레스 연결 확인됨 (${me.name || me.username || "관리자"})`};
  } catch (error) {
    return {ok: false, detail: error instanceof Error ? error.message : String(error)};
  }
}

// ===== 입력 → 즉시 확인 → 안 되면 그 자리에서 다시 입력 =====
//
// 예전에는 전부 받아 저장한 뒤 맨 끝에서 한 번 확인만 했다. 그래서 아이디를 잘못
// 넣어도 그냥 넘어갔고, 수강생은 한참 뒤 발행이 안 될 때에야 알았다.
// 이제 한 항목을 받을 때마다 실제 인증까지 해보고, 안 되면 바로 다시 묻는다.

async function askApiKeyUntilValid(rl, {label, current, looksWrong, test}) {
  let value = String(current || "");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const answer = await askHidden(rl, attempt === 1 ? label : `${label} (다시 입력)`, value);
    if (!answer) {
      console.log("  → 비워 두셨어요. 나중에 '키설정' 을 다시 실행해 넣어주세요.");
      return "";
    }
    value = answer;

    const hint = looksWrong ? looksWrong(value) : null;
    if (hint) {
      console.log(`  → ${hint}`);
      if (attempt < 3) continue;
    }

    output.write("  확인 중...");
    const result = await test(value);
    if (result.ok) {
      console.log(" 확인됐어요!");
      return value;
    }
    console.log("");
    console.log(`  → ${result.detail}`);
    if (attempt === 3) {
      console.log("  → 3번 모두 확인되지 않았어요. 입력한 값은 저장하지만, 나중에 '키설정' 으로 다시 넣어주세요.");
    }
  }
  return value;
}

async function askWordPressUntilValid(rl, {label, current}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const first = attempt === 1;
    const url = await askVisible(
      rl,
      `${label} 도메인 (예: https://example.com)`,
      first && ready("URL", current.url) ? current.url : "",
      {normalize: normalizeUrl},
    );
    if (!url) return null;

    let user = "";
    for (let tries = 1; tries <= 3; tries++) {
      const answer = await askVisible(
        rl,
        `${label} 관리자 ID`,
        first && tries === 1 && ready("USER", current.user) ? current.user : "",
      );
      const bad = checkUserId(answer);
      if (!bad) {
        user = answer;
        break;
      }
      console.log(`  → ${bad}`);
    }
    if (!user) {
      console.log("  → 아이디 확인이 안 돼서 이 사이트는 건너뜁니다.");
      return null;
    }

    const appPassword = await askHidden(
      rl,
      `${label} 애플리케이션 비밀번호`,
      first && ready("APP_PASSWORD", current.appPassword) ? current.appPassword : "",
    );
    if (!appPassword) {
      console.log("  → 애플리케이션 비밀번호가 비어 있어요. 다시 받을게요.");
      continue;
    }

    output.write("  확인 중...");
    const result = await testWordPress({url, user, appPassword});
    if (result.ok) {
      console.log(` ${result.detail}`);
      return {url, user, appPassword};
    }
    console.log("");
    console.log(`  → ${result.detail}`);
    if (attempt < 3) {
      console.log("  → 도메인부터 다시 입력할게요. (이 사이트를 건너뛰려면 도메인에서 엔터)");
    }
  }
  console.log("  → 3번 모두 연결되지 않아 이 사이트는 저장하지 않습니다. 나중에 '키설정' 으로 다시 넣어주세요.");
  return null;
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
updates.OPENAI_API_KEY = await askApiKeyUntilValid(rl, {
  label: "OpenAI API 키를 입력해주세요",
  current: ready("OPENAI_API_KEY", values.OPENAI_API_KEY) ? values.OPENAI_API_KEY : "",
  looksWrong: (key) => (key.startsWith("sk-") ? null : "OpenAI 키는 보통 sk- 로 시작해요. 앞뒤가 잘리지 않았는지 확인해주세요."),
  test: testOpenAi,
});

// 4) 1주차 — 애드센스 사이트 1~3 워드프레스 정보
if (doWeek1) {
  console.log("");
  console.log("----- 1주차: 애드센스 사이트 워드프레스 정보 -----");
  console.log("(아직 준비 안 된 사이트는 엔터로 건너뛰면 됩니다)");
  for (const n of [1, 2, 3]) {
    const prefix = `ADSENSE_SITE_${String(n).padStart(2, "0")}`;
    console.log("");
    const site = await askWordPressUntilValid(rl, {
      label: `사이트${n}`,
      current: {
        url: values[`${prefix}_URL`],
        user: values[`${prefix}_USER`],
        appPassword: values[`${prefix}_APP_PASSWORD`],
      },
    });
    if (!site) {
      console.log(`  → 사이트${n}은 건너뛸게요.`);
      continue;
    }
    updates[`${prefix}_URL`] = site.url;
    updates[`${prefix}_USER`] = site.user;
    updates[`${prefix}_APP_PASSWORD`] = site.appPassword;
  }
}

// 5) 2주차 — ElevenLabs 키 + 쇼핑숏폼 워드프레스
if (doWeek2) {
  console.log("");
  console.log("----- 2주차: 쇼핑숏폼(영상) 정보 -----");
  updates.ELEVENLABS_API_KEY = await askApiKeyUntilValid(rl, {
    label: "ElevenLabs API 키를 입력해주세요",
    current: ready("ELEVENLABS_API_KEY", values.ELEVENLABS_API_KEY) ? values.ELEVENLABS_API_KEY : "",
    looksWrong: (key) => (key.length >= 20 ? null : "ElevenLabs 키치고 길이가 짧아요. 복사가 잘 됐는지 확인해주세요."),
    test: testElevenLabs,
  });

  console.log("");
  const hub = await askWordPressUntilValid(rl, {
    label: "쇼핑숏폼 워드프레스",
    current: {
      url: values.HUB_WORDPRESS_URL,
      user: values.HUB_WORDPRESS_USER,
      appPassword: values.HUB_WORDPRESS_APP_PASSWORD,
    },
  });
  if (hub) {
    updates.HUB_WORDPRESS_URL = hub.url;
    updates.HUB_WORDPRESS_USER = hub.user;
    updates.HUB_WORDPRESS_APP_PASSWORD = hub.appPassword;
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
