#!/usr/bin/env node

import {existsSync, copyFileSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {stdin as input, stdout as output} from "node:process";
import readline from "node:readline/promises";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(rootDir, ".env.local");
const examplePath = join(rootDir, ".env.example");

const placeholders = {
  OPENAI_API_KEY: ["sk-your", "your-openai", "placeholder"],
  ELEVENLABS_API_KEY: ["your-elevenlabs", "placeholder"],
  HUB_WORDPRESS_URL: ["example.com", "example-shop"],
  HUB_WORDPRESS_USER: ["your-admin-id"],
  HUB_WORDPRESS_APP_PASSWORD: ["xxxx", "placeholder"],
};

function ensureEnvLocal() {
  if (existsSync(envPath)) return;
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    return;
  }
  writeFileSync(envPath, "", "utf8");
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

function ready(key, value) {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return !(placeholders[key] || []).some((token) => lowered.includes(token));
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

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

function statusLine(label, key, value) {
  console.log(`- ${label}: ${ready(key, value) ? "입력됨" : "미입력"}`);
}

async function askVisible(rl, question, currentValue, {normalize = (v) => v.trim()} = {}) {
  const suffix = ready("", currentValue) || currentValue ? " (그대로 두려면 엔터)" : "";
  const answer = await rl.question(`${question}${suffix}: `);
  return answer.trim() ? normalize(answer) : currentValue || "";
}

async function askHidden(question, currentValue) {
  const suffix = ready("", currentValue) || currentValue ? " (그대로 두려면 엔터)" : "";
  if (!input.isTTY || !input.setRawMode) {
    const rl = readline.createInterface({input, output});
    const answer = await rl.question(`${question}${suffix}: `);
    rl.close();
    return answer.trim() || currentValue || "";
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
          resolve(value.trim() || currentValue || "");
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

async function checkWordPress({url, user, appPassword}) {
  if (!url || !user || !appPassword) return {ok: false, detail: "주소, 아이디, 애플리케이션 비밀번호가 모두 필요합니다."};

  const credentials = Buffer.from(`${user}:${appPassword}`).toString("base64");
  try {
    const response = await fetch(`${url}/wp-json/wp/v2/users/me?context=edit`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return {ok: false, detail: `상태 코드 ${response.status}. 도메인, 관리자 ID, 애플리케이션 비밀번호를 확인해주세요.`};
    }
    return {ok: true, detail: "워드프레스 연결 확인됨"};
  } catch (error) {
    return {ok: false, detail: error instanceof Error ? error.message : String(error)};
  }
}

ensureEnvLocal();

const original = readFileSync(envPath, "utf8");
const {lines, values} = parseEnv(original);

console.log("");
console.log("==================================================");
console.log(" 2주차 API키 및 쇼핑숏폼 사이트 확인");
console.log("==================================================");
console.log("입력한 값은 .env.local 파일에만 저장됩니다.");
console.log("API 키와 비밀번호 값은 화면에 다시 출력하지 않습니다.");
console.log("");
console.log("현재 상태");
statusLine("OpenAI API 키", "OPENAI_API_KEY", values.OPENAI_API_KEY);
statusLine("ElevenLabs API 키", "ELEVENLABS_API_KEY", values.ELEVENLABS_API_KEY);
statusLine("쇼핑숏폼 워드프레스 도메인", "HUB_WORDPRESS_URL", values.HUB_WORDPRESS_URL);
statusLine("쇼핑숏폼 워드프레스 관리자 ID", "HUB_WORDPRESS_USER", values.HUB_WORDPRESS_USER);
statusLine("쇼핑숏폼 워드프레스 애플리케이션 비밀번호", "HUB_WORDPRESS_APP_PASSWORD", values.HUB_WORDPRESS_APP_PASSWORD);
console.log("");

const rl = readline.createInterface({input, output});
const openAiKey = await askHidden("OpenAI API 키를 입력해주세요", values.OPENAI_API_KEY);
const elevenLabsKey = await askHidden("ElevenLabs API 키를 입력해주세요", values.ELEVENLABS_API_KEY);
const hubUrl = await askVisible(rl, "쇼핑숏폼 워드프레스 도메인을 입력해주세요. 예: https://example.com", values.HUB_WORDPRESS_URL, {
  normalize: normalizeUrl,
});
const hubUser = await askVisible(rl, "쇼핑숏폼 워드프레스 관리자 ID를 입력해주세요", values.HUB_WORDPRESS_USER);
rl.close();
const hubPassword = await askHidden("쇼핑숏폼 워드프레스 애플리케이션 비밀번호를 입력해주세요", values.HUB_WORDPRESS_APP_PASSWORD);

const updates = {
  OPENAI_API_KEY: openAiKey,
  ELEVENLABS_API_KEY: elevenLabsKey,
  HUB_WORDPRESS_URL: hubUrl,
  HUB_WORDPRESS_USER: hubUser,
  HUB_WORDPRESS_APP_PASSWORD: hubPassword,
};

writeFileSync(envPath, updateEnv(lines, updates), "utf8");

console.log("");
console.log("[OK] .env.local 업데이트 완료");
console.log("저장된 값은 출력하지 않습니다.");

const allReady = Object.entries(updates).every(([key, value]) => ready(key, value));
if (!allReady) {
  console.log("");
  console.log("[확인 필요] 아직 비어 있거나 예시값 그대로인 항목이 있습니다.");
  console.log("이미지/영상 만들기 전에 이 파일을 다시 실행해서 빠진 값을 입력해주세요.");
  process.exitCode = 1;
} else {
  console.log("");
  console.log("워드프레스 연결을 확인합니다. 글은 새로 만들지 않습니다.");
  const result = await checkWordPress({url: hubUrl, user: hubUser, appPassword: hubPassword});
  console.log(`${result.ok ? "[OK]" : "[확인 필요]"} ${result.detail}`);
  if (!result.ok) process.exitCode = 1;
}
