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

// 차단당한 응답인지 (값이 틀린 게 아니라 '문 앞에서 막힌' 경우)
function looksBlocked(response, bodyText) {
  if (response.status === 403 || response.status === 503) return true;
  // 200 이어도 JSON 대신 HTML 차단 페이지를 주는 경우가 있다
  if (bodyText && bodyText.trim().startsWith("<") && /cloudflare|attention required|blocked/i.test(bodyText.slice(0, 600))) {
    return true;
  }
  return false;
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
    wrapped.viaCloudflare = isCloudflare(response);
    wrapped.usedRestRoute = target !== url;
    return wrapped;
  };

  let result = await send(firstUrl);

  // 막혔고, 아직 안 써본 우회 경로가 남아 있으면 그쪽으로 한 번 더
  if (result.blocked && altUrl && firstUrl !== altUrl) {
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
