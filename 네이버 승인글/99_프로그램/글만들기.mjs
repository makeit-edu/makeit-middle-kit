// 글만들기.mjs — OpenAI API 로 원고(JSON)와 사진을 만들어 01_원고넣는곳 / 02_사진넣는곳 에 넣는다.
//
//   const 글 = await import("네이버 승인글/99_프로그램/글만들기.mjs");
//   await 글.만들기({ 키: "sk-...", 벤치마크: { ...구조 }, 원고이름: "원고2.json" });
//
// 원칙
//   · 벤치마크 글의 문장은 절대 그대로 쓰지 않는다. 섹션 흐름 · 표 구성 · 사진 배치만 가져온다.
//   · 사실(제도 이름, 금액, 신청처)은 벤치마크에서 정리해 넘긴 '사실 요약' 안에서만 쓴다. 지어내지 않는다.
//   · 사진은 정사각형 파스텔 일러스트. 사람이 들어가면 얼굴이 안 보이게(뒷모습·옆모습).
//   · process 전역을 쓰지 않는다 (Codex REPL 에서도 돌아야 한다).

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 고칠 때마다 올린다. 시작.mjs 가 원격 판이 이보다 새 것일 때만 덮어쓴다.
export const 버전 = "2026-09-17d";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 프로젝트 = path.resolve(여기, "..");

const 글모델 = "gpt-5.2";
const 그림모델 = "gpt-image-2";

async function 오픈AI(키, 경로, body) {
  const r = await fetch("https://api.openai.com/v1" + 경로, {
    method: "POST",
    headers: { Authorization: `Bearer ${키}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${경로} ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// 원고 JSON 의 형식 (naver-typing.mjs 가 읽는 그대로) + 사진 블록에 '프롬프트' 를 더 받는다
const 원고형식 = {
  type: "object",
  additionalProperties: false,
  properties: {
    제목: { type: "string" },
    블록: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          종류: { type: "string", enum: ["문단", "소제목", "인용구", "표", "구분선", "사진"] },
          글: { type: "array", items: { type: "string" }, description: "문단은 줄 배열, 소제목·인용구는 한 줄짜리 배열, 나머지는 빈 배열" },
          칸: { type: "array", items: { type: "string" }, description: "표만. 3열 기준으로 왼쪽→오른쪽, 위→아래. 최대 9칸. 나머지는 빈 배열" },
          프롬프트: { type: "string", description: "사진만. 영어 이미지 생성 프롬프트. 나머지는 빈 문자열" },
        },
        required: ["종류", "글", "칸", "프롬프트"],
      },
    },
  },
  required: ["제목", "블록"],
};

// 네이버 블로그 글 주소를 주면 뼈대(제목·인용구 제목·표·사진 개수·문단 요지)를 뽑는다. 모바일 페이지가 파싱하기 쉽다.
export async function 벤치마크가져오기(주소) {
  const m = /blog\.naver\.com\/([^/?#]+)\/(\d+)/.exec(주소) || /blogId=([^&]+).*logNo=(\d+)/.exec(주소);
  if (!m) throw new Error("네이버 블로그 글 주소가 아닙니다: " + 주소);
  const r = await fetch(`https://m.blog.naver.com/${m[1]}/${m[2]}`, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`벤치마크 글을 못 읽음: HTTP ${r.status}`);
  const h = await r.text();
  const 풀기 = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|​/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  const 제목 = 풀기((/<title>(.*?)<\/title>/s.exec(h) || [, ""])[1]).replace(/\s*:\s*네이버 블로그$/, "");
  const 컴포넌트 = [...h.matchAll(/<div class="se-component se-([a-zA-Z]+)/g)].map((x) => x[1]).filter((x) => x !== "documentTitle");
  const 인용구 = [...h.matchAll(/<div class="se-component se-quotation.*?<\/div>\s*<\/div>\s*<\/div>/gs)].map((x) => 풀기(x[0]).slice(0, 60)).filter(Boolean);
  const 표들 = [...h.matchAll(/<div class="se-component se-table.*?<\/table>/gs)].map((t) => [...t[0].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => 풀기(c[1])));
  const 문단 = [...h.matchAll(/<(?:p|span) class="se-text-paragraph[^"]*"[^>]*>(.*?)<\/(?:p|span)>/gs)].map((x) => 풀기(x[1])).filter((x) => x.length > 15);
  // 도입부(첫 인용구 제목이 나오기 전까지의 본문 문단) — 후킹을 참고하려고 따로 뽑는다
  const 첫인용 = h.search(/<div class="se-component se-quotation/);
  const 앞부분 = 첫인용 > 0 ? h.slice(0, 첫인용) : h.slice(0, Math.floor(h.length / 4));
  const 도입부 = [...앞부분.matchAll(/<(?:p|span) class="se-text-paragraph[^"]*"[^>]*>(.*?)<\/(?:p|span)>/gs)]
    .map((x) => 풀기(x[1])).filter((x) => x.length > 8 && x !== 제목).slice(0, 6);
  return {
    출처: 주소, 원문제목: 제목,
    도입부_후킹참고: 도입부,
    컴포넌트순서: 컴포넌트,
    섹션순서_인용구제목: 인용구,
    표: 표들.filter((t) => t.length >= 6).map((t) => t.slice(0, 24)),
    사진수: 컴포넌트.filter((c) => c === "image").length,
    // 문장을 베끼지 않도록 '요지' 로만 넘긴다: 문단 앞 80자
    문단요지: 문단.slice(0, 40).map((p) => p.slice(0, 80)),
  };
}

export async function 원고쓰기({ 키, 벤치마크, 키워드, 사진수 = 5 }) {
  const 뼈대설명 = 벤치마크
    ? `아래 '벤치마크 구조' 는 참고할 글의 뼈대다. 섹션 순서와 표 · 사진 배치는 그대로 따르되, 문장은 전부 새로 써라.
벤치마크 글의 문장을 기억하고 있더라도 절대 그대로 옮기지 마라. '문단요지' 는 어떤 내용을 다뤘는지 알기 위한 것이지 베낄 문장이 아니다. 제목도 새로 짓되 핵심 키워드는 유지한다.
사실(제도 이름, 금액, 조건, 신청처)은 벤치마크에 나온 것만 쓴다. 없는 수치는 만들지 않는다.`
    : `주제 키워드: "${키워드}". 이 키워드로 검색해 들어온 독자가 궁금해할 것을 순서대로 푼다.
소제목 5~6개, 그중 하나에 표 1개. 확실하지 않은 금액·날짜·기관명은 쓰지 말고 "주소지 관할 기관에 확인" 처럼 안내한다.`;
  const 후킹규칙 = `
[가장 중요: 첫 문단(후킹)]
- 첫 문단은 딱 3줄. 이 3줄이 글의 성패를 가른다.
  1줄: 독자의 지금 상황·걱정을 정확히 찌른다 (예: "부모님 생신이 두 달 남았는데 아직 아무것도 안 알아보셨다면").
  2줄: 이 글을 끝까지 읽으면 무엇을 얻는지 한 문장으로 요약한다 (대상·금액·방법 같은 핵심을 구체어로).
  3줄: 지금 바로 확인해야 하는 이유와 행동 유도 (기한·놓치면 손해·1분이면 확인 같은 말로).
- 3줄 사이에는 빈 줄("") 을 넣지 않는다. 그 다음 문단부터 평소대로.
${벤치마크 && 벤치마크.도입부_후킹참고 && 벤치마크.도입부_후킹참고.length ? `- '도입부_후킹참고' 는 참고 글의 도입부다. 어떤 순서로 독자를 끌어당기는지, 어느 정도 세게 말하는지, 무엇을 약속하는지를 배워라. 그 강도와 구조를 그대로 살리되 문장·표현·예시는 전부 새로 써라. 한 문장이라도 그대로 옮기면 실패다.` : ""}`;
  const 지시 = `당신은 한국 네이버 블로그 정보성 글을 쓰는 작가다. 존댓말, 짧은 문장, 40~60대 독자가 읽기 쉬운 말투.
${뼈대설명}
${후킹규칙}

블록 규칙
- 문단: 2~4줄. 줄 사이 빈 줄("") 을 넣어 호흡을 준다.
- 단락(섹션) 제목은 반드시 '소제목' 블록으로 넣는다 (검색 노출에 소제목이 유리하다). 벤치마크의 '섹션순서_인용구제목' 은 제목의 순서·내용만 참고하고, 블록 종류는 소제목으로 바꾼다. 소제목은 5~7개, 각 15자 안팎, 키워드가 자연스럽게 들어가게.
- '인용구' 블록은 강조용이다. 글 전체에서 2~3개만, 본문 중간에서 독자가 꼭 기억해야 할 한 문장(핵심 결론·주의·행동)을 넣는다. 소제목 자리에 인용구를 쓰지 않는다.
- 표는 정확히 9칸(3열×3행): 첫 줄은 열 이름, 그 다음 두 줄은 대표 사례 2개.
- 사진은 총 ${사진수}장. 각 사진의 '프롬프트' 는 영어로, 다음을 반드시 포함:
  "square 1:1, soft pastel Korean illustration, warm and friendly, no text, no letters, no watermark".
  사람을 그릴 때는 "seen from behind or in profile, face not visible" 를 넣는다. 원문 문장을 그리지 말고 그 섹션의 메시지를 상징하는 장면으로.
- 구분선은 마지막 문단 앞에 한 번.
- 전체 문단 글자 수는 1,800~2,600자.`;

  const 입력 = 벤치마크 ? `벤치마크 구조:\n${JSON.stringify(벤치마크, null, 1)}` : `주제 키워드: ${키워드}`;
  const j = await 오픈AI(키, "/responses", {
    model: 글모델,
    input: [{ role: "developer", content: 지시 }, { role: "user", content: 입력 }],
    text: { format: { type: "json_schema", name: "naver_post", schema: 원고형식, strict: true } },
    reasoning: { effort: "medium" },
  });
  const 본문 = (j.output || []).flatMap((o) => o.content || []).find((c) => c.type === "output_text");
  if (!본문) throw new Error("글 모델이 본문을 안 돌려줌: " + JSON.stringify(j).slice(0, 300));
  return JSON.parse(본문.text);
}

export async function 그림그리기({ 키, 프롬프트, 저장경로 }) {
  const j = await 오픈AI(키, "/images/generations", {
    model: 그림모델,
    prompt: 프롬프트,
    size: "1024x1024",
    quality: "medium",
    n: 1,
  });
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error("그림 모델이 이미지를 안 돌려줌");
  await writeFile(저장경로, Buffer.from(b64, "base64"));
  return 저장경로;
}

// 파일명에 넣을 키워드. 한글·영문·숫자만 남기고 띄어쓰기는 '-' 로. (네이버는 이미지 파일명도 본다)
export function 슬러그(글자, 최대 = 40) {
  return String(글자 || "").normalize("NFC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 최대).replace(/-$/, "") || "글";
}

// 글 하나 = 폴더 하나. 03_쓴글/2026-09-17_키워드/ 안에 원고.json 과 키워드-1.png … 가 들어간다.
export async function 만들기({ 키, 벤치마크, 벤치마크URL, 키워드, 사진수 = 5, 저장폴더 }) {
  if (!키) throw new Error("OpenAI 키가 없습니다");
  if (!벤치마크 && !벤치마크URL && !키워드) throw new Error("키워드나 벤치마크 글 주소가 필요합니다");
  const 기록 = [];
  if (!벤치마크 && 벤치마크URL) {
    벤치마크 = await 벤치마크가져오기(벤치마크URL);
    기록.push({ 단계: "벤치마크", 원문제목: 벤치마크.원문제목, 섹션수: 벤치마크.섹션순서_인용구제목.length, 사진수: 벤치마크.사진수 });
    if (!사진수) 사진수 = Math.min(6, Math.max(3, 벤치마크.사진수));
  }
  const 원고 = await 원고쓰기({ 키, 벤치마크, 키워드, 사진수 });
  기록.push({ 단계: "글", 제목: 원고.제목, 블록수: 원고.블록.length });

  // 폴더 이름: 날짜_키워드. 키워드가 없으면(벤치마크 모드) 새 제목의 앞부분을 쓴다.
  const 핵심 = 슬러그(키워드 || 원고.제목.split(/[,|(:·]/)[0], 30);
  const 날짜 = new Date().toISOString().slice(0, 10);
  const 폴더 = 저장폴더 || path.join(프로젝트, "03_쓴글", `${날짜}_${핵심}`);
  await mkdir(폴더, { recursive: true });

  let n = 0;
  const 사진블록 = 원고.블록.filter((b) => b.종류 === "사진");
  // 그림은 동시에 만든다 (장당 30초~1분). 파일명에 키워드가 들어간다.
  await Promise.all(사진블록.map(async (b) => {
    const 번호 = ++n;
    const 파일 = `${핵심}-${번호}.png`;
    try {
      await 그림그리기({ 키, 프롬프트: b.프롬프트, 저장경로: path.join(폴더, 파일) });
      b.파일 = 파일;
      기록.push({ 단계: `사진${번호}`, 파일, 프롬프트: b.프롬프트.slice(0, 60) });
    } catch (e) {
      b.파일 = null;
      기록.push({ 단계: `사진${번호}`, 실패: String(e?.message || e).slice(0, 120) });
    }
  }));

  // naver-typing.mjs 가 읽는 모양으로 정리
  const 블록 = 원고.블록.map((b) => {
    if (b.종류 === "문단") return { 종류: "문단", 글: b.글 };
    if (b.종류 === "소제목" || b.종류 === "인용구") return { 종류: b.종류, 글: (b.글 || []).join(" ") };
    if (b.종류 === "표") return { 종류: "표", 칸: b.칸.slice(0, 9) };
    if (b.종류 === "구분선") return { 종류: "구분선" };
    if (b.종류 === "사진") return b.파일 ? { 종류: "사진", 파일: b.파일 } : null;
    return null;
  }).filter(Boolean);

  const 원고경로 = path.join(폴더, "원고.json");
  await writeFile(원고경로, JSON.stringify({ 제목: 원고.제목, 키워드: 키워드 || 핵심, 만든날: 날짜, 벤치마크: 벤치마크URL || null, 블록 }, null, 2), "utf8");
  // 사람이 읽기 편한 사본도 같이 둔다
  const 읽기용 = [`# ${원고.제목}`, ""].concat(블록.map((b) => b.종류 === "문단" ? b.글.join("\n") : b.종류 === "소제목" ? `\n## ${b.글}` : b.종류 === "인용구" ? `> ${b.글}` : b.종류 === "표" ? "[표] " + b.칸.join(" | ") : b.종류 === "사진" ? `[사진] ${b.파일}` : "---")).join("\n\n");
  await writeFile(path.join(폴더, "원고.md"), 읽기용, "utf8");
  기록.push({ 단계: "저장", 폴더, 원고: 원고경로, 사진: 블록.filter((b) => b.종류 === "사진").map((b) => b.파일) });
  return { 제목: 원고.제목, 폴더, 원고: 원고경로, 기록 };
}
