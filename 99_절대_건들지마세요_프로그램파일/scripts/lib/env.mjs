// 공용 환경설정 로더 (Codespaces 전환, PRD D8·D9·5-5)
// - process.env 값을 최우선으로 하고, .env.local 파일은 보조(fallback)로 읽는다.
//   (Codespaces user secrets를 쓰는 수강생도 무수정으로 동작하게 하기 위함)
// - 라이센스 게이트: 파일 마커(runtime/.license_ok)는 완전 폐지 —
//   MAKEIT_MIDDLE_LICENSE 환경변수 검증으로 통일한다.
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

// scripts/lib/ 기준 두 단계 위 = 프로그램 루트(99_절대_건들지마세요_프로그램파일)
export const PROGRAM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PROJECT_ROOT = path.dirname(PROGRAM_ROOT);
export const ENV_LOCAL_PATH = path.join(PROGRAM_ROOT, ".env.local");
export const ENV_EXAMPLE_PATH = path.join(PROGRAM_ROOT, ".env.example");

// 유효한 수강 코드 목록 (기수별 공용 1개 — 기수 종료 시 로테이션, PRD 5-4)
// 코드 교체 시: 이 목록을 갱신해 템플릿 저장소에 커밋 → 수강생은 `업데이트` + `키설정` 재실행
// [주의] 편집기 서버(video-workspace/remotion-ui/scripts/editor-server.mjs)는 이 목록을 import하지만,
//        편집기 UI(video-workspace/remotion-ui/editor/src/main.tsx의 LICENSE_CODE)는 하드코딩이다.
//        코드 로테이션 시 main.tsx도 반드시 함께 교체할 것 — 누락되면 키설정은 통과하는데 편집기가 거부된다.
export const VALID_LICENSE_CODES = ["weolbumakeitmiddle1"];

// .env 형식 텍스트를 {키: 값} 객체로 해석한다. (따옴표는 벗겨서 저장)
export function parseEnvText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .reduce((acc, line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      acc[key] = value;
      return acc;
    }, {});
}

export function readEnvFile(filePath = ENV_LOCAL_PATH) {
  if (!existsSync(filePath)) return {};
  return parseEnvText(readFileSync(filePath, "utf8"));
}

// .env.local 파일 값 위에 process.env 값을 덮어쓴 병합 결과를 돌려준다.
// (process.env 우선 — Codespaces secrets, 셸 export 모두 이 경로로 흡수)
export function loadEnv() {
  const merged = readEnvFile();
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && String(value).trim() !== "") merged[key] = value;
  }
  return merged;
}

// .env.local 파일이 있는지 여부 (안내 문구 분기용)
export function hasEnvLocal() {
  return existsSync(ENV_LOCAL_PATH);
}

// 예시값/빈 값 판정 — 값이 실제로 입력된 상태인지 확인한다.
export function valueReady(value, placeholderTokens = []) {
  const text = String(value || "").trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  if (/^(your-|example|xxxx|sk-your|https:\/\/example)/i.test(lowered)) return false;
  return !placeholderTokens.some((token) => lowered.includes(String(token).toLowerCase()));
}

// "키설정 먼저 실행" 공통 안내문
export function keysGuideMessage(missingLabel = "필요한 설정값") {
  return [
    `${missingLabel}이(가) 아직 없습니다.`,
    "터미널에 아래 한 단어를 먼저 입력해주세요.",
    "",
    "  키설정   (수강 코드와 API 키를 안내에 따라 입력 — npm run keys 와 같은 명령)",
    "",
  ].join("\n");
}

// 민감값 마스킹 — 화면 출력용 (예: "sk-****WXYZ")
export function maskValue(value) {
  const text = String(value || "").trim();
  if (!text) return "(비어 있음)";
  if (text.length <= 8) return "****";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

// 라이센스 상태 확인 — {ok, reason: "missing" | "invalid", code}
export function licenseState(env = loadEnv()) {
  const code = String(env.MAKEIT_MIDDLE_LICENSE || "").trim();
  if (!code) return {ok: false, reason: "missing", code: ""};
  if (!VALID_LICENSE_CODES.includes(code)) return {ok: false, reason: "invalid", code};
  return {ok: true, reason: "", code};
}

// 진입 스크립트용 라이센스 게이트.
// 통과하면 병합된 env를 돌려주고, 실패하면 친절한 안내 후 종료한다.
export function requireLicense({scriptLabel = "이 작업"} = {}) {
  const env = loadEnv();
  const state = licenseState(env);
  if (state.ok) return env;

  console.error("");
  console.error("==========================================");
  if (state.reason === "missing") {
    console.error(`${scriptLabel}을(를) 실행하려면 수강 코드가 필요합니다.`);
    console.error("");
    console.error(keysGuideMessage("수강 코드"));
    console.error("수강 코드는 강의 자료실 공지에서 확인할 수 있어요.");
  } else {
    console.error("입력된 수강 코드가 올바르지 않습니다.");
    console.error("강의 자료실 공지의 수강 코드를 다시 확인한 뒤,");
    console.error("터미널에 '키설정' 을 입력해 다시 넣어주세요.");
  }
  console.error("==========================================");
  process.exit(1);
}
