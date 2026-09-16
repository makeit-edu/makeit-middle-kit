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
export const 버전 = "2026-09-17a";

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
  return {
    출처: 주소, 원문제목: 제목,
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
섹션(인용구 제목) 5~6개, 그중 하나에 표 1개. 확실하지 않은 금액·날짜·기관명은 쓰지 말고 "주소지 관할 기관에 확인" 처럼 안내한다.`;
  const 지시 = `당신은 한국 네이버 블로그 정보성 글을 쓰는 작가다. 존댓말, 짧은 문장, 40~60대 독자가 읽기 쉬운 말투.
${뼈대설명}

블록 규칙
- 문단: 2~4줄. 줄 사이 빈 줄("") 을 넣어 호흡을 준다.
- 섹션 제목은 '인용구' 블록으로 넣는다 (벤치마크가 그렇다). 소제목 블록은 쓰지 않는다.
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

export async function 만들기({ 키, 벤치마크, 벤치마크URL, 키워드, 원고이름 = "원고2.json", 사진수 = 5, 사진접두 = "그림" }) {
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

  const 사진폴더 = path.join(프로젝트, "02_사진넣는곳");
  await mkdir(사진폴더, { recursive: true });
  let n = 0;
  const 사진블록 = 원고.블록.filter((b) => b.종류 === "사진");
  // 그림은 동시에 만든다 (장당 30초~1분)
  await Promise.all(사진블록.map(async (b) => {
    const 번호 = ++n;
    const 파일 = `${사진접두}${번호}.png`;
    try {
      await 그림그리기({ 키, 프롬프트: b.프롬프트, 저장경로: path.join(사진폴더, 파일) });
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

  const 원고경로 = path.join(프로젝트, "01_원고넣는곳", 원고이름);
  await mkdir(path.dirname(원고경로), { recursive: true });
  await writeFile(원고경로, JSON.stringify({ 제목: 원고.제목, 블록 }, null, 2), "utf8");
  기록.push({ 단계: "저장", 원고: 원고경로 });
  return { 제목: 원고.제목, 원고: 원고이름, 기록 };
}
