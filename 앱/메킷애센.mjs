// 앱/메킷애센.mjs — 3주차: 수강생이 받은 메킷애센 플러그인을 코덱스로 자기 필요에 맞게 고쳐, 자기 워드프레스에 업데이트한다.
//
// 역할 나눔
//   · 플러그인 코드를 읽고 고치는 건 코덱스다 (수강생이 자기 말로 요청). 이 파일은 그 앞뒤만 맡는다.
//   · 준비: `메킷애센 수정/` 폴더를 만들고, 수강생이 준 메킷애센 ZIP 을 작업본으로 푼다. 원본 ZIP 은 그대로 보관한다.
//   · 자료: 깃허브의 3주차 참고 자료(가독성·모바일·속도·검색·AI 답변·수정 원칙·검사) 중 필요한 것만 돌려준다.
//   · 검사: 원본과 작업본을 비교해 바뀐 파일을 알려 주고, 라이선스·광고·초기화 부분이 바뀌었거나 괄호·따옴표가 깨졌으면 막는다.
//   · ZIP: 작업본을 워드프레스에 올릴 ZIP 으로 묶는다. 폴더 이름은 원본과 같게(그래야 워드프레스가 '현재 버전 교체' 를 띄운다), 버전은 한 칸 올린다.
//   · 이 파일과 자료는 수강생 PC 에 남지 않는다 (로더가 GitHub 에서 임시 폴더로 받아 쓰고 지운다).
//     수강생 폴더에 남는 건 수강생 자기 플러그인(원본 ZIP·작업본·완성 ZIP)뿐이다.

import {copyFile, mkdir, readFile, readdir, rename, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {deflateRawSync, inflateRawSync} from "node:zlib";
import vm from "node:vm";

export const 버전 = "2026-09-28a";

const 여기 = dirname(fileURLToPath(import.meta.url));
const 자료폴더 = join(여기, "메킷애센", "자료");
const 뿌리 = (작업폴더) => join(작업폴더, "메킷애센 수정");
const 원본칸 = (작업폴더) => join(뿌리(작업폴더), "01_원본ZIP넣는곳");
const 작업칸 = (작업폴더) => join(뿌리(작업폴더), "02_작업본");
const 완성칸 = (작업폴더) => join(뿌리(작업폴더), "03_완성ZIP");
const 보여줄경로 = (작업폴더, p) => String(p).startsWith(작업폴더) ? String(p).slice(작업폴더.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") : String(p);

// ───────── ZIP 읽기·쓰기 (외부 라이브러리 없이. 워드프레스 플러그인 ZIP 정도 크기만 다룬다) ─────────
const CRC표 = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC표[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip풀기(버퍼) {
  const b = 버퍼;
  let 끝 = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { 끝 = i; break; }
  if (끝 < 0) throw new Error("ZIP 파일이 아니거나 깨졌어요");
  const 개수 = b.readUInt16LE(끝 + 10);
  let p = b.readUInt32LE(끝 + 16);
  const 항목 = [];
  for (let n = 0; n < 개수; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP 목차가 깨졌어요");
    const 표시 = b.readUInt16LE(p + 8), 방식 = b.readUInt16LE(p + 10);
    const 압축크기 = b.readUInt32LE(p + 20), 원래크기 = b.readUInt32LE(p + 24);
    const 이름길이 = b.readUInt16LE(p + 28), 추가길이 = b.readUInt16LE(p + 30), 설명길이 = b.readUInt16LE(p + 32);
    const 위치 = b.readUInt32LE(p + 42);
    const 이름 = b.toString("utf8", p + 46, p + 46 + 이름길이).replace(/\\/g, "/");
    p += 46 + 이름길이 + 추가길이 + 설명길이;
    if (이름.endsWith("/") || 이름.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(이름)) continue;
    if (표시 & 1) throw new Error("비밀번호가 걸린 ZIP 은 풀 수 없어요");
    if (이름.startsWith("/") || /^[A-Za-z]:/.test(이름) || 이름.split("/").includes("..")) throw new Error(`ZIP 안에 이상한 경로가 있어요: ${이름}`);
    const 시작 = 위치 + 30 + b.readUInt16LE(위치 + 26) + b.readUInt16LE(위치 + 28);
    const 원 = b.subarray(시작, 시작 + 압축크기);
    const 내용 = 방식 === 0 ? Buffer.from(원) : 방식 === 8 ? inflateRawSync(원) : null;
    if (!내용) throw new Error(`이 ZIP 은 풀 수 없는 압축 방식이에요 (${방식})`);
    if (내용.length !== 원래크기) throw new Error(`ZIP 안 파일 크기가 맞지 않아요: ${이름}`);
    항목.push({이름, 내용});
  }
  return 항목;
}

export function zip묶기(항목들) {
  const d = new Date();
  const 시각 = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const 날짜 = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const 조각 = [], 목차 = [];
  let 위치 = 0;
  for (const {이름, 내용} of 항목들) {
    const 이름b = Buffer.from(이름, "utf8");
    const 압축 = deflateRawSync(내용, {level: 9});
    const 방식 = 압축.length < 내용.length ? 8 : 0;
    const 데이터 = 방식 === 8 ? 압축 : 내용;
    const crc = crc32(내용);
    const 머리 = Buffer.alloc(30);
    머리.writeUInt32LE(0x04034b50, 0); 머리.writeUInt16LE(20, 4); 머리.writeUInt16LE(0x0800, 6); 머리.writeUInt16LE(방식, 8);
    머리.writeUInt16LE(시각, 10); 머리.writeUInt16LE(날짜, 12); 머리.writeUInt32LE(crc, 14);
    머리.writeUInt32LE(데이터.length, 18); 머리.writeUInt32LE(내용.length, 22); 머리.writeUInt16LE(이름b.length, 26); 머리.writeUInt16LE(0, 28);
    조각.push(머리, 이름b, 데이터);
    const 목 = Buffer.alloc(46);
    목.writeUInt32LE(0x02014b50, 0); 목.writeUInt16LE(0x0314, 4); 목.writeUInt16LE(20, 6); 목.writeUInt16LE(0x0800, 8); 목.writeUInt16LE(방식, 10);
    목.writeUInt16LE(시각, 12); 목.writeUInt16LE(날짜, 14); 목.writeUInt32LE(crc, 16); 목.writeUInt32LE(데이터.length, 20); 목.writeUInt32LE(내용.length, 24);
    목.writeUInt16LE(이름b.length, 28);
    목.writeUInt32LE(33188 * 65536, 38); // 일반 파일 (rw-r--r--)
    목.writeUInt32LE(위치, 42);
    목차.push(목, 이름b);
    위치 += 30 + 이름b.length + 데이터.length;
  }
  const 목차b = Buffer.concat(목차);
  const 끝 = Buffer.alloc(22);
  끝.writeUInt32LE(0x06054b50, 0);
  끝.writeUInt16LE(항목들.length, 8); 끝.writeUInt16LE(항목들.length, 10);
  끝.writeUInt32LE(목차b.length, 12); 끝.writeUInt32LE(위치, 16);
  return Buffer.concat([...조각, 목차b, 끝]);
}

// ───────── 작업본 파일 목록 (넣지 말 것은 뺀다) ─────────
const 빼는폴더 = (n) => /^\./.test(n) || /^(node_modules|__MACOSX)$/i.test(n);
const 빼는파일 = (n) => /^\./.test(n) || /^(Thumbs\.db|desktop\.ini)$/i.test(n) || /\.(bak|orig|rej|swp|tmp|log|zip)$/i.test(n) || /~$/.test(n);
async function 파일목록(폴더, 앞 = "") {
  const 결과 = [];
  for (const e of await readdir(폴더, {withFileTypes: true})) {
    const 상대 = 앞 ? `${앞}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!빼는폴더(e.name)) 결과.push(...(await 파일목록(join(폴더, e.name), 상대))); }
    else if (e.isFile() && !빼는파일(e.name)) 결과.push(상대);
  }
  return 결과.sort();
}
const 해시 = (buf) => createHash("sha1").update(buf).digest("hex");

// ZIP 속 플러그인: 맨 위 폴더 하나 + 그 안에 "Plugin Name:" 이 적힌 php
function 플러그인찾기(항목) {
  const 맨위 = [...new Set(항목.map((x) => x.이름.split("/")[0]))];
  if (맨위.length !== 1 || 항목.some((x) => !x.이름.includes("/"))) return null;
  const 슬러그 = 맨위[0];
  const 주 = 항목.find((x) => x.이름.split("/").length === 2 && x.이름.endsWith(".php") && /Plugin Name:/i.test(x.내용.subarray(0, 8192).toString("utf8")));
  if (!주) return null;
  return {슬러그, 주파일: 주.이름.slice(슬러그.length + 1), 이름: (주.내용.toString("utf8").match(/Plugin Name:\s*([^\r\n]+)/i) || [])[1]?.trim() || 슬러그, 버전: 버전읽기(주.내용.toString("utf8"))};
}
const 버전읽기 = (코드) => ((String(코드).match(/^[\s*#/]*Version:\s*([^\r\n]+)/im) || [])[1] || "").trim();

// 원본 ZIP — 01 칸의 ZIP 중 플러그인이 들어 있는 것 (여러 개면 가장 최근에 넣은 것)
async function 원본찾기(작업폴더) {
  const 칸 = 원본칸(작업폴더);
  if (!existsSync(칸)) return null;
  const 후보 = [];
  for (const n of await readdir(칸)) {
    if (!/\.zip$/i.test(n)) continue;
    try {
      const 버퍼 = await readFile(join(칸, n));
      const 항목 = zip풀기(버퍼);
      const 정보 = 플러그인찾기(항목);
      if (정보) 후보.push({파일: join(칸, n), 항목, ...정보});
    } catch {}
  }
  후보.sort((a, b) => (a.파일 < b.파일 ? 1 : -1));
  return 후보.find((x) => /makeit-adsense/i.test(x.슬러그)) || 후보[0] || null;
}

// ───────── 대본에서 부르는 함수 ─────────

// 준비 — 폴더를 만들고, 원본 ZIP 을 찾아(또는 받은 파일을 옮겨) 작업본으로 푼다. 작업본이 이미 있으면 건드리지 않는다.
export async function 준비({작업폴더, 원본ZIP = ""} = {}) {
  if (!작업폴더) throw new Error("작업폴더 가 필요합니다");
  for (const d of [원본칸(작업폴더), 작업칸(작업폴더), 완성칸(작업폴더)]) await mkdir(d, {recursive: true});
  if (원본ZIP) {
    const 받은 = String(원본ZIP).trim();
    if (!existsSync(받은)) return {결과: "원본 필요", 이유: "받은 ZIP 파일을 찾지 못했어요", 폴더: 보여줄경로(작업폴더, 원본칸(작업폴더))};
    try {
      const 정보 = 플러그인찾기(zip풀기(await readFile(받은)));
      if (!정보) return {결과: "원본 필요", 이유: "이 ZIP 에는 워드프레스 플러그인이 들어 있지 않아요"};
    } catch (e) {
      return {결과: "원본 필요", 이유: String(e?.message || e)};
    }
    const 목적 = join(원본칸(작업폴더), basename(받은));
    if (!existsSync(목적)) await copyFile(받은, 목적);
  }
  const 원본 = await 원본찾기(작업폴더);
  if (!원본) return {결과: "원본 필요", 폴더: 보여줄경로(작업폴더, 원본칸(작업폴더))};
  const 작업본 = join(작업칸(작업폴더), 원본.슬러그);
  let 새로풀었음 = false;
  if (!existsSync(join(작업본, 원본.주파일))) {
    for (const {이름, 내용} of 원본.항목) {
      const 경로 = join(작업칸(작업폴더), ...이름.split("/"));
      await mkdir(dirname(경로), {recursive: true});
      await writeFile(경로, 내용);
    }
    새로풀었음 = true;
  }
  const 지금버전 = 버전읽기(await readFile(join(작업본, 원본.주파일), "utf8"));
  const 비교 = await 바뀐것(작업폴더, 원본);
  return {
    결과: "준비됨", 플러그인: 원본.이름, 원본버전: 원본.버전, 작업본버전: 지금버전, 새로풀었음,
    원본ZIP: 보여줄경로(작업폴더, 원본.파일),
    작업본: 보여줄경로(작업폴더, 작업본), 주파일: `${보여줄경로(작업폴더, 작업본)}/${원본.주파일}`,
    바뀐파일수: 비교.바뀐.length + 비교.새.length + 비교.지운.length,
  };
}

// 처음부터 다시 — 지금 작업본을 옆으로 치워 두고(지우지 않는다) 원본에서 새로 푼다.
export async function 처음부터({작업폴더} = {}) {
  const 원본 = await 원본찾기(작업폴더);
  if (!원본) return {결과: "원본 필요", 폴더: 보여줄경로(작업폴더, 원본칸(작업폴더))};
  const 작업본 = join(작업칸(작업폴더), 원본.슬러그);
  if (existsSync(작업본)) {
    const 시각 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, "");
    await rename(작업본, join(뿌리(작업폴더), `02_작업본_이전_${시각}`));
  }
  return 준비({작업폴더});
}

// 참고 자료 — 필요한 것만 읽는다. 이름: 작업방법 · 가독성 · 모바일 · 속도 · 검색 · AI답변 · 수정원칙 · 검사 · 수업
const 자료표 = {
  작업방법: "work-method.md", 가독성: "readability.md", 모바일: "readability.md", 글자: "readability.md",
  속도: "performance.md", 검색: "search-review.md", SEO: "search-review.md", AI답변: "answer-readiness.md", AI: "answer-readiness.md",
  수정원칙: "wordpress-changes.md", 검사: "verification.md", 수업: "classroom.md",
};
export async function 자료({이름 = "목록"} = {}) {
  if (이름 === "목록") return {자료: Object.keys(자료표)};
  const 파일 = 자료표[String(이름).replace(/\s+/g, "")];
  if (!파일) return {결과: "없음", 자료: Object.keys(자료표)};
  return {이름, 내용: await readFile(join(자료폴더, 파일), "utf8")};
}

// 지켜야 할 부분 — 가독성·모바일·속도 실습에서 바꾸면 안 되는 함수 (메킷애센 기준. 다른 플러그인이면 이 검사는 건너뛴다)
const 지킬곳 = {
  라이선스: ["normalize_license_code", "get_required_license_code", "is_license_registered", "is_license_code_current", "sync_license_status_with_required_code", "handle_save_license", "remote_register", "maybe_send_daily_heartbeat", "send_heartbeat"],
  광고: ["get_default_ads_txt_content", "has_custom_google_ads_txt_line", "get_ads_txt_path", "maybe_create_default_ads_txt_file", "write_ads_txt_file", "normalize_ads_txt_content", "get_default_header_code_sample", "normalize_header_code", "extract_adsense_client_id", "get_allowed_adsense_header_code", "get_ads_txt_content", "get_ads_txt_status", "handle_save_ads_txt", "get_header_code", "is_header_code_ready", "handle_save_header_code", "output_header_code"],
  초기화: ["reset_wizard_settings", "reset_wordpress_content", "delete_posts_by_type", "delete_all_comments", "delete_all_nav_menus", "delete_terms_by_taxonomy", "reset_plugin_pages", "reset_plugin_menu"],
};
function 함수본문(코드, 이름) {
  const 줄 = String(코드).split(/\r?\n/);
  const 머리 = new RegExp(`^\\s*(?:(?:public|private|protected|static|final|abstract)\\s+)*function\\s+${이름}\\s*\\(`);
  const 시작 = 줄.findIndex((l) => 머리.test(l));
  if (시작 < 0) return null;
  let 끝 = 줄.length;
  for (let i = 시작 + 1; i < 줄.length; i++) {
    if (/^\s{0,4}(?:(?:public|private|protected|static|final|abstract)\s+)+function\s+\w+\s*\(/.test(줄[i]) || /^}\s*$/.test(줄[i])) { 끝 = i; break; }
  }
  return 줄.slice(시작, 끝).map((l) => l.trimEnd()).join("\n").trim();
}

// PHP 괄호·따옴표·주석 짝 검사 — PHP 가 없는 컴퓨터에서도 흔한 실수(괄호·따옴표 빠짐)는 잡는다. 완전한 문법 검사는 아니다.
export function php짝검사(코드) {
  const s = String(코드);
  const 짝 = {")": "(", "]": "[", "}": "{"};
  const 쌓임 = [];
  let i = 0, 줄 = 1, php = false;
  const 줄세기 = (a, b) => { for (let k = a; k < b; k++) if (s.charCodeAt(k) === 10) 줄++; };
  while (i < s.length) {
    if (!php) {
      const j = s.indexOf("<?", i);
      if (j < 0) break;
      줄세기(i, j);
      i = j + (s.startsWith("<?php", j) ? 5 : s.startsWith("<?=", j) ? 3 : 2);
      php = true;
      continue;
    }
    const c = s[i];
    if (c === "\n") { 줄++; i++; continue; }
    if (c === "?" && s[i + 1] === ">") { php = false; i += 2; continue; }
    if ((c === "/" && s[i + 1] === "/") || (c === "#" && s[i + 1] !== "[")) {
      while (i < s.length && s[i] !== "\n" && !(s[i] === "?" && s[i + 1] === ">")) i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const j = s.indexOf("*/", i + 2);
      if (j < 0) return {됨: false, 이유: `${줄}번째 줄의 /* 주석이 안 닫혔어요`};
      줄세기(i, j); i = j + 2; continue;
    }
    if (c === "<" && s.startsWith("<<<", i)) {
      const m = /^<<<[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(s.slice(i, i + 200));
      if (m) {
        const 시작줄 = 줄;
        const 끝표 = new RegExp(`\\n[ \\t]*${m[2]}\\b`, "g");
        끝표.lastIndex = i + m[0].length - 1;
        const 끝 = 끝표.exec(s);
        if (!끝) return {됨: false, 이유: `${시작줄}번째 줄의 <<<${m[2]} 글 묶음이 안 닫혔어요`};
        줄세기(i, 끝.index + 끝[0].length); i = 끝.index + 끝[0].length; continue;
      }
    }
    if (c === "'" || c === '"' || c === "`") {
      const 시작줄 = 줄;
      i++;
      while (i < s.length && s[i] !== c) { if (s[i] === "\\") i++; else if (s[i] === "\n") 줄++; i++; }
      if (i >= s.length) return {됨: false, 이유: `${시작줄}번째 줄의 따옴표(${c})가 안 닫혔어요`};
      i++; continue;
    }
    if (c === "(" || c === "[" || c === "{") 쌓임.push({c, 줄});
    else if (c === ")" || c === "]" || c === "}") {
      const 위 = 쌓임.pop();
      if (!위 || 위.c !== 짝[c]) return {됨: false, 이유: `${줄}번째 줄의 괄호 ${c} 짝이 안 맞아요`};
    }
    i++;
  }
  if (쌓임.length) return {됨: false, 이유: `${쌓임[쌓임.length - 1].줄}번째 줄의 괄호 ${쌓임[쌓임.length - 1].c} 가 안 닫혔어요`};
  return {됨: true};
}

async function 바뀐것(작업폴더, 원본) {
  const 작업본 = join(작업칸(작업폴더), 원본.슬러그);
  const 원표 = new Map(원본.항목.map((x) => [x.이름.slice(원본.슬러그.length + 1), x.내용]));
  const 지금 = existsSync(작업본) ? await 파일목록(작업본) : [];
  const 바뀐 = [], 새 = [];
  for (const f of 지금) {
    const 내용 = await readFile(join(작업본, ...f.split("/")));
    if (!원표.has(f)) 새.push(f);
    else if (해시(내용) !== 해시(원표.get(f))) 바뀐.push(f);
  }
  const 있음 = new Set(지금);
  const 지운 = [...원표.keys()].filter((f) => !있음.has(f) && !빼는파일(basename(f)));
  return {작업본, 원표, 바뀐, 새, 지운};
}

// 검사 — 원본과 비교. 지킬 곳이 바뀌었거나 PHP·JS 가 깨졌으면 '막힘' 을 돌려준다.
export async function 검사({작업폴더} = {}) {
  const 원본 = await 원본찾기(작업폴더);
  if (!원본) return {결과: "원본 필요", 폴더: 보여줄경로(작업폴더, 원본칸(작업폴더))};
  const {작업본, 원표, 바뀐, 새, 지운} = await 바뀐것(작업폴더, 원본);
  if (!existsSync(join(작업본, 원본.주파일))) return {결과: "작업본 없음", 이유: "작업본에 플러그인 주 파일이 없어요. 준비를 다시 해 주세요."};
  const 막힘 = [], 알림 = [];
  // 1) 지킬 곳 (주 파일만 본다)
  const 원코드 = 원표.get(원본.주파일)?.toString("utf8") || "";
  const 지금코드 = await readFile(join(작업본, 원본.주파일), "utf8");
  const 지킬곳바뀜 = [];
  for (const [종류, 함수들] of Object.entries(지킬곳)) {
    for (const 이름 of 함수들) {
      const 전 = 함수본문(원코드, 이름);
      if (전 === null) continue; // 이 플러그인에는 없는 함수
      if (함수본문(지금코드, 이름) !== 전) 지킬곳바뀜.push(`${종류}: ${이름}`);
    }
  }
  if (지킬곳바뀜.length) 막힘.push(`라이선스·광고·초기화 부분이 바뀌었어요 (${지킬곳바뀜.slice(0, 5).join(", ")}${지킬곳바뀜.length > 5 ? " 외" : ""}). 이 부분은 원본대로 되돌려야 해요.`);
  // 2) PHP 짝 검사 (원본이 통과하는 검사만 믿는다)
  const 검사한PHP = [];
  for (const f of [...바뀐, ...새].filter((x) => /\.php$/i.test(x))) {
    const 지금 = php짝검사(await readFile(join(작업본, ...f.split("/")), "utf8"));
    const 원 = 원표.has(f) ? php짝검사(원표.get(f).toString("utf8")) : {됨: true};
    if (!원.됨) { 알림.push(`${f}: 원본도 이 검사를 통과하지 못해 괄호 검사는 건너뛰었어요`); continue; }
    검사한PHP.push(f);
    if (!지금.됨) 막힘.push(`${f}: ${지금.이유}`);
  }
  // 3) JS 문법 (실행하지 않고 읽기만)
  for (const f of [...바뀐, ...새].filter((x) => /\.js$/i.test(x) && !/\.min\.js$/i.test(x))) {
    try { new vm.Script(await readFile(join(작업본, ...f.split("/")), "utf8"), {filename: f}); }
    catch (e) { 막힘.push(`${f}: 자바스크립트 문법 오류 — ${String(e?.message || e).slice(0, 80)}`); }
  }
  // 4) 주 파일 머리말
  if (!/Plugin Name:/i.test(지금코드.slice(0, 8192))) 막힘.push(`${원본.주파일}: 맨 위 'Plugin Name:' 머리말이 없어졌어요`);
  if (지운.length) 알림.push(`원본에 있던 파일 ${지운.length}개가 작업본에 없어요: ${지운.slice(0, 3).join(", ")}${지운.length > 3 ? " 외" : ""}`);
  return {
    결과: 막힘.length ? "막힘" : 바뀐.length + 새.length + 지운.length ? "통과" : "바뀐 것 없음",
    바뀐파일: 바뀐, 새파일: 새, 지운파일: 지운, 막힘, 알림,
    PHP괄호검사: 검사한PHP.length ? `${검사한PHP.length}개 통과` : "바뀐 PHP 없음",
    못한검사: "워드프레스에서 실제로 켜 보는 검사는 올린 뒤 화면으로 확인해요",
    작업본버전: 버전읽기(지금코드), 원본버전: 원본.버전,
  };
}

// 버전 한 칸 올리기 — 원본 1.2.4 → 1.2.4.1 → 1.2.4.2 … (머리말 Version 과 같은 값의 define 상수를 함께 바꾼다)
function 다음버전(원본버전, 지금버전, 완성목록) {
  const 기준 = String(원본버전 || "1.0.0");
  const 번호들 = [지금버전, ...완성목록].map((v) => String(v || "")).filter((v) => v.startsWith(기준 + ".")).map((v) => Number(v.slice(기준.length + 1).split(/[^0-9]/)[0]) || 0);
  return `${기준}.${Math.max(0, ...번호들) + 1}`;
}
function 버전바꾸기(코드, 옛, 새) {
  let s = String(코드).replace(/^([\s*#/]*Version:\s*)([^\r\n]+)/im, (_, a) => a + 새);
  const 옛식 = String(옛).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  s = s.replace(new RegExp(`(define\\(\\s*['"][A-Z0-9_]*VERSION['"]\\s*,\\s*['"])${옛식}(['"])`), `$1${새}$2`);
  return s;
}

// ZIP 만들기 — 검사를 통과한 작업본만. 워드프레스 → 플러그인 → 새 플러그인 추가 → 업로드 → '현재 버전 교체' 로 올린다.
export async function ZIP만들기({작업폴더} = {}) {
  const 원본 = await 원본찾기(작업폴더);
  if (!원본) return {결과: "원본 필요", 폴더: 보여줄경로(작업폴더, 원본칸(작업폴더))};
  const 판정 = await 검사({작업폴더});
  if (판정.결과 === "막힘") return {결과: "막힘", 막힘: 판정.막힘, 할일: "막힌 곳을 고친 뒤 다시 ZIP 을 만들어요. 라이선스·광고·초기화 부분은 원본대로 되돌려요."};
  if (판정.결과 === "바뀐 것 없음") return {결과: "바뀐 것 없음", 할일: "아직 고친 곳이 없어요. 무엇을 바꿀지 말씀해 주세요."};
  if (판정.결과 !== "통과") return 판정;
  const 작업본 = join(작업칸(작업폴더), 원본.슬러그);
  const 주경로 = join(작업본, 원본.주파일);
  await mkdir(완성칸(작업폴더), {recursive: true});
  const 완성목록 = (await readdir(완성칸(작업폴더))).map((n) => (n.match(new RegExp(`^${원본.슬러그}-(.+)\\.zip$`)) || [])[1]).filter(Boolean);
  const 지금버전 = 버전읽기(await readFile(주경로, "utf8"));
  const 새버전 = 다음버전(원본.버전, 지금버전, 완성목록);
  await writeFile(주경로, 버전바꾸기(await readFile(주경로, "utf8"), 지금버전, 새버전), "utf8");
  const 파일들 = await 파일목록(작업본);
  const 항목들 = [];
  for (const f of 파일들) 항목들.push({이름: `${원본.슬러그}/${f}`, 내용: await readFile(join(작업본, ...f.split("/")))});
  const 버퍼 = zip묶기(항목들);
  // 다시 풀어 보며 확인 (파일 수·내용이 같아야 한다)
  const 되읽음 = zip풀기(버퍼);
  if (되읽음.length !== 항목들.length || 되읽음.some((x, k) => 해시(x.내용) !== 해시(항목들[k].내용))) throw new Error("만든 ZIP 을 다시 풀어 보니 내용이 달라요");
  let 경로 = join(완성칸(작업폴더), `${원본.슬러그}-${새버전}.zip`);
  for (let n = 2; existsSync(경로); n++) 경로 = join(완성칸(작업폴더), `${원본.슬러그}-${새버전}-${n}.zip`);
  await writeFile(경로, 버퍼);
  return {
    결과: "됨", ZIP: 보여줄경로(작업폴더, 경로), 버전: 새버전, 원본버전: 원본.버전,
    바뀐파일: 판정.바뀐파일, 새파일: 판정.새파일, 파일수: 항목들.length, 알림: 판정.알림,
    원본ZIP: 보여줄경로(작업폴더, 원본.파일),
    올리는법: "워드프레스 관리자 → 플러그인 → 새 플러그인 추가 → 플러그인 업로드 → 이 ZIP 선택 → 지금 설치 → '현재 버전을 업로드한 버전으로 교체' → 사이트에서 확인",
    되돌리는법: "원본 ZIP 을 같은 방법(업로드 → 교체)으로 올리면 원래대로 돌아가요. 관리자 화면이 안 열리면 호스팅 파일 관리자에서 wp-content/plugins 안의 이 플러그인 폴더 이름을 바꾸면 플러그인이 꺼져요.",
    참고: "버전이 올라가서, 올린 뒤 관리자 화면을 처음 열 때 메킷애센이 홈·메뉴·카테고리를 한 번 다시 맞춰요 (정식 업데이트 때와 같아요).",
  };
}
