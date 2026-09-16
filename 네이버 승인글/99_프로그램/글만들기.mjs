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

export async function 원고쓰기({ 키, 벤치마크, 사진수 = 5 }) {
  const 지시 = `당신은 한국 네이버 블로그 정보성 글을 쓰는 작가다. 존댓말, 짧은 문장, 40~60대 독자가 읽기 쉬운 말투.
아래 '벤치마크 구조' 는 참고할 글의 뼈대다. 섹션 순서와 표 · 사진 배치는 그대로 따르되, 문장은 전부 새로 써라.
벤치마크 글의 문장을 기억하고 있더라도 절대 그대로 옮기지 마라. 제목도 새로 짓되 핵심 키워드는 유지한다.
사실(제도 이름, 금액, 조건, 신청처)은 '사실 요약' 에 있는 것만 쓴다. 없는 수치는 만들지 않는다.

블록 규칙
- 문단: 2~4줄. 줄 사이 빈 줄("") 을 넣어 호흡을 준다.
- 섹션 제목은 '인용구' 블록으로 넣는다 (벤치마크가 그렇다). 소제목 블록은 쓰지 않는다.
- 표는 정확히 9칸(3열×3행): 첫 줄은 열 이름, 그 다음 두 줄은 대표 사례 2개.
- 사진은 총 ${사진수}장. 각 사진의 '프롬프트' 는 영어로, 다음을 반드시 포함:
  "square 1:1, soft pastel Korean illustration, warm and friendly, no text, no letters, no watermark".
  사람을 그릴 때는 "seen from behind or in profile, face not visible" 를 넣는다. 원문 문장을 그리지 말고 그 섹션의 메시지를 상징하는 장면으로.
- 구분선은 마지막 문단 앞에 한 번.
- 전체 문단 글자 수는 1,800~2,600자.`;

  const 입력 = `벤치마크 구조:\n${JSON.stringify(벤치마크, null, 1)}`;
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

export async function 만들기({ 키, 벤치마크, 원고이름 = "원고2.json", 사진수 = 5, 사진접두 = "그림" }) {
  if (!키) throw new Error("OpenAI 키가 없습니다");
  const 기록 = [];
  const 원고 = await 원고쓰기({ 키, 벤치마크, 사진수 });
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
