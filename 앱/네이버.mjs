// 앱/네이버.mjs — 2주차: 네이버 블로그 글 자동 작성 (코덱스 앱 판)
//
// 승인글과 똑같은 방식이다.
//   · 프로그램은 수강생 PC 에 남지 않는다. 로더가 GitHub 에서 임시 폴더로 받아 와 실행하고 지운다.
//   · 수강생 폴더에는 데이터만 남는다: `네이버 승인글/03_쓴글/날짜_키워드/` (원고.json · 원고.md · 사진)
//   · OpenAI 키·수강 코드는 승인글 키 설정(`애드센스 승인글/00_설정/설정.json`)을 그대로 쓴다. 다시 묻지 않는다.
//   · 쓴 돈은 승인글과 같은 장부(`애드센스 승인글/02_생성결과_확인용/사용량.json`)에 적는다.
//   · 크롬 조작(agent)은 코덱스 채팅 창 최상위에서 만들어 넘겨받는다 (크롬 확장이 그 자리에서만 붙는다 — 2026-09-16 실측).
//   · 네이버에는 임시저장까지만. 발행은 사람이 한다.
//
// 대본(AGENTS.md)에서 부르는 순서
//   앱.네이버.상태({작업폴더})          → 수강 코드·키·크롬 확장 위치
//   앱.네이버.로그인확인({agent})       → 크롬 네이버 로그인 여부
//   앱.네이버.글만들기({작업폴더, 키워드 | 벤치마크URL})  → 원고·사진 (2~3분)
//   앱.네이버.쓰기({agent, 작업폴더, 원고, 시작블록})   → 네이버 편집기에 입력·임시저장 (3~4분, 나눠서)
//   앱.네이버.진단({작업폴더, agent})

import {appendFile, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {처방 as 승인글처방, 잠금으로, 오류한줄} from "./승인글.mjs";

export const 버전 = "2026-09-28a";

const 여기 = dirname(fileURLToPath(import.meta.url));
const 프로그램폴더 = join(여기, "네이버");
const 기본수강코드 = ["weolbumakeitmiddle"];
const 데이터폴더 = (작업폴더) => join(작업폴더, "네이버 승인글");
const 쓴글폴더 = (작업폴더) => join(데이터폴더(작업폴더), "03_쓴글");
const 설정파일 = (작업폴더) => join(작업폴더, "애드센스 승인글", "00_설정", "설정.json");
const 원장파일 = (작업폴더) => join(작업폴더, "애드센스 승인글", "02_생성결과_확인용", "사용량.json");

// 100만 토큰당 달러. 글 모델·그림 모델 공식 단가가 바뀌면 여기만 고친다 (그림은 토큰 기준 추정값).
// OpenAI 공식 가격표(2026-09-23 확인). 사진도 토큰으로 센다 (사진 모델은 입력=글 프롬프트, 출력=그림 토큰).
const 단가 = {"gpt-5.4-mini": {input: 0.75, output: 4.5}, "gpt-5.4": {input: 2.5, output: 15}, "gpt-5.2": {input: 1.75, output: 14},
  "gpt-image-1-mini": {input: 2, output: 8}, "gpt-image-2": {input: 5, output: 30}, "gpt-image-1": {input: 5, output: 40}};
const 사진한장 = {};
const 원달러 = 1543.57527;

async function 불러(이름) {
  return import(`${pathToFileURL(join(프로그램폴더, 이름)).href}?t=${Date.now()}`);
}
async function 설정읽기(작업폴더) {
  try { return JSON.parse(await readFile(설정파일(작업폴더), "utf8")); } catch { return {}; }
}
const 천단위 = (n) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
const 한국날짜 = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// ───────── 처방 — 네이버 쪽 오류를 "수강생이 할 일" 로 ─────────
const 네이버처방표 = [
  {종류: "다시", 패턴: /Could not prepare accessibility element|is stale or missing|No input was sent/i,
    원인: "코덱스 크롬 확장이 글자를 넣지 못했어요", 할일: "ChatGPT 앱과 크롬을 모두 완전히 껐다 켠 뒤 다시 '네이버 글 써줘' 라고 하세요. 크롬 확장이 막 새로 바뀐 직후에 이럴 수 있어요."},
  {종류: "내설정", 패턴: /크롬 플러그인을 못 찾|browser-client|클라이언트경로|Codex 홈 폴더/i,
    원인: "코덱스의 크롬 확장이 설치돼 있지 않아요", 할일: "코덱스 앱 → 설정 → 컴퓨터 사용(Chrome)에서 크롬 확장을 설치하고, 크롬 오른쪽 위 퍼즐 모양에서 확장을 켠 뒤 다시 '네이버 글 써줘' 라고 하세요."},
  {종류: "내설정", 패턴: /크롬 연결 없음|not connected|no browser|browser.*(unavailable|not found)|extension.*(not|disconnected)|Could not connect/i,
    원인: "크롬과 코덱스가 연결돼 있지 않아요", 할일: "크롬을 켜고 오른쪽 위 퍼즐 모양에서 ChatGPT(Codex) 확장이 켜져 있는지 확인한 뒤 다시 '네이버 글 써줘' 라고 하세요."},
  {종류: "내설정", 패턴: /로그인이 안 돼|nid\.naver\.com|로그인: false/i,
    원인: "크롬에서 네이버 로그인이 안 돼 있어요", 할일: "크롬에서 네이버에 로그인한 뒤 '됐어요' 라고 해 주세요. (로그인 상태 유지를 체크하면 다음부터 안 풀려요)"},
  {종류: "내설정", 패턴: /제목이 화면에 안 들어갔|창이 가려져|outside the active tab|viewport|화면 안으로 못 가져옴|화면에 없음|글감 막대/i,
    원인: "크롬 창이 가려져 있거나 작아서 입력할 곳을 누르지 못했어요", 할일: "크롬 창을 최대화(화면 가득)해 맨 앞에 두고, 글을 쓰는 동안 마우스·키보드를 건드리지 말고 다시 '네이버 글 써줘' 라고 하세요."},
  {종류: "잠시", 패턴: /Timed out .*(evaluating|waiting)|deadline exceeded/i,
    원인: "네이버 글쓰기 화면이 제때 반응하지 않았어요", 할일: "크롬에 열린 네이버 글쓰기 탭을 모두 닫고, 크롬 창을 최대화한 뒤 다시 '네이버 글 써줘' 라고 하세요."},
  {종류: "사이트", 패턴: /작성 중인 글/i,
    원인: "네이버에 '작성 중인 글' 알림이 떠 있어요", 할일: "크롬의 네이버 글쓰기 화면에서 알림의 '취소'를 누른 뒤 다시 하세요."},
  {종류: "잠시", 패턴: /편집기 프레임을 못 찾|에디터|Tab not found|claimTab|탭.*(닫|없)/i,
    원인: "네이버 글쓰기 화면이 늦게 떴거나 탭이 닫혔어요", 할일: "크롬에 열린 네이버 글쓰기 탭을 모두 닫고 다시 '네이버 글 써줘' 라고 하세요. 쓰다 만 글은 네이버 임시저장에 남아 있어요."},
  {종류: "다시", 패턴: /버튼 못 찾|칸을 못 찾|셀렉터|표가 안 생김|친 줄을 화면에서 못 찾/i,
    원인: "네이버 글쓰기 화면에서 누를 곳을 찾지 못했어요", 할일: "크롬 창을 최대화하고, 네이버 글쓰기 탭을 모두 닫은 뒤 다시 '네이버 글 써줘' 라고 하세요. 그래도 같은 곳에서 멈추면 그 부분만 발행 전에 네이버에서 직접 넣어 주세요."},
  {종류: "내설정", 패턴: /네이버 블로그 글 주소가 아닙니다|벤치마크 글을 못 읽음/i,
    원인: "따라 쓸 글 주소를 읽지 못했어요", 할일: "blog.naver.com/아이디/글번호 모양의 주소인지 확인하세요. 비공개 글은 읽을 수 없어요. 주소 대신 키워드만 주셔도 됩니다."},
];
// 처방표에 없는 오류 — 무엇이 안 됐는지(오류 내용·멈춘 곳)를 그대로 알려 주고, 수강생이 바로 할 수 있는 일(다시 하기)을 준다.
// 2026-09-28 진현님: "처방 목록에 없는 오류", "문의 채널에 올려 주세요" 같은 말은 절대 하지 않는다. 수강생이 결과를 보고 스스로 다시 하게.
function 모르는오류(원문, {단계 = "", 어디 = "쓰기"} = {}) {
  const 짧게 = 오류한줄(원문) || "알 수 없는 오류";
  if (어디 === "글") return {종류: "다시", 원인: `글과 사진을 만들다 멈췄어요: ${짧게}`, 할일: "1~2분 뒤 같은 키워드를 다시 말해 주세요."};
  const 곳 = 단계 ? ` (${String(단계).replace(/^블록(\d+)·/, "$1번째 부분 · ")})` : "";
  return {종류: "다시", 원인: `네이버에 쓰다가 멈췄어요${곳}: ${짧게}`,
    할일: "크롬 창을 최대화(화면 가득)해 맨 앞에 두고, 열려 있는 네이버 글쓰기 탭을 닫은 뒤 '다시 해줘' 라고 하세요. 같은 글을 처음부터 다시 써요. (멈춘 글은 네이버 임시저장에 남아 있으니 지워도 돼요)"};
}

export function 처방(문구) {
  const t = String(문구 || "");
  for (const p of 네이버처방표) if (p.패턴.test(t)) return {종류: p.종류, 원인: p.원인, 할일: p.할일};
  const 승인글쪽 = 승인글처방(t); // OpenAI 키·크레딧·잠깐 몰림 같은 공통 오류
  if (승인글쪽) return {...승인글쪽, 할일: 승인글쪽.할일.replace(/'승인글 자동화 시작해'/g, "'네이버 글 써줘'")};
  return null;
}
const 처방또는프로그램 = (문구, 곳 = {}) => ({...(처방(문구) || 모르는오류(문구, 곳)), 원문: 오류한줄(문구)});

// ───────── 사용량 장부 (승인글과 같은 파일, 같은 모양) ─────────
function 비용({model, input_tokens = 0, output_tokens = 0}) {
  if (사진한장[model] != null) return 사진한장[model];
  const 값 = 단가[Object.keys(단가).find((k) => String(model).includes(k))] || 단가["gpt-5.2"];
  return (input_tokens / 1e6) * 값.input + (output_tokens / 1e6) * 값.output;
}
async function 장부적기(작업폴더, {제목, 사용량}) {
  const 경로 = 원장파일(작업폴더);
  let 원장 = {버전: 1, 시작일: "", 글: []};
  try { 원장 = JSON.parse(await readFile(경로, "utf8")); } catch {}
  if (!Array.isArray(원장.글)) 원장.글 = [];
  const input = 사용량.reduce((a, u) => a + (u.input_tokens || 0), 0);
  const output = 사용량.reduce((a, u) => a + (u.output_tokens || 0), 0);
  const usd = 사용량.reduce((a, u) => a + 비용(u), 0);
  const 줄 = {때: new Date().toISOString(), site: 0, 종류: "네이버", title: 제목, model: [...new Set(사용량.map((u) => u.model))].join("+"),
    input_tokens: input, output_tokens: output, total_tokens: input + output, usd: Number(usd.toFixed(6)), krw: Number((usd * 원달러).toFixed(1))};
  원장.글.push(줄);
  const 합 = {글수: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, usd: 0, krw: 0};
  for (const g of 원장.글) { 합.글수 += 1; for (const k of ["input_tokens", "output_tokens", "total_tokens", "usd", "krw"]) 합[k] += Number(g[k]) || 0; }
  합.usd = Number(합.usd.toFixed(6)); 합.krw = Number(합.krw.toFixed(1));
  await mkdir(dirname(경로), {recursive: true});
  await writeFile(경로, JSON.stringify({버전: 1, 설명: 원장.설명 || "이 키트가 OpenAI 를 쓴 기록. 글마다 한 줄.", 시작일: 원장.시작일 || 줄.때, 합계: 합, 글: 원장.글}, null, 2), "utf8");
  const 네이버글 = 원장.글.filter((g) => g.종류 === "네이버");
  return [
    `💰 이 글: 토큰 ${천단위(줄.total_tokens)}개 (넣은 말 ${천단위(input)} + 나온 글·사진 ${천단위(output)}) · 약 ${천단위(줄.krw)}원`,
    `지금까지 네이버 ${네이버글.length}개 · 약 ${천단위(네이버글.reduce((a, g) => a + (Number(g.krw) || 0), 0))}원 │ 승인글 포함 전체 ${합.글수}개 · 약 ${천단위(합.krw)}원`,
  ];
}

async function 쓴글목록(작업폴더) {
  const 뿌리 = 쓴글폴더(작업폴더);
  if (!existsSync(뿌리)) return [];
  const 목록 = [];
  for (const 이름 of (await readdir(뿌리)).sort()) {
    try {
      const 원고 = JSON.parse(await readFile(join(뿌리, 이름, "원고.json"), "utf8"));
      let 결과 = null;
      try { 결과 = JSON.parse(await readFile(join(뿌리, 이름, "결과.json"), "utf8")); } catch {}
      목록.push({폴더: 이름, 제목: 원고.제목, 원고: join(뿌리, 이름, "원고.json"), 임시저장: !!결과?.임시저장, 때: 결과?.때 || ""});
    } catch {}
  }
  return 목록;
}

// ───────── 대본에서 부르는 함수 ─────────

// 네이버를 시작해도 되는지. 크롬확장 은 채팅 창에서 import 할 주소 (없으면 빈 값 + 할일).
export async function 상태({작업폴더, 수강코드목록 = 기본수강코드} = {}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  await mkdir(쓴글폴더(작업폴더), {recursive: true});
  const 설정 = await 설정읽기(작업폴더);
  let 크롬확장 = "", 할일 = null;
  try {
    const 타이핑 = await 불러("naver-typing.mjs");
    크롬확장 = pathToFileURL(타이핑.클라이언트경로()).href;
  } catch (e) {
    할일 = 처방또는프로그램(String(e?.message || e));
  }
  const 쓴글 = await 쓴글목록(작업폴더);
  const 수강코드 = 수강코드목록.includes(설정.수강코드) ? "됨" : 설정.수강코드 ? "틀림" : "없음";
  const openai키 = String(설정.openai키 || "").startsWith("sk-") ? "됨" : "없음";
  return {
    버전, 수강코드, openai키, 크롬확장, 할일,
    키설정끝: 수강코드 === "됨" && openai키 === "됨",
    쓴글수: 쓴글.length,
    임시저장안된글: 쓴글.filter((g) => !g.임시저장).map((g) => ({제목: g.제목, 원고: g.원고})).slice(-3),
  };
}

// 크롬에서 네이버 로그인이 돼 있는지. 확인용 탭은 닫는다.
export async function 로그인확인({agent} = {}) {
  if (!agent) return {로그인: false, 할일: 처방또는프로그램("크롬 연결 없음")};
  let 탭 = null;
  try {
    const chrome = await agent.browsers.get("chrome");
    탭 = await chrome.tabs.new();
    await 탭.goto("https://blog.naver.com/GoBlogWrite.naver");
    await new Promise((r) => setTimeout(r, 5000));
    const 주소 = String(await Promise.resolve(탭.url()).catch(() => ""));
    const 로그인 = !/nid\.naver\.com/.test(주소) && /blog\.naver\.com/.test(주소);
    return {로그인, 할일: 로그인 ? null : 처방또는프로그램("로그인이 안 돼 있습니다")};
  } catch (e) {
    return {로그인: false, 할일: 처방또는프로그램(String(e?.message || e))};
  } finally {
    try { if (탭) await 탭.close(); } catch {}
  }
}

// 키워드(또는 따라 쓸 네이버 글 주소)로 원고와 사진을 만든다. 2~3분.
export async function 글만들기(옵션 = {}) {
  if (!옵션.작업폴더) throw new Error("작업폴더 가 필요합니다");
  return 잠금으로({작업폴더: 옵션.작업폴더, 이름: "네이버-글", 일: () => 글만들기본체(옵션)});
}
async function 글만들기본체({작업폴더, 키워드 = "", 벤치마크URL = "", 사진수 = 3} = {}) {
  const 설정 = await 설정읽기(작업폴더);
  if (!String(설정.openai키 || "").startsWith("sk-")) return {결과: "설정 필요", 빠진: ["OpenAI 키"]};
  if (!키워드 && !벤치마크URL) return {결과: "키워드 필요"};
  const 글 = await 불러("글만들기.mjs");
  const 핵심 = 글.슬러그(키워드 || "따라쓰기", 30);
  let 저장폴더 = join(쓴글폴더(작업폴더), `${한국날짜()}_${핵심}`);
  for (let n = 2; existsSync(저장폴더); n += 1) 저장폴더 = join(쓴글폴더(작업폴더), `${한국날짜()}_${핵심}_${n}`);
  let r;
  try {
    r = await 글.만들기({키: 설정.openai키, 키워드: 키워드 || undefined, 벤치마크URL: 벤치마크URL || undefined, 사진수, 저장폴더});
  } catch (e) {
    const 문구 = String(e?.message || e);
    return {결과: "실패", 할일: 처방또는프로그램(문구, {어디: "글"})};
  }
  let 돈 = [];
  try { 돈 = await 장부적기(작업폴더, {제목: r.제목, 사용량: r.사용량 || []}); } catch (e) { 돈 = [`(사용량 기록 실패: ${String(e?.message || e).slice(0, 60)})`]; }
  return {
    결과: "됨", 제목: r.제목, 원고: r.원고, 사진수: r.사진수,
    사진실패수: (r.사진실패 || []).length,
    사진실패할일: (r.사진실패 || []).length ? 처방또는프로그램(r.사진실패[0], {어디: "글"}) : null,
    돈,
  };
}

// 네이버 편집기에 입력하고 임시저장. 한 번에 3분 안팎만 쓰고 "이어서" 를 돌려준다 (코덱스 한 번 실행 시간 한도 때문).
// 두 번 겹쳐 돌면 한 편집기에 두 프로그램이 동시에 입력하므로 반드시 잠근다.
export async function 쓰기(옵션 = {}) {
  if (!옵션.작업폴더 || !옵션.원고) throw new Error("작업폴더·원고 가 필요합니다");
  return 잠금으로({작업폴더: 옵션.작업폴더, 이름: "네이버-쓰기", 일: () => 쓰기본체(옵션)});
}
// 원고 경로를 절대경로로 — 코덱스가 "네이버 승인글/03_쓴글/…/원고.json" 이나 폴더 이름만 넘길 때가 있다 (2026-09-23 실측).
function 원고찾기(작업폴더, 원고) {
  const 이름 = String(원고 || "").trim();
  const 후보 = [이름, join(작업폴더, 이름), join(데이터폴더(작업폴더), 이름), join(쓴글폴더(작업폴더), 이름), join(쓴글폴더(작업폴더), 이름, "원고.json"), join(작업폴더, 이름, "원고.json")];
  return 후보.find((p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) ? existsSync(p) && p.endsWith(".json") : false) || 이름;
}
async function 쓰기본체({agent, 작업폴더, 원고, 시작블록 = 0} = {}) {
  원고 = 원고찾기(작업폴더, 원고);
  if (!agent) return {결과: "멈춤", 할일: 처방또는프로그램("크롬 연결 없음")};
  const 타이핑 = await 불러("naver-typing.mjs");
  let r;
  try {
    // 다시쓰기: 점검에서 문제가 나오면 같은 탭에서 한 번만 처음부터 다시 쓴다. 대본은 "이어서"(시작블록 0) 로 받아 그대로 다시 부른다.
    const 상태판 = globalThis.__메킷다시쓰기;
    const 다시쓰기 = Number(시작블록) === 0 && 상태판 && 상태판.원고 === 원고 && 상태판.단계 === "대기";
    if (다시쓰기) 상태판.단계 = "진행";
    r = await 타이핑.실행({agent, 원고, 시작블록: Number(시작블록) || 0, 데이터폴더: 데이터폴더(작업폴더), 다시쓰기});
  } catch (e) {
    return {결과: "멈춤", 할일: 처방또는프로그램(String(e?.message || e), {단계: "시작"})};
  }
  const 기록 = Array.isArray(r.기록) ? r.기록 : [];
  // 쓸 때마다 원고 폴더에 기록을 한 줄씩 남긴다 (멈춘 곳·오류를 나중에 그대로 볼 수 있게. 키·비밀번호는 기록에 없다).
  try { await appendFile(join(dirname(원고), "기록.jsonl"), JSON.stringify({때: new Date().toISOString(), 시작블록: Number(시작블록) || 0, 결과: r.결과, 기록}) + "\n", "utf8"); } catch {}
  if (r.결과 === "이어서 필요" && r.이어서) {
    const 경고 = 기록.filter((x) => x.건너뜀 || x.사진건너뜀 || x.경고).map((x) => `${x.단계}: ${String(x.건너뜀 || x.사진건너뜀 || x.경고).slice(0, 200)}`);
    return {결과: "이어서", 원고, 시작블록: r.이어서.시작블록, 남은블록: r.이어서.남은블록, 걸린시간초: r.걸린시간초, 진단: 경고};
  }
  if (String(r.결과).startsWith("끝까지 됨")) {
    const 사진빠짐 = 기록.some((x) => x.사진건너뜀);
    const 빠진블록 = 기록.filter((x) => x.건너뜀).map((x) => x.단계);
    const 빠진이유 = 기록.filter((x) => x.건너뜀 || x.사진건너뜀 || x.경고).map((x) => `${x.단계}: ${String(x.건너뜀 || x.사진건너뜀 || x.경고).slice(0, 200)}`);
    const 점검 = [...기록].reverse().find((x) => x.단계 === "점검") || {문제: []};
    const 문제 = 점검.문제 || [];
    const 상태판2 = globalThis.__메킷다시쓰기;
    if (문제.length && !(상태판2 && 상태판2.원고 === 원고 && 상태판2.단계 === "진행")) {
      globalThis.__메킷다시쓰기 = {원고, 단계: "대기", 첫점검: 문제};
      return {결과: "이어서", 원고, 시작블록: 0, 다시쓰는중: true, 걸린시간초: r.걸린시간초, 진단: [...빠진이유, ...문제.map((m) => `점검: ${m}`)]};
    }
    globalThis.__메킷다시쓰기 = null;
    try { await writeFile(join(dirname(원고), "결과.json"), JSON.stringify({임시저장: true, 때: new Date().toISOString(), 사진빠짐, 빠진블록, 점검문제: 문제}, null, 2), "utf8"); } catch {}
    return {결과: "됨", 걸린시간초: r.걸린시간초, 사진빠짐, 빠진블록, 확인할곳: 문제, 진단: 빠진이유};
  }
  const 실패 = [...기록].reverse().find((x) => x.실패 || x.단계 === "오류") || {};
  const 문구 = String(실패.실패 || 실패.내용 || r.결과 || "");
  // 진단: 마지막 기록 몇 줄 (대본은 JSON 을 수강생에게 보여 주지 않는다). 전체 기록은 원고 폴더의 기록.jsonl.
  return {결과: "멈춤", 단계: 실패.단계 || "", 할일: 처방또는프로그램(문구, {단계: 실패.단계}), 진단: 기록.slice(-4)};
}

// "진단해줘" — 네이버 쪽 상태와 할 일.
export async function 진단({작업폴더, agent, 수강코드목록 = 기본수강코드} = {}) {
  const s = await 상태({작업폴더, 수강코드목록});
  const 할일 = [];
  if (s.수강코드 !== "됨") 할일.push({종류: "내설정", 원인: "수강 코드가 없어요", 할일: "채팅에 강의 자료실 공지의 수강 코드를 알려 주세요."});
  if (s.openai키 !== "됨") 할일.push({종류: "내설정", 원인: "OpenAI 키가 없어요", 할일: "키설정.txt 를 채팅에 끌어다 놓거나 sk- 로 시작하는 키만 붙여넣어 주세요."});
  if (s.할일) 할일.push(s.할일);
  let 로그인 = "확인 안 함";
  if (agent) { const l = await 로그인확인({agent}); 로그인 = l.로그인 ? "됨" : "안 됨"; if (l.할일) 할일.push(l.할일); }
  else if (s.크롬확장) { 할일.push(처방또는프로그램("크롬 연결 없음")); 로그인 = "크롬 연결 없음"; }
  const 판정 = 할일.length ? "할 일대로 하면 됨" : "이상 없음";
  return {수강코드: s.수강코드, openai키: s.openai키, 크롬확장: s.크롬확장 ? "있음" : "없음", 네이버로그인: 로그인, 쓴글수: s.쓴글수, 할일, 판정};
}
