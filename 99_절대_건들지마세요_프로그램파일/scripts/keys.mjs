#!/usr/bin/env node

// 키설정 (npm run keys) — 수강 코드 + API 키 + 워드프레스 정보를 대화형으로 입력받아 .env.local에 저장한다.
// (OpenAI 키 1개 + 워드프레스 사이트 정보 + 수강 코드 — 입력 즉시 인증 확인, 값은 화면에 남기지 않음)
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
import {MAX_SITES, sitePrefix} from "./lib/sites.mjs";
import {STOP_WORDS, isStopWord, stripPasteNoise} from "./lib/paste.mjs";
import {myPublicIp, wpFetch} from "./lib/wp.mjs";

const placeholders = {
  MAKEIT_MIDDLE_LICENSE: ["your-", "placeholder"],
  OPENAI_API_KEY: ["sk-your", "your-openai", "placeholder"],
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
  const raw = await ask(rl, `${question}${suffix}: `);
  // 붙여넣기 제어문자를 먼저 턴다 — 주소·아이디에도 섞일 수 있다
  const answer = stripPasteNoise(raw);
  return answer ? normalize(answer) : String(currentValue || "").trim();
}

// 비밀값 입력 — 화면에 글자를 표시하지 않는다
async function askHidden(rl, question, currentValue) {
  const suffix = String(currentValue || "").trim() ? " (그대로 두려면 엔터)" : "";
  if (!isInteractive) {
    const answer = await ask(rl, `${question}${suffix}: `);
    return answer.trim() || String(currentValue || "").trim();
  }

  output.write(`${question}${suffix}: `);
  // 프롬프트 바로 뒤 커서 위치를 기억해 둔다.
  // 입력이 끝나면 여기로 되돌아와 그 뒤를 전부 지운다 (아래 finish 참고).
  if (output.isTTY) output.write("\u001b[s");

  // readline 이 살아 있으면 raw mode 로 바꿔도 readline 이 입력을 그대로 화면에
  // 찍어 버린다 — 실제로 API 키가 터미널에 통째로 노출됐다. 반드시 멈춰 둔다.
  if (rl) rl.pause();
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  let value = "";
  // 0 = 평상, 1 = ESC 받음, 2 = CSI(ESC[) 시퀀스 내부
  // 붙여넣기하면 터미널이 ESC[200~ … ESC[201~ 로 감싸서 보낸다.
  // 이걸 걸러내지 않으면 비밀번호 값에 그대로 섞여 서버가 401 을 돌려준다.
  let escState = 0;
  let onData;
  const finish = () => {
    input.setRawMode(false);
    input.off("data", onData);

    // 터미널이 붙여넣은 값을 먼저 화면에 그려 버리는 경우가 있다.
    // raw mode 를 켜도 클라이언트(VS Code 터미널)가 자체 에코를 하기 때문이다.
    // 실제로 OpenAI 키가 통째로 화면에 찍혔고, 그 상태로 스크린샷까지 나갔다.
    //
    // 막는 건 불가능하니, 뒤에서 지운다:
    //   \u001b[u  → 아까 기억해 둔 프롬프트 뒤로 커서 복귀
    //   \u001b[0J → 거기서부터 화면 끝까지 지우기 (몇 줄이 찍혔든 사라진다)
    if (output.isTTY) output.write("\u001b[u\u001b[0J");

    // 몇 글자 들어갔는지만 알려 준다 (값 자체는 화면에 남기지 않는다)
    output.write(value ? `${"\u2022".repeat(Math.min(value.length, 12))}\n` : "\n");
    if (rl) rl.resume();
  };

  return await new Promise((resolve) => {
    onData = (chunk) => {
      for (const char of chunk) {
        // ESC 시퀀스는 통째로 버린다
        if (escState === 1) {
          escState = char === "[" ? 2 : 0;
          continue;
        }
        if (escState === 2) {
          // 파라미터/중간 바이트는 계속, 최종 바이트(@ ~ ~)에서 끝
          if (char >= "\u0040" && char <= "\u007e") escState = 0;
          continue;
        }
        if (char === "\u001b") {
          escState = 1;
          continue;
        }
        if (char === "\u0003") {
          finish();
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          const answer = stripPasteNoise(value) || String(currentValue || "").trim();
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

async function testWordPress({url, user, appPassword}) {
  if (!url || !user || !appPassword) return {ok: false, detail: "주소·아이디·애플리케이션 비밀번호가 모두 필요합니다."};
  const credentials = Buffer.from(`${user}:${appPassword}`).toString("base64");
  try {
    // wpFetch: 브라우저 헤더 + 막힐 때 ?rest_route= 자동 재시도 (lib/wp.mjs)
    const response = await wpFetch(`${url}/wp-json/wp/v2/users/me?context=edit`, {
      headers: {Authorization: `Basic ${credentials}`},
      signal: AbortSignal.timeout(15_000),
    });
    // ★ 순서가 중요하다. 차단을 먼저 본다.
    //
    // 봇 차단 화면은 상태코드가 200 으로 온다(실측). 그래서 401/403 만 보고
    // 있으면 이 경우를 놓치고, 아래 JSON 파싱에서 "응답이 이상해요" 같은
    // 엉뚱한 안내가 나간다. 진현님 화면에서 실제로 그랬다.
    if (response.blocked) {
      if (response.challenged) {
        // 허용목록에 넣을 IP 를 직접 찍어 준다.
        // 수강생보고 "내 IP 찾아서 넣으세요"하면 거기서 또 막힌다.
        const myIp = await myPublicIp();
        const ipLine = myIp
          ? `\n    ↓ 이 주소를 허용목록에 넣으세요 (드래그 → 우클릭 → 복사)\n` +
            `      ${myIp}\n`
          : "";
        return {
          ok: false,
          detail:
            "사이트의 '봇 차단' 기능이 막고 있어요.\n" +
            "    비밀번호 문제가 아닙니다. 새로 발급해도 같습니다.\n" +
            "    사람이 브라우저로 들어왔는지 확인하는 화면이 돌아오는데,\n" +
            "    프로그램은 그 화면을 통과할 수 없어요.\n" +
            "\n" +
            ipLine +
            "\n" +
            "    호스팅 방화벽에 위 주소를 '허용'으로 등록하면 풀립니다.\n" +
            "\n" +
            "    · Cloudways 인 경우 (실제 경로)\n" +
            "      서버 선택 → Security → Firewall → [Add Custom Rule]\n" +
            "      → IP Address 칸에 위 주소 붙여넣기\n" +
            "      → White List 선택 → [Add IP Address]\n" +
            "      (TTL 은 비워 두면 계속 유지됩니다)\n" +
            "\n" +
            "    · 그 밖 호스팅 : '방화벽', 'IP 차단', '봇 차단' 메뉴에서 동일하게\n" +
            "\n" +
            "    메뉴를 못 찾으면 호스팅 고객센터에 이렇게 문의하세요.\n" +
            `    ‘${myIp || "(내 서버 IP)"} 에서 워드프레스 REST API 접속이 봇 차단에 걸립니다.\n` +
            "     허용목록에 넣어 주세요.’",
        };
      }
      return {
        ok: false,
        detail:
          `사이트가 접속을 막았어요. (응답 ${response.status})\n` +
          "    값이 틀려서가 아니라 사이트 쪽 보안 기능이 막은 것입니다.\n" +
          (response.bodyPreview ? `    돌아온 내용: ${response.bodyPreview.slice(0, 120)}` : ""),
      };
    }

    if (response.status === 401 || response.status === 403) {
      // 워드프레스가 보낸 에러 코드를 그대로 보여준다.
      // incorrect_password / invalid_username 이면 정말 값이 틀린 것이고,
      // 그 밖의 코드나 HTML 응답이면 보안 플러그인이 막은 것이다.
      // 이걸 안 보여주면 둘을 구분할 수가 없어서 계속 비밀번호만 새로 발급하게 된다.
      // 값은 보여주지 않고 '길이'만 알려준다.
      // 앱 비밀번호는 보통 24글자(공백 빼고) / 29글자(공백 포함)라,
      // 여기서 이상한 숫자가 보이면 붙여넣기가 깨졌다는 뜻이다.
      const spaceless = String(appPassword).replace(/\s+/g, "").length;
      const body = await response.text().catch(() => "");
      let serverCode = "";
      try {
        const parsed = JSON.parse(body);
        serverCode = String(parsed.code || "");
      } catch {
        serverCode = body.trim().startsWith("<") ? "HTML응답" : "";
      }

      // 어떤 코드가 무슨 뜻인지는 사이트마다 다르다.
      // 실측: 이 사이트는 비밀번호가 틀려도 rest_not_logged_in 을 돌려준다.
      // 그래서 한쪽으로 단정하지 않고, 가능성을 순서대로 보여준다.
      const definitelyWrong = ["incorrect_password", "invalid_username", "invalid_email"].includes(serverCode);
      // wpFetch 가 붙여 준 판정 — 응답이 JSON 이 아니라 '사람 확인' 페이지였는지
      const gotChallengePage = Boolean(response.challenged);
      const blockedLooking = serverCode === "HTML응답" || response.status === 403;
      // 누가 막았는지를 응답에서 직접 가려낸다.
      //
      // 중요: 헤더에 server: cloudflare 가 있다고 Cloudflare 가 막은 것은 아니다.
      // 그저 CDN 을 쓴다는 뜻일 뿐이다. 실제로 차단한 주체는 따로 확인해야 한다.
      const cdnIsCloudflare =
        /cloudflare/i.test(response.headers.get("server") || "") || Boolean(response.headers.get("cf-ray"));
      // Cloudflare 가 직접 차단했을 때만 붙는 표식들
      const cloudflareBlockedIt =
        Boolean(response.headers.get("cf-mitigated")) ||
        /attention required|cloudflare ray id|__cf_chl/i.test(body.slice(0, 1500));
      // 워드프레스 보안 플러그인이 막았을 때
      const pluginBlockedIt = /wordfence|your access to this site has been limited|sucuri|보안 정책/i.test(
        body.slice(0, 1500),
      );

      // 문제를 끝까지 몰고 가기 위한 흔적 — 짐작하지 않게 해 준다.
      // (민감한 값은 없다. 서버가 돌려준 공개 응답이다)
      const evidence = [];
      if (response.headers.get("server")) evidence.push(`server=${response.headers.get("server")}`);
      if (response.headers.get("cf-mitigated")) evidence.push(`cf-mitigated=${response.headers.get("cf-mitigated")}`);
      const bodyHint = body.replace(/\s+/g, " ").trim().slice(0, 90);
      if (bodyHint) evidence.push(`응답내용="${bodyHint}"`);

      let head;
      let tail;
      if (gotChallengePage) {
        // 실측: 응답 200 + "One moment, please..." + 5초 뒤 새로고침 스크립트.
        // 사람이 브라우저로 들어왔는지 검사하는 화면이라 프로그램은 못 넘는다.
        // 쿠키를 받아 다시 가봐도, 기다렸다 가봐도, 다른 경로로 가봐도 같았다.
        head = "사이트의 '봇 차단' 기능이 막고 있어요.";
        tail =
          "    비밀번호 문제가 아닙니다. 새로 발급해도 같습니다.\n" +
          "    사람이 브라우저로 들어왔는지 확인하는 화면이 돌아오는데,\n" +
          "    프로그램은 그 화면을 통과할 수 없어요.\n" +
          "\n" +
          "    호스팅 관리 화면에서 꺼주셔야 합니다.\n" +
          "    · Cloudways : Application → Bot Protection → 끄기\n" +
          "    · 그 밖    : '봇 차단', 'Bot Protection', '보안 수준' 같은 항목을 찾아 끄기\n" +
          "\n" +
          "    모르겠으면 호스팅 고객센터에 이렇게 문의하세요.\n" +
          "    ‘외부 프로그램에서 워드프레스 REST API 연결이 봇 차단에 걸립니다. 풀어주세요.’";
      } else if (definitelyWrong) {
        head = "관리자 ID 또는 애플리케이션 비밀번호가 틀렸어요.";
        tail = "    워드프레스 [사용자 → 프로필]에서 새로 발급해 보세요.";
      } else if (blockedLooking && cloudflareBlockedIt) {
        // 작업방은 데이터센터에서 돌아간다. Cloudflare 는 그런 IP 를 기본적으로
        // 봇으로 보고 403 을 돌려준다. 집 컴퓨터에선 잘 되는데 여기서만 안 되는
        // 전형적인 이유라, 비밀번호를 아무리 새로 발급해도 소용이 없다.
        head = "사이트 앞의 Cloudflare 가 두 가지 길을 모두 막았어요.";
        tail =
          "    비밀번호 문제가 아닙니다. 새로 발급해도 똑같이 막힙니다.\n" +
          "    (프로그램이 우회 경로로 한 번 더 시도했지만 그것도 막혔습니다)\n" +
          "\n" +
          "    이럴 때만 Cloudflare 설정을 한 번 손보면 됩니다.\n" +
          "    cloudflare.com 로그인 → 내 도메인 → Security → Bots\n" +
          "    → 'Bot Fight Mode' 끄기";
      } else if (blockedLooking && pluginBlockedIt) {
        head = "워드프레스 보안 플러그인이 접속을 막았어요.";
        tail =
          "    비밀번호 문제가 아닙니다.\n" +
          "    워드프레스 관리자 화면 → 보안 플러그인(Wordfence 등)\n" +
          "    → 차단된 IP 목록을 비우거나, 잠시 끕고 다시 해보세요.\n" +
          (evidence.length ? `    흔적: ${evidence.join(" / ")}` : "");
      } else if (blockedLooking) {
        head = "사이트가 접속을 막았는데, 누가 막았는지는 아직 모르겠어요.";
        tail =
          "    값이 틀려서가 아니라, 무언가가 이 작업방을 막고 있습니다.\n" +
          "    (작업방은 개인 PC 가 아니라 서버에서 돌아서 가끔 이런 일이 생깁니다)\n" +
          "    1) 10분쯤 기다렸다가 다시 — 잠시 잠긴 거라면 저절로 풀립니다\n" +
          "    2) 워드프레스 관리자 화면에 보안 플러그인이 있으면 잠시 끕고 재시도\n" +
          "    3) 그래도 같으면 아래 흔적을 복사해 코덱스에게 보여주세요.\n" +
          (evidence.length ? `    흔적: ${evidence.join(" / ")}` : "    흔적: 응답이 비어 있음");
      } else {
        head = "로그인이 되지 않았어요.";
        tail =
          "    순서대로 확인해보세요.\n" +
          "    1) 앱 비밀번호를 새로 발급해 다시 넣기 (가장 흔한 원인)\n" +
          "    2) 조금 전에 여러 번 틀렸다면 5~10분 뒤에 다시 시도 (잠시 차단될 수 있어요)\n" +
          "    3) 그래도 같으면 보안 플러그인이 막는 겁니다 — 관리자 화면에서 잠시 꺼보세요";
      }

      return {
        ok: false,
        detail:
          `${head} (응답 ${response.status}${serverCode ? ` / ${serverCode}` : ""}, ` +
          `아이디 "${user}", 비밀번호 공백빼고 ${spaceless}글자)\n${tail}`,
      };
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

// 연결이 세 번 다 안 됐을 때, 원인을 갈라보는 확인 절차.
//
// 이 사이트들은 비밀번호가 틀려도 rest_not_logged_in 을 돌려준다(실측).
// 그래서 응답 코드만 봐서는 "값이 틀렸다" 와 "보안이 막았다" 를 구분할 수 없다.
// 세 가지를 나란히 재서 비교한다.
async function diagnoseWordPress({url, user, appPassword}) {
  const lines = [];
  const ask = async (label, headers) => {
    try {
      const response = await wpFetch(`${url}/wp-json/wp/v2/users/me?context=edit`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text().catch(() => "");
      let code = "";
      try {
        code = String(JSON.parse(body).code || "(성공)");
      } catch {
        code = body.trim().startsWith("<") ? "HTML응답" : "(알 수 없음)";
      }
      lines.push({label, status: response.status, code, server: response.headers.get("server") || ""});
      return response.status;
    } catch (error) {
      lines.push({label, status: 0, code: error instanceof Error ? error.message.slice(0, 40) : "실패", server: ""});
      return 0;
    }
  };

  const basic = (id, pw) => ({Authorization: `Basic ${Buffer.from(`${id}:${pw}`).toString("base64")}`});

  // 1) 사이트 자체에 닿는가 (인증 없이)
  await ask("인증 없이 접속", {});
  // 2) 내가 넣은 값으로
  await ask("넣은 값으로", basic(user, appPassword));
  // 3) 일부러 틀린 값으로 (비교용)
  await ask("일부러 틀린 값", basic(user, "ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ"));

  console.log("");
  console.log("  —— 확인 결과 ——");
  for (const line of lines) {
    console.log(`   ${line.label.padEnd(14)} → ${line.status || "연결안됨"} ${line.code}`);
  }

  const [noAuth, mine, wrong] = lines;
  const cloudflareBlocked = lines.some((line) => line.status === 403 && /cloudflare/i.test(line.server));

  console.log("");
  if (cloudflareBlocked) {
    console.log("  → Cloudflare 가 이 작업방을 막고 있어요. (비밀번호 문제 아님)");
    console.log("     cloudflare.com → 내 도메인 → Security → Bots → 'Bot Fight Mode' 끄기");
    console.log("     그래도 막히면 WAF 사용자 지정 규칙에서 /wp-json/ 을 Skip 처리하세요.");
  } else if (noAuth.status === 0) {
    console.log("  → 사이트에 아예 닿지 않아요. 도메인 주소를 다시 확인해주세요.");
  } else if (mine.status === wrong.status && mine.code === wrong.code) {
    console.log("  → 넣은 값과 일부러 틀린 값의 응답이 같아요.");
    console.log("     비밀번호가 서버까지 전달되지 않았거나, 정말 틀린 값입니다.");
    console.log("     ※ 워드프레스 [사용자 → 프로필 → 애플리케이션 비밀번호]에서");
    console.log("       새로 발급해 보세요. 그래도 같으면 보안 플러그인이 막고 있는 겁니다.");
  } else {
    console.log("  → 넣은 값은 틀린 값과 다르게 처리됐어요. 값 자체는 서버까지 잘 갔다는 뜻입니다.");
    console.log("     잠시 뒤에 다시 해보세요. 계속 같으면 이 화면을 복사해 코덱스에게 물어보세요.");
  }
  console.log("");
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
  let lastAttempt = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const first = attempt === 1;
    const url = await askVisible(
      rl,
      `${label} 도메인 (예: https://example.com)`,
      first && ready("URL", current.url) ? current.url : "",
      // '끝' 같은 중단어는 주소로 바꾸지 않고 그대로 통과시킨다
      {normalize: (value) => (isStopWord(value) ? stripPasteNoise(value) : normalizeUrl(value))},
    );
    if (isStopWord(url)) return "STOP";
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

    lastAttempt = {url, user, appPassword};
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
  // 세 번 다 안 됐다면 원인을 갈라본다 — 대충 짐작하게 두지 않는다
  if (lastAttempt && lastAttempt.url && lastAttempt.user && lastAttempt.appPassword) {
    console.log("");
    console.log("  왜 안 되는지 몇 가지 더 확인해볼게요...");
    await diagnoseWordPress(lastAttempt);
  }

  // 여기서 값을 버리면 세 번이나 손으로 넣은 게 통째로 날아간다.
  // 연결은 안 됐지만 값은 살려 둔다 — 원인이 값이 아닐 수도 있고(보안 차단 등),
  // 다음에 '키설정'을 다시 돌려도 엔터로 넘길 수 있게 된다. (OpenAI 키와 같은 정책)
  if (lastAttempt && lastAttempt.url && lastAttempt.user && lastAttempt.appPassword) {
    console.log("  → 3번 모두 연결되지 않았어요. 입력한 값은 그대로 저장해 둘게요.");
    console.log("     (다시 치지 않아도 되고, 원인을 해결한 뒤 '진단' 으로 확인하면 돼요)");
    return {...lastAttempt, unverified: true};
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

// 2) OpenAI API 키 — 형식 확인 + 실제 인증까지 통과해야 넘어간다
updates.OPENAI_API_KEY = await askApiKeyUntilValid(rl, {
  label: "OpenAI API 키를 입력해주세요",
  current: ready("OPENAI_API_KEY", values.OPENAI_API_KEY) ? values.OPENAI_API_KEY : "",
  looksWrong: (key) => (key.startsWith("sk-") ? null : "OpenAI 키는 보통 sk- 로 시작해요. 앞뒤가 잘리지 않았는지 확인해주세요."),
  test: testOpenAi,
});

// 3) 승인글을 올릴 워드프레스 사이트 (최대 MAX_SITES 개)
const savedSiteNumbers = [];
{
  console.log("");
  console.log("----- 승인글을 올릴 워드프레스 사이트 정보 -----");
  console.log(`사이트는 최대 ${MAX_SITES}개까지 넣을 수 있어요.`);

  // 예전에는 무조건 정해진 개수만큼 물어봤다. 사이트가 2개뿐인 사람도
  // 나머지를 엔터로 전부 넣겨야 해서 피곤했다. 몇 개인지 먼저 묻는다.
  let plannedCount = 1;
  if (isInteractive || pipedLines) {
    for (let tries = 1; tries <= 3; tries += 1) {
      const answer = stripPasteNoise(await ask(rl, `몇 개를 넣으시겠어요? (1~${MAX_SITES}, 그냥 엔터 = 1개): `));
      if (!answer) break;
      const parsed = Number(answer);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_SITES) {
        plannedCount = parsed;
        break;
      }
      console.log(`  → 1부터 ${MAX_SITES} 사이 숫자로 적어주세요.`);
    }
  }

  console.log("");
  console.log(`사이트 ${plannedCount}개를 차례대로 물어볼게요.`);
  console.log("  · 이 사이트만 건너뛰기 : 그냥 엔터");
  console.log(`  · 여기서 그만하기   : 도메인 자리에 ${STOP_WORDS[0]} 이라고 치고 엔터`);

  for (let n = 1; n <= plannedCount; n += 1) {
    const prefix = sitePrefix(n);
    console.log("");
    const site = await askWordPressUntilValid(rl, {
      label: `사이트${n}`,
      current: {
        url: values[`${prefix}_URL`],
        user: values[`${prefix}_USER`],
        appPassword: values[`${prefix}_APP_PASSWORD`],
      },
    });
    if (site === "STOP") {
      console.log(`  → 여기까지 할게요. 나머지는 나중에 '키설정' 으로 다시 넣으면 돼요.`);
      break;
    }
    if (!site) {
      console.log(`  → 사이트${n}은 건너뛸게요.`);
      continue;
    }
    updates[`${prefix}_URL`] = site.url;
    updates[`${prefix}_USER`] = site.user;
    updates[`${prefix}_APP_PASSWORD`] = site.appPassword;
    savedSiteNumbers.push(n);
  }
}

if (rl) rl.close();

// 6) 저장
writeFileSync(ENV_LOCAL_PATH, updateEnv(lines, updates), "utf8");
console.log("");
console.log("[OK] .env.local 저장 완료 (값은 다시 출력하지 않습니다)");

// 7) 실제 인증 테스트 — 입력된 값만 확인한다
console.log("");
console.log("입력한 키가 실제로 동작하는지 확인해볼게요. (글을 만들지는 않아요)");
let needsRecheck = false;

if (ready("OPENAI_API_KEY", updates.OPENAI_API_KEY)) {
  const result = await testOpenAi(updates.OPENAI_API_KEY);
  console.log(`${result.ok ? "[OK]" : "[확인 필요]"} OpenAI ${maskValue(updates.OPENAI_API_KEY)}: ${result.detail}`);
  if (!result.ok) needsRecheck = true;
} else {
  console.log("[나중에 입력] OpenAI API 키가 아직 비어 있어요.");
  needsRecheck = true;
}

{
  for (const n of savedSiteNumbers) {
    const prefix = sitePrefix(n);
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

console.log("");

// 사이트가 하나도 연결되지 않았으면 준비가 끝난 게 아니다.
// 예전에는 OpenAI 키만 되면 "모두 정상 확인!"을 찍었다 — 사이트를 전부 놓치고도
// 준비된 줄 알고 다음 단계로 갔다가 거기서 막힌다(실측).
if (savedSiteNumbers.length === 0) {
  console.log("[확인 필요] 워드프레스 사이트가 하나도 저장되지 않았어요.");
  console.log("           사이트 연결 정보가 있어야 승인글을 만들 수 있으니, '키설정' 을 다시 돌려주세요.");
  needsRecheck = true;
}

if (needsRecheck) {
  console.log("[확인 필요] 위에 표시된 항목을 다시 확인한 뒤, 터미널에 '키설정' 을 다시 입력하면 그 값만 고칠 수 있어요.");
  process.exitCode = 1;
} else {
  // 이 문구는 안내서·키발급 가이드가 안내하는 성공 확인 문구 — 바꾸면 문서도 함께 수정할 것
  console.log("모두 정상 확인! 이제 작업을 시작할 준비가 끝났어요.");
}
