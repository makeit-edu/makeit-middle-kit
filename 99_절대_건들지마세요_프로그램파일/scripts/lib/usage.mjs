// 토큰·비용 원장 + 진행 게이지
//
// 왜 있나:
//   "글 한 개에 토큰을 얼마나 썼고, 지금까지 얼마 썼고, 얼마 남았는지"를 글마다 무조건 보여 주기 위해서.
//   OpenAI 는 일반 API 키로 잔액을 알려 주지 않는다 (organization/costs 는 관리자 키 전용,
//   dashboard/billing 은 브라우저 세션 전용 — 2026-09-20 실측 403).
//   그래서 수강생이 '키설정'에서 충전한 금액(달러)을 한 번 넣으면, 그 뒤로 이 키트가 쓴 만큼만 빼서 계산한다.
//
// 원장은 `애드센스 승인글/02_생성결과_확인용/사용량.json` 하나. 사이트 구분 없이 전부 합산한다.
// '저장' 으로 커밋되는 폴더라 작업방이 지워져도 되살아난다.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {PROJECT_ROOT} from "./env.mjs";

export const 원장경로 = join(PROJECT_ROOT, "애드센스 승인글", "02_생성결과_확인용", "사용량.json");
export const 진행파일경로 = join(PROJECT_ROOT, "애드센스 승인글", "02_생성결과_확인용", "지금_진행상황.md");

const 빈합계 = () => ({글수: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, usd: 0, krw: 0});

function 숫자(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function 원장읽기(경로 = 원장경로) {
  if (!existsSync(경로)) return {버전: 1, 시작일: "", 합계: 빈합계(), 글: []};
  try {
    const raw = JSON.parse(readFileSync(경로, "utf8"));
    const 글 = Array.isArray(raw?.글) ? raw.글 : [];
    return {버전: 1, 시작일: raw?.시작일 || (글[0]?.때 || ""), 합계: 합계내기(글), 글};
  } catch {
    return {버전: 1, 시작일: "", 합계: 빈합계(), 글: []};
  }
}

function 합계내기(글들) {
  const 합 = 빈합계();
  for (const g of 글들) {
    합.글수 += 1;
    합.input_tokens += 숫자(g.input_tokens);
    합.output_tokens += 숫자(g.output_tokens);
    합.total_tokens += 숫자(g.total_tokens);
    합.usd += 숫자(g.usd);
    합.krw += 숫자(g.krw);
  }
  합.usd = Number(합.usd.toFixed(6));
  합.krw = Number(합.krw.toFixed(1));
  return 합;
}

// 글 하나가 끝날 때마다 한 줄 보탠다. 실패한 글은 여기 오지 않는다(돈은 들었어도 결과가 없으면 세지 않는다 — 단순함 우선).
export function 원장기록(항목, 경로 = 원장경로) {
  const 원장 = 원장읽기(경로);
  const 줄 = {
    때: new Date().toISOString(),
    site: 숫자(항목.site) || 1,
    title: String(항목.title || "").trim(),
    model: String(항목.model || ""),
    input_tokens: 숫자(항목.input_tokens),
    output_tokens: 숫자(항목.output_tokens),
    total_tokens: 숫자(항목.total_tokens) || 숫자(항목.input_tokens) + 숫자(항목.output_tokens),
    usd: Number(숫자(항목.usd).toFixed(6)),
    krw: Number(숫자(항목.krw).toFixed(1)),
  };
  원장.글.push(줄);
  원장.합계 = 합계내기(원장.글);
  if (!원장.시작일) 원장.시작일 = 줄.때;
  mkdirSync(dirname(경로), {recursive: true});
  writeFileSync(경로, JSON.stringify({버전: 1, 설명: "이 키트가 OpenAI 를 쓴 기록. 글마다 한 줄. 지우면 '남은 돈' 계산이 처음부터 다시 시작됩니다.", 시작일: 원장.시작일, 합계: 원장.합계, 글: 원장.글}, null, 2), "utf8");
  return 원장;
}

// 충전액 대비 상태. OPENAI_BUDGET_USD 가 없으면 있음:false.
// OPENAI_BUDGET_SET_AT(충전액을 넣은 시각) 이후의 기록만 뺀다 — 다시 충전하고 금액을 고치면 그때부터 새로 센다.
export function 예산상태({env, 원장 = 원장읽기(), usdKrw}) {
  const 예산usd = 숫자(env?.OPENAI_BUDGET_USD);
  const 환율 = 숫자(usdKrw) || 숫자(env?.ARTICLE_USD_KRW) || 1450;
  const 기준 = String(env?.OPENAI_BUDGET_SET_AT || "").trim();
  const 대상 = 기준 ? 원장.글.filter((g) => String(g.때 || "") >= 기준) : 원장.글;
  const 쓴 = 합계내기(대상);
  const 있음 = 예산usd > 0;
  const 남은usd = 있음 ? Math.max(예산usd - 쓴.usd, 0) : 0;
  return {
    있음,
    예산usd,
    예산krw: Math.round(예산usd * 환율),
    기준시각: 기준,
    쓴글수: 쓴.글수,
    쓴usd: 쓴.usd,
    쓴krw: Math.round(쓴.krw),
    쓴퍼센트: 있음 ? 퍼센트(쓴.usd, 예산usd) : null,
    남은usd,
    남은krw: Math.round(남은usd * 환율),
    남은퍼센트: 있음 ? 퍼센트(남은usd, 예산usd) : null,
    환율,
    전체: 원장.합계,
  };
}

export function 퍼센트(부분, 전체) {
  if (!(전체 > 0)) return null;
  const p = (부분 / 전체) * 100;
  if (p === 0) return 0;
  if (p < 0.1) return Number(p.toFixed(2));
  if (p < 10) return Number(p.toFixed(1));
  return Math.round(p);
}

export function 퍼센트문구(p) {
  return p === null || p === undefined ? "-" : `${p}%`;
}

export function 천단위(n) {
  return Math.round(숫자(n)).toLocaleString("ko-KR");
}

// 글 하나가 끝났을 때 찍는 두 줄. 항상 찍는다. 예산(OPENAI_BUDGET_USD)이 없으면 쓴 돈만 찍는다.
export function 돈줄({이글, 이번실행, 예산}) {
  const 첫줄 = `  💰 이 글: 토큰 ${천단위(이글.total_tokens)}개 (넣은 말 ${천단위(이글.input_tokens)} + 나온 글 ${천단위(이글.output_tokens)}) · 약 ${천단위(이글.krw)}원` +
    (예산.있음 ? ` = 충전액의 ${퍼센트문구(퍼센트(이글.usd, 예산.예산usd))}` : "");
  const 둘째 = 예산.있음
    ? `     지금까지 ${예산.쓴글수}개 · 약 ${천단위(예산.쓴krw)}원 (${퍼센트문구(예산.쓴퍼센트)} 씀) │ 남은 돈 약 ${천단위(예산.남은krw)}원 (${퍼센트문구(예산.남은퍼센트)} 남음, 충전 ${천단위(예산.예산krw)}원 기준)`
    : `     이번 실행 ${이번실행.글수}개 · 약 ${천단위(이번실행.krw)}원 │ 전체 누적 ${예산.전체.글수}개 · 약 ${천단위(예산.전체.krw)}원`;
  return [첫줄, 둘째];
}

// ───────────── 진행 게이지 ─────────────

export function 게이지(비율, 폭 = 20) {
  const r = Math.max(0, Math.min(1, 숫자(비율)));
  const 찬 = Math.round(r * 폭);
  return "■".repeat(찬) + "□".repeat(폭 - 찬);
}

const 스피너프레임 = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// 글 한 편은 단계 5개: 중복 확인 → 제목·키워드 → 본문 → 그림 → 올리기.
// 전체 비율 = (끝난 글 수 + (지금 단계-1)/단계수) / 전체 글 수.
//
// 터미널(TTY)에서는 한 줄을 스피너와 함께 계속 덮어쓴다(애니메이션).
// AI 비서가 실행하면 TTY 가 아니라서 단계가 바뀔 때마다 한 줄씩 찍는다 — 비서 화면에 게이지가 그대로 남는다.
// 어느 쪽이든 `지금_진행상황.md` 파일을 같이 갱신하므로, 왼쪽 탐색기에서 그 파일을 열어 두면 게이지가 실시간으로 바뀐다.
export class 진행표시 {
  constructor({전체, 단계수 = 5, 파일 = 진행파일경로, 출력 = process.stdout, 라벨 = ""}) {
    this.전체 = Math.max(1, 숫자(전체));
    this.단계수 = 단계수;
    this.파일 = 파일;
    this.출력 = 출력;
    this.라벨 = 라벨;
    this.끝난글 = 0;
    this.현재 = {글번호: 0, 단계: 0, 문구: "", 제목: ""};
    this.덧말 = "";
    this.tty = Boolean(출력.isTTY);
    this.프레임 = 0;
    this.타이머 = null;
    this.마지막줄길이 = 0;
  }

  비율() {
    const 단계분 = this.현재.단계 > 0 ? (this.현재.단계 - 1) / this.단계수 : 0;
    return Math.min(1, (this.끝난글 + 단계분) / this.전체);
  }

  줄(스피너 = "") {
    const r = this.비율();
    const 퍼 = String(Math.round(r * 100)).padStart(3, " ");
    const 머리 = `${스피너 ? `${스피너} ` : ""}[${게이지(r)}] ${퍼}%`;
    const 글 = this.현재.글번호 > 0 ? ` │ ${this.현재.글번호}/${this.전체}번째 글` : "";
    const 단 = this.현재.단계 > 0 ? ` │ ${this.현재.단계}/${this.단계수}단계 ${this.현재.문구}` : this.현재.문구 ? ` │ ${this.현재.문구}` : "";
    return `${머리}${글}${단}`;
  }

  단계(글번호, 단계번호, 문구, 제목 = "") {
    this.현재 = {글번호, 단계: 단계번호, 문구, 제목: 제목 || this.현재.제목};
    this.그리기(true);
  }

  글완료(덧말 = "") {
    this.끝난글 += 1;
    this.현재 = {...this.현재, 단계: 0, 문구: "완료 ✅"};
    this.덧말 = 덧말;
    this.그리기(true);
  }

  글건너뜀() {
    this.끝난글 += 1;
    this.현재 = {...this.현재, 단계: 0, 문구: "건너뜀 (이미 있는 글)"};
    this.그리기(true);
  }

  글실패() {
    this.끝난글 += 1;
    this.현재 = {...this.현재, 단계: 0, 문구: "실패 ✗"};
    this.그리기(true);
  }

  그리기(새줄) {
    if (this.tty) {
      if (새줄 && this.마지막줄길이 > 0) {
        // 지나간 단계는 줄로 남긴다 — 스크롤해서 뭐가 있었는지 볼 수 있게
        this.출력.write(`\r${this.줄("·")}\n`);
      }
      this.마지막줄길이 = 1;
      this.출력.write(`\r${this.줄(스피너프레임[this.프레임 % 스피너프레임.length])}[K`);
      if (!this.타이머) {
        this.타이머 = setInterval(() => {
          this.프레임 += 1;
          this.출력.write(`\r${this.줄(스피너프레임[this.프레임 % 스피너프레임.length])}[K`);
        }, 120);
        // 타이머가 프로세스 종료를 막지 않게
        if (typeof this.타이머.unref === "function") this.타이머.unref();
      }
    } else if (새줄) {
      this.출력.write(`${this.줄()}\n`);
    }
    this.파일쓰기();
  }

  파일쓰기() {
    try {
      mkdirSync(dirname(this.파일), {recursive: true});
      const 지금 = new Date();
      const 시각 = `${String(지금.getHours()).padStart(2, "0")}:${String(지금.getMinutes()).padStart(2, "0")}:${String(지금.getSeconds()).padStart(2, "0")}`;
      const 본문 = [
        "# 지금 진행 상황 (자동으로 계속 바뀝니다)",
        "",
        this.라벨 ? `${this.라벨}` : "",
        "",
        "```",
        `[${게이지(this.비율(), 30)}] ${Math.round(this.비율() * 100)}%`,
        "```",
        "",
        this.현재.글번호 > 0 ? `**${this.현재.글번호}/${this.전체}번째 글** · ${this.현재.단계 > 0 ? `${this.현재.단계}/${this.단계수}단계 ` : ""}${this.현재.문구}` : this.현재.문구,
        this.현재.제목 ? `제목: ${this.현재.제목}` : "",
        "",
        this.덧말 ? this.덧말 : "",
        "",
        `마지막 갱신 ${시각}`,
      ].filter((줄, i, arr) => !(줄 === "" && arr[i - 1] === ""));
      writeFileSync(this.파일, `${본문.join("\n")}\n`, "utf8");
    } catch {
      // 진행 파일은 덤이다. 못 써도 본 작업은 계속한다.
    }
  }

  끝(마무리문구 = "끝 ✅") {
    if (this.타이머) {
      clearInterval(this.타이머);
      this.타이머 = null;
    }
    this.현재 = {글번호: 0, 단계: 0, 문구: 마무리문구, 제목: ""};
    this.끝난글 = this.전체;
    if (this.tty) this.출력.write(`\r${this.줄("✔")}[K\n`);
    else this.출력.write(`${this.줄()}\n`);
    this.파일쓰기();
  }
}
