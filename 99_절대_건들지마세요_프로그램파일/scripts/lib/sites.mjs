// 사이트 개수는 여기 한 곳에서만 정한다.
//
// 예전에는 [1, 2, 3] 이 여덟 군데에 흩어져 있어서, 개수를 늘리려면 전부 찾아
// 고쳐야 했고 한 군데만 빠져도 조용히 어긋났다. 이제 이 파일만 고치면 된다.
export const MAX_SITES = 10;

// 1 ~ MAX_SITES 번호 목록
export function siteNumbers() {
  return Array.from({length: MAX_SITES}, (_, index) => index + 1);
}

// 사이트 번호 → .env 키 앞머리 (7 → "ADSENSE_SITE_07")
export function sitePrefix(siteNumber) {
  return `ADSENSE_SITE_${String(siteNumber).padStart(2, "0")}`;
}

// 사이트 번호가 우리가 다루는 범위 안인지
export function isValidSiteNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_SITES;
}
