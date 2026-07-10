#!/usr/bin/env node

import {hasEnvLocal, keysGuideMessage, requireLicense} from "./lib/env.mjs";

function ready(value, placeholders = []) {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return !placeholders.some((token) => lowered.includes(token));
}

function siteFromEnv(env, label, prefix) {
  const url = env[`${prefix}_URL`];
  const user = env[`${prefix}_USER`];
  const appPassword = env[`${prefix}_APP_PASSWORD`];
  return {label, url, user, appPassword};
}

async function checkSite(site, {required = true} = {}) {
  const urlReady = ready(site.url, ["example.com", "example-"]);
  const userReady = ready(site.user, ["your-admin-id"]);
  const passReady = ready(site.appPassword, ["xxxx"]);

  if (!urlReady && !userReady && !passReady) {
    if (required) {
      return {label: site.label, status: "확인 필요", detail: "사이트 1 워드프레스 정보가 아직 입력되지 않음"};
    }
    return {label: site.label, status: "건너뜀", detail: "정보 미입력"};
  }

  if (!urlReady || !userReady || !passReady) {
    return {label: site.label, status: "확인 필요", detail: "주소, 아이디, 애플리케이션 비밀번호 중 비어 있는 값이 있음"};
  }

  let wordpressUrl = String(site.url || "").trim().replace(/^["']+|["']+$/g, "");
  if (wordpressUrl && !/^https?:\/\//i.test(wordpressUrl)) wordpressUrl = `https://${wordpressUrl}`;
  wordpressUrl = wordpressUrl.replace(/\/+$/, "");
  const credentials = Buffer.from(`${String(site.user || "").trim()}:${String(site.appPassword || "").trim()}`).toString("base64");

  try {
    const response = await fetch(`${wordpressUrl}/wp-json/wp/v2/users/me?context=edit`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      let guide = "주소/아이디/애플리케이션 비밀번호/REST API 차단 여부 확인 필요";
      if (401 === response.status) {
        guide = "아이디 또는 애플리케이션 비밀번호가 맞지 않습니다. ① 워드프레스 관리자 → 사용자 → 프로필에서 애플리케이션 비밀번호를 새로 발급해 다시 입력 ② 아이디 대신 워드프레스 로그인 이메일 전체(@ 포함)를 넣어보세요.";
      } else if (403 === response.status) {
        guide = "접근이 차단됐습니다. 보안 플러그인이나 호스팅 방화벽이 REST API를 막고 있는지 확인해주세요.";
      } else if (404 === response.status) {
        guide = "REST API 주소를 찾지 못했습니다. 워드프레스 관리자 → 설정 → 고유주소에서 '글 이름'을 선택하고 저장한 뒤 다시 시도해주세요.";
      }
      return {
        label: site.label,
        status: "실패",
        detail: `상태 코드 ${response.status}. ${guide}`,
      };
    }

    const user = await response.json();
    return {label: site.label, status: "성공", detail: `연결 사용자: ${user.name || user.slug || "확인됨"}`};
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|certificate/i.test(message)) {
      message += " → 사이트 주소를 확인해주세요. https:// 를 포함한 전체 도메인(예: https://example.com)인지, 오타가 없는지 확인한 뒤 다시 실행하면 됩니다.";
    }
    return {label: site.label, status: "실패", detail: message};
  }
}

// 라이센스 게이트(수강 코드 확인) 통과 후, process.env 우선 + .env.local 보조로 설정을 읽는다 (PRD D8·D9)
const env = requireLicense({scriptLabel: "워드프레스 연결 점검"});

const sites = [
  siteFromEnv(env, "애드센스 사이트 1", "ADSENSE_SITE_01"),
  siteFromEnv(env, "애드센스 사이트 2", "ADSENSE_SITE_02"),
  siteFromEnv(env, "애드센스 사이트 3", "ADSENSE_SITE_03"),
];

// 파일도 없고 Secrets에도 사이트 정보가 하나도 없으면, 점검 대신 키설정 안내를 먼저 한다
const hasAnySiteValue = sites.some((site) => site.url || site.user || site.appPassword);
if (!hasEnvLocal() && !hasAnySiteValue) {
  console.error(keysGuideMessage("워드프레스 연결 정보"));
  process.exit(1);
}

if (ready(env.WORDPRESS_URL, ["example.com"]) || ready(env.WORDPRESS_USER, ["your-admin-id"]) || ready(env.WORDPRESS_APP_PASSWORD, ["xxxx"])) {
  sites.push({
    label: "예전 단일 워드프레스 설정",
    url: env.WORDPRESS_URL,
    user: env.WORDPRESS_USER,
    appPassword: env.WORDPRESS_APP_PASSWORD,
  });
}

console.log("워드프레스 연결 점검");
console.log("=".repeat(44));

let hasFailure = false;
for (const [index, site] of sites.entries()) {
  const result = await checkSite(site, {required: index === 0});
  console.log(`[${result.status}] ${result.label}: ${result.detail}`);
  if (result.status === "실패" || result.status === "확인 필요") hasFailure = true;
}

console.log("=".repeat(44));
console.log("읽기 연결만 확인했고, 글은 새로 만들지 않았음.");

if (hasFailure) process.exitCode = 1;
