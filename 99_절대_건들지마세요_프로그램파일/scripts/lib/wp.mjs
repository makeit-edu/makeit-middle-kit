// 워드프레스 REST API 호출 공통 창구.
//
// 왜 이게 필요한가 (실측):
//   수강생 작업방(Codespaces)은 개인 PC가 아니라 데이터센터 서버에서 돈다.
//   Cloudflare 를 쓰는 사이트는 그런 IP 를 '봇'으로 보고 /wp-json/ 을 403 으로 막는다.
//   같은 아이디·비밀번호가 집 컴퓨터에서는 200, 작업방에서는 403 이 나오는 이유다.
//   비밀번호를 새로 발급해도 소용이 없다.
//
//   수강생 수백 명에게 "Cloudflare 설정을 바꾸세요"라고 할 수는 없으니, 여기서 푼다.
//
//   1) 브라우저가 보내는 것과 같은 헤더를 붙인다 (봇 판정의 1차 기준이 UA·헤더 구성이다)
//   2) 그래도 /wp-json/ 이 막히면 ?rest_route= 로 자동 재시도한다.
//      워드프레스는 같은 API 를 이 쿼리 파라미터로도 제공하고,
//      차단 규칙은 보통 '경로'를 기준으로 만들어져 있어서 이쪽은 열려 있다.
//   3) 한 번 통한 방식은 사이트별로 기억해서, 다음부터는 곧바로 그 길로 간다.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 사이트별로 '이 사이트는 ?rest_route= 로 가야 한다'를 기억한다 (origin 기준)
const preferRestRoute = new Set();

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return String(url);
  }
}

export function browserHeaders(url) {
  const origin = originOf(url);
  return {
    "User-Agent": BROWSER_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: `${origin}/wp-admin/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

// https://site.com/wp-json/wp/v2/posts?a=b  →  https://site.com/?rest_route=/wp/v2/posts&a=b
export function toRestRouteUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const marker = "/wp-json/";
  const at = parsed.pathname.indexOf(marker);
  if (at === -1) return null;

  // 앞에 서브디렉터리가 있을 수 있다 (예: /blog/wp-json/…)
  const prefix = parsed.pathname.slice(0, at);
  const route = parsed.pathname.slice(at + marker.length - 1); // "/wp/v2/posts"
  const query = parsed.search.startsWith("?") ? parsed.search.slice(1) : "";

  // route 는 인코딩하지 않는다 — 워드프레스가 날것의 슬래시를 기대한다
  return `${parsed.origin}${prefix}/?rest_route=${route}${query ? `&${query}` : ""}`;
}

// 차단당한 응답인지 (값이 틀린 게 아니라 '문 앞에서 막힐' 경우)
//
// 주의: 상태코드만 보면 놓친다. 실측된 사례 —
//   응답은 200 인데 내용이 JSON 이 아니라 setTimeout 으로
//   브라우저인지 검사하는 HTML 페이지였다. 브라우저는 JS 를 돌려
//   통과하지만 프로그램은 못 한다. 그래서 인증 헤더가 통째로 무시되고,
//   결과적으로 "비밀번호가 틀렸다"는 오진이 난다.
//
// REST API 는 언제나 JSON 을 돌려준다. HTML 이 오면 무조건 막힌 것이다.
function looksBlocked(response, bodyText) {
  if (response.status === 403 || response.status === 503 || response.status === 429) return true;

  const head = (bodyText || "").trim();
  if (!head) return false;

  // JSON 이 아닌 HTML 응답 = 차단이거나 사람 확인 페이지
  if (head.startsWith("<")) return true;

  return false;
}

// 사람인지 검사하는 페이지인가 (안내 문구를 갈라 쓰기 위해)
export function looksLikeChallenge(bodyText) {
  const head = (bodyText || "").slice(0, 2000);
  if (!head.trim().startsWith("<")) return false;
  return /setTimeout|challenge|jschl|cf_chl|__cf|captcha/i.test(head);
}

export function isCloudflare(response) {
  return /cloudflare/i.test(response.headers.get("server") || "") || Boolean(response.headers.get("cf-ray"));
}

/**
 * 워드프레스 REST API 호출. fetch 와 같은 방식으로 쓰되, 위의 대응이 자동으로 붙는다.
 * 반환값은 표준 Response 에 blocked / usedRestRoute / viaCloudflare 만 덧붙인 것.
 *
 * 주의: 재시도가 필요하므로 body 는 문자열이나 Buffer 여야 한다 (스트림 금지).
 */
export async function wpFetch(url, options = {}) {
  const headers = {...browserHeaders(url), ...(options.headers || {})};
  const origin = originOf(url);
  const altUrl = toRestRouteUrl(url);

  // 이 사이트가 이미 ?rest_route= 로만 통하는 걸 알고 있으면 곧바로 그쪽으로
  const firstUrl = preferRestRoute.has(origin) && altUrl ? altUrl : url;

  const send = async (target) => {
    const response = await fetch(target, {...options, headers});
    // 판정을 위해 본문을 한 번 읽고, 호출부가 다시 읽을 수 있게 새 Response 로 감싼다
    const bodyText = await response.text();
    const wrapped = new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    wrapped.blocked = looksBlocked(response, bodyText);
    wrapped.challenged = looksLikeChallenge(bodyText);
    wrapped.bodyPreview = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);
    wrapped.viaCloudflare = isCloudflare(response);
    wrapped.usedRestRoute = target !== url;
    return wrapped;
  };

  let result = await send(firstUrl);

  // 막혔고, 아직 안 써본 우회 경로가 남아 있으면 그쪽으로 한 번 더.
  //
  // 단, '사람 확인' 페이지면 우회해도 같다 — 경로가 아니라 접속자를 보고
  // 막는 것이라(실측: /wp-json/ 과 ?rest_route= 가 똑같은 화면을 돌려줌).
  // 그런데도 한 번 더 두드리면 차단 시간만 길어진다.
  if (result.blocked && !result.challenged && altUrl && firstUrl !== altUrl) {
    const retry = await send(altUrl);
    if (!retry.blocked) {
      preferRestRoute.add(origin); // 이 사이트는 앞으로 이 길로
      return retry;
    }
    // 둘 다 막혔으면 원래 응답을 돌려준다 (안내 문구가 첫 응답 기준이라)
    result.triedRestRoute = true;
    return result;
  }

  return result;
}

// 이 사이트가 우회 경로로 붙고 있는지 (안내 문구에 쓴다)
export function usingRestRoute(url) {
  return preferRestRoute.has(originOf(url));
}
