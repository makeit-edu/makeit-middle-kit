import {spawn} from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {ensureNodeModules, projectRootFromScript, resolveJobPaths, DEFAULT_JOB_ID, windowsLocalPath} from "./job-config.mjs";
// 수강 코드 단일 진실 원천 — scripts/lib/env.mjs의 목록을 그대로 사용한다 (하드코딩 이중화 금지)
import {VALID_LICENSE_CODES} from "../../../scripts/lib/env.mjs";

const projectRoot = projectRootFromScript(import.meta.url);
ensureNodeModules(projectRoot);

const port = Number(process.env.EDITOR_PORT || 4321);
let jobPaths = resolveJobPaths(projectRoot);
let defaultPropsPath = jobPaths.defaultPropsPath;
let timelineDir = jobPaths.timelineDir;
let timelinePath = path.join(timelineDir, "timeline.json");
let renderJobsDir = path.join(timelineDir, "render-jobs");
// [항목 11] "영상을 처음 만든 직후" 상태 스냅샷 — 원본 복구가 자막·음성·이미지를 살린 채 되돌아갈 기준점
let initialSnapshotPath = path.join(timelineDir, "timeline.initial.json");
const templatesDir = path.join(projectRoot, "editor-data", "templates");
const templatesPath = path.join(templatesDir, "templates.json");
let renderDir = jobPaths.renderDir;

// 작업(job) 전환 시 위 경로들을 현재 current-job 기준으로 다시 계산한다
function reloadJobPaths() {
  jobPaths = resolveJobPaths(projectRoot);
  defaultPropsPath = jobPaths.defaultPropsPath;
  timelineDir = jobPaths.timelineDir;
  timelinePath = path.join(timelineDir, "timeline.json");
  renderJobsDir = path.join(timelineDir, "render-jobs");
  initialSnapshotPath = path.join(timelineDir, "timeline.initial.json");
  renderDir = jobPaths.renderDir;
}

// [항목 11] 이 편집기 서버(자식 렌더 포함)가 timeline.json에 마지막으로 쓴 시각(jobId별).
// 이 값보다 디스크 파일이 더 새로우면 "터미널 영상만들기가 다시 쓴 것"으로 판단할 수 있다.
const editorWriteTimes = new Map();

function rememberEditorWrite() {
  try {
    editorWriteTimes.set(jobPaths.jobId, statSync(timelinePath).mtimeMs);
  } catch {
    // 기록 실패는 치명적이지 않다 — 다음 쓰기 때 다시 기록된다.
  }
}

// [항목 11] 편집기가 timeline.json을 바꾸기 "직전"에 호출한다.
// 스냅샷(timeline.initial.json)의 정본은 make-video.mjs가 2회 렌더 성공 직후 직접 저장하는 파일이고,
// 여기는 보조 안전망이다: "이 서버가 이전에 timeline.json을 쓴 기록이 있고(lastEditorWriteMs 존재),
// 그 후 외부(터미널 영상만들기)가 다시 쓴 게 확실"할 때만 스냅샷을 만들거나 갱신한다.
// lastEditorWriteMs가 없는 첫 저장(서버 첫 기동/재시작 직후)은 판단 근거가 없어 캡처하지 않는다 —
// 업데이트 이전부터 편집하던 기존 작업의 '편집 중간 상태'를 처음 직후로 오캡처하는 사고 방지.
function maybeCaptureInitialSnapshot() {
  try {
    if (!existsSync(timelinePath)) return;
    mkdirSync(timelineDir, {recursive: true});
    const diskMtimeMs = statSync(timelinePath).mtimeMs;
    const lastEditorWriteMs = editorWriteTimes.get(jobPaths.jobId);
    // 외부(터미널)가 이 서버의 마지막 쓰기 이후 timeline.json을 다시 썼다고 '확실'할 때만 (1ms 오차 허용)
    if (lastEditorWriteMs !== undefined && diskMtimeMs > lastEditorWriteMs + 1) {
      copyFileSync(timelinePath, initialSnapshotPath);
    }
  } catch {
    // 스냅샷 실패가 편집 저장을 막아서는 안 된다.
  }
}

// jobs 폴더의 작업 목록 (상품번호·이름·완성영상 유무)
function listJobs() {
  const jobsRoot = path.join(projectRoot, "jobs");
  if (!existsSync(jobsRoot)) return [];
  return readdirSync(jobsRoot)
    .filter((d) => {
      if (d === DEFAULT_JOB_ID) return false; // 샘플(설정 틀)은 수강생 작업 목록에서 숨김
      try { return statSync(path.join(jobsRoot, d)).isDirectory(); } catch { return false; }
    })
    .map((jobId) => {
      const pp = path.join(jobsRoot, jobId, "render", "shopping_shorts_props.json");
      let productName = jobId, productNo = "";
      if (existsSync(pp)) {
        try { const p = JSON.parse(readFileSync(pp, "utf8")); productName = p.productName || jobId; productNo = String(p.productNo || ""); } catch {}
      }
      const outDir = path.join(jobsRoot, jobId, "render", "editor_outputs");
      let hasOutput = false;
      try { hasOutput = existsSync(outDir) && readdirSync(outDir).some((f) => f.endsWith(".mp4")); } catch {}
      return {jobId, productName, productNo, hasOutput};
    })
    .sort((a, b) => a.jobId.localeCompare(b.jobId));
}
const voicePresetsPath = path.join(projectRoot, "config", "voice_presets.json");

async function buildEditorBundle() {
  mkdirSync(path.join(projectRoot, "editor", ".dist"), {recursive: true});
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [path.join(projectRoot, "editor", "src", "main.tsx")],
    bundle: true,
    format: "esm",
    jsx: "automatic",
    sourcemap: true,
    outfile: path.join(projectRoot, "editor", ".dist", "app.js"),
    define: {"process.env.NODE_ENV": '"development"'},
    absWorkingDir: projectRoot,
  });
}


// 브라우저 자동 열기는 --open 을 붙였을 때만 시도한다 (Codespaces에서는 열 브라우저가 없음).
// Linux(xdg-open) 경로는 제거 — Codespaces에서는 VS Code 포트 포워딩/미리보기로 연다.
function openBrowserUrl(url) {
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], {stdio: "ignore", detached: true}).unref();
      return;
    }
    if (process.platform === "win32") {
      spawn("cmd", ["/d", "/s", "/c", "start", "", url], {stdio: "ignore", detached: true}).unref();
      return;
    }
    console.log(`이 환경에서는 브라우저를 자동으로 열 수 없어요. 주소창에 ${url} 을 입력해주세요.`);
  } catch {
    console.log(`브라우저 자동 열기에 실패했습니다. 주소창에 ${url} 을 입력해주세요.`);
  }
}

// 편집기 접속 안내 — Codespaces에서는 포워딩 주소를, 로컬에서는 localhost 주소를 알려준다
function printOpenGuide(url) {
  console.log("VS Code 하단 '포트' 탭 또는 자동으로 뜨는 미리보기에서 열어주세요.");
  if (process.env.CODESPACE_NAME) {
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
    console.log(`브라우저 새 탭에서 열려면: https://${process.env.CODESPACE_NAME}-${port}.${domain}`);
  } else {
    console.log(`브라우저 주소창에 직접 입력해도 됩니다: ${url}`);
  }
}

// 작업이 하나도 없는 초기 상태(jobs/ 폴더 부재)에서도 편집기가 크래시 없이 켜지도록
// new-job.mjs의 createFallbackProps와 동일한 기본 props를 만들어 기동을 계속한다.
function createFallbackProps(jobId) {
  return {
    videoSrc: `jobs/${jobId}/source.mp4`,
    productName: "샘플 상품",
    productNo: "000",
    durationSec: 24,
    sourceDurationSec: 24,
    sourceClips: [],
    hook: "",
    captions: [],
    imageOverlays: [],
    adBadge: {text: "광고", position: "top-right"},
    cta: "프로필 링크에서 000번 확인",
    backgroundMusic: {
      volume: 0.055,
      title: "",
      src: "bgm/mixkit-beautiful-dream-493.mp3",
      fadeInSec: 1,
      fadeOutSec: 1,
    },
    thumbnailTail: {durationSec: 0.6, text: "제품번호 000"},
  };
}

function ensureTimeline() {
  mkdirSync(timelineDir, {recursive: true});
  if (!existsSync(defaultPropsPath)) {
    // 첫 상품 작업(새상품) 전에 편집기를 열어도 기동은 계속돼야 한다 (AGENTS.md "편집기 열어줘" 흐름)
    console.log(`[안내] 아직 상품 작업이 없어 기본 화면으로 시작합니다. (터미널에 '새상품 1' 을 입력하면 작업이 만들어져요)`);
    mkdirSync(path.dirname(defaultPropsPath), {recursive: true});
    writeFileSync(defaultPropsPath, JSON.stringify(createFallbackProps(jobPaths.jobId), null, 2), "utf8");
  }
  if (!existsSync(timelinePath)) {
    copyFileSync(defaultPropsPath, timelinePath);
    // 빈 틀을 만든 것은 편집기 자신 — 이후 터미널 영상만들기가 다시 쓰면 스냅샷 후보로 감지된다 (항목 11)
    rememberEditorWrite();
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {"Content-Type": "text/plain; charset=utf-8"});
  response.end(message);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function sendFile(request, response, filePath) {
  if (!existsSync(filePath)) {
    sendText(response, 404, "파일을 찾을 수 없습니다.");
    return;
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    sendText(response, 404, "파일을 찾을 수 없습니다.");
    return;
  }

  const fileSize = stat.size;
  const headers = {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
  };
  const rangeHeader = request.headers.range;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      response.writeHead(416, {
        ...headers,
        "Content-Range": `bytes */${fileSize}`,
      });
      response.end();
      return;
    }

    const requestedStart = match[1] ? Number(match[1]) : 0;
    const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
    const start = Math.max(0, requestedStart);
    const end = Math.min(requestedEnd, fileSize - 1);

    if (start > end || start >= fileSize) {
      response.writeHead(416, {
        ...headers,
        "Content-Range": `bytes */${fileSize}`,
      });
      response.end();
      return;
    }

    response.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Content-Length": end - start + 1,
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath, {start, end}).pipe(response);
    return;
  }

  response.writeHead(200, {
    ...headers,
    "Content-Length": fileSize,
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function hasValidLicense(request) {
  return VALID_LICENSE_CODES.includes(String(request.headers["x-makeit-license"] || ""));
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.resolve(root, decoded.replace(/^\/+/, ""));
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error("허용되지 않은 경로입니다.");
  }
  return resolved;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeTimeline(timeline) {
  const normalized = {
    ...timeline,
    durationSec: Number(timeline.durationSec || 24),
    sourceDurationSec: Number(timeline.sourceDurationSec || timeline.durationSec || 24),
    fps: Number(timeline.fps || 30),
    captions: Array.isArray(timeline.captions) ? timeline.captions : [],
    imageOverlays: Array.isArray(timeline.imageOverlays) ? timeline.imageOverlays : [],
  };
  normalized.captions = normalized.captions.map((caption) => ({
    ...caption,
    startSec: Number(caption.startSec || 0),
    endSec: Number(caption.endSec || 0),
    text: String(caption.text || ""),
    variant: caption.variant === "cta" ? "cta" : "caption",
  }));
  normalized.imageOverlays = normalized.imageOverlays.map((overlay) => ({
    ...overlay,
    startSec: Number(overlay.startSec || 0),
    endSec: Number(overlay.endSec || 0),
    fit: overlay.fit === "contain" ? "contain" : "cover",
  }));
  return normalized;
}

function listOutputs() {
  if (!existsSync(renderDir)) return [];
  return readdirSync(renderDir)
    .filter((file) => file.endsWith(".mp4"))
    .map((file) => {
      const filePath = path.join(renderDir, file);
      const stat = statSync(filePath);
      return {
        file,
        url: `/outputs/${encodeURIComponent(file)}`,
        sizeMb: stat.size / 1024 / 1024,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function renderJobPath(jobId) {
  return path.join(renderJobsDir, `${jobId}.json`);
}

function writeRenderJob(jobId, payload) {
  mkdirSync(renderJobsDir, {recursive: true});
  const previousPath = renderJobPath(jobId);
  const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, "utf8")) : {};
  const next = {
    ...previous,
    ...payload,
    jobId,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(previousPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function readRenderJob(jobId) {
  const filePath = renderJobPath(jobId);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function createRenderJobId() {
  return `render_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 8)}`;
}

function readTemplates() {
  mkdirSync(templatesDir, {recursive: true});
  if (!existsSync(templatesPath)) {
    const empty = {version: 1, templates: []};
    writeFileSync(templatesPath, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  const data = JSON.parse(readFileSync(templatesPath, "utf8"));
  return {
    version: Number(data.version || 1),
    templates: Array.isArray(data.templates) ? data.templates : [],
  };
}

function writeTemplates(data) {
  mkdirSync(templatesDir, {recursive: true});
  const payload = {
    version: 1,
    templates: Array.isArray(data.templates) ? data.templates : [],
  };
  writeFileSync(templatesPath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function templateDataFromTimeline(timeline) {
  return {
    captionStyle: timeline.captionStyle || {presetId: "black-box"},
    visualFilter: timeline.visualFilter || "basic",
    audioPresetId: timeline.audio?.presetId || "lively-reaction",
    backgroundMusic: {
      volume: timeline.backgroundMusic?.volume ?? 0.055,
      title: timeline.backgroundMusic?.title || "",
      fadeInSec: timeline.backgroundMusic?.fadeInSec || 0,
      fadeOutSec: timeline.backgroundMusic?.fadeOutSec || 0,
    },
    thumbnailTail: {
      headline: timeline.thumbnailTail?.headline || timeline.thumbnailTail?.text || "",
      subheadline: timeline.thumbnailTail?.subheadline || "",
      hideCta: Boolean(timeline.thumbnailTail?.hideCta),
      hideProductLabel: Boolean(timeline.thumbnailTail?.hideProductLabel),
    },
  };
}

function applyTemplateData(timeline, data) {
  return normalizeTimeline({
    ...timeline,
    captionStyle: data.captionStyle || timeline.captionStyle,
    visualFilter: data.visualFilter || timeline.visualFilter,
    audio: {
      ...(timeline.audio || {}),
      ...(data.audioPresetId ? {presetId: data.audioPresetId} : {}),
    },
    backgroundMusic: {
      ...(timeline.backgroundMusic || {}),
      ...(data.backgroundMusic || {}),
    },
    thumbnailTail: {
      ...(timeline.thumbnailTail || {}),
      ...(data.thumbnailTail || {}),
    },
  });
}

function nextTemplateName(templates, productName) {
  const base = `${productName || "쇼츠"} 템플릿`;
  let index = 1;
  const names = new Set(templates.map((template) => template.name));
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

// [항목 9] --json 모드 stdout에 안내 로그(예: "[완성영상] 저장 완료: …")가 섞여도
// 마지막에 출력된 JSON 리포트를 찾아낸다. (성공한 렌더가 "해석 실패"로 뜨던 버그의 1차 안전망)
function extractJsonReport(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // 로그가 섞인 경우 — 아래에서 JSON 시작점을 찾아 다시 시도한다.
  }
  let index = text.indexOf("{");
  while (index !== -1) {
    try {
      const parsed = JSON.parse(text.slice(index).trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // 이 위치는 JSON 시작점이 아니었다 — 다음 "{" 후보에서 재시도.
    }
    index = text.indexOf("{", index + 1);
  }
  return null;
}

function runRender({progressFile, quality} = {}) {
  const startedAtMs = Date.now();
  // 렌더 스크립트가 완료 시 남기는 결과 기록 — 2차 안전망으로 사용 (render-editor-timeline.mjs가 매 렌더마다 저장)
  const lastRenderPath = path.join(timelineDir, "last-render.json");
  return new Promise((resolve, reject) => {
    const args = [windowsLocalPath(path.join(projectRoot, "scripts", "render-editor-timeline.mjs")), "--json"];
    if (progressFile) args.push("--progress-file", progressFile);
    if (quality) args.push("--quality", quality);
    const child = spawn(process.execPath, args, {
      cwd: windowsLocalPath(projectRoot),
      env: {...process.env},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      // 렌더 자식 프로세스가 timeline.json을 갱신했을 수 있다(음성 재생성 기록 등) — 편집기발 쓰기로 기록 (항목 11)
      rememberEditorWrite();
      if (code !== 0) {
        reject(new Error(stderr || `렌더링 프로세스 실패: ${code}`));
        return;
      }
      // [항목 9] 1차: stdout에서 JSON 리포트 추출 (로그가 섞여 있어도 성공 처리)
      const report = extractJsonReport(stdout);
      if (report) {
        resolve(report);
        return;
      }
      // [항목 9] 2차: 정상 종료(exit 0)인데 리포트 해석 실패 → 렌더 스크립트가 남긴 last-render.json 사용.
      // generatedAt이 이번 렌더 시작 이후인지 확인해 옛 기록 오채택을 막는다.
      try {
        const saved = JSON.parse(readFileSync(lastRenderPath, "utf8"));
        const generatedAtMs = Date.parse(saved && saved.generatedAt ? saved.generatedAt : "");
        if (Number.isFinite(generatedAtMs) && generatedAtMs >= startedAtMs - 10_000) {
          resolve(saved);
          return;
        }
      } catch {
        // last-render.json이 없거나 깨져 있으면 아래 안내로 넘어간다.
      }
      // 여기까지 오면 결과 확인이 정말 불가능한 경우 — 초보 눈높이 안내 (영상 자체는 만들어졌을 가능성이 높다)
      reject(
        new Error(
          "영상은 만들어졌을 가능성이 높지만, 결과 화면 표시에 실패했습니다. '완성 영상 보기'를 눌러 방금 만든 영상이 있는지 확인해주세요.",
        ),
      );
    });
  });
}

ensureTimeline();
await buildEditorBundle();
mkdirSync(renderDir, {recursive: true});
mkdirSync(renderJobsDir, {recursive: true});
mkdirSync(templatesDir, {recursive: true});

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      sendFile(request, response, path.join(projectRoot, "editor", "index.html"));
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/editor/app.js") {
      sendFile(request, response, path.join(projectRoot, "editor", ".dist", "app.js"));
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/editor/styles.css") {
      sendFile(request, response, path.join(projectRoot, "editor", "styles.css"));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {ok: true, port});
      return;
    }

    if (url.pathname.startsWith("/api/") && !hasValidLicense(request)) {
      sendJson(response, 403, {error: "라이센스 확인 후 이용할 수 있습니다."});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      sendJson(response, 200, {jobs: listJobs(), current: jobPaths.jobId});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/switch-job") {
      const body = await readBody(request);
      const data = JSON.parse(body || "{}");
      const jobId = String(data.jobId || "");
      if (!jobId || !existsSync(path.join(projectRoot, "jobs", jobId))) {
        sendJson(response, 400, {error: "그 작업을 찾을 수 없습니다."});
        return;
      }
      mkdirSync(path.join(projectRoot, "config"), {recursive: true});
      writeFileSync(path.join(projectRoot, "config", "current-job.json"), JSON.stringify({jobId}, null, 2), "utf8");
      reloadJobPaths();
      ensureTimeline();
      sendJson(response, 200, {ok: true, jobId});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/timeline") {
      const timeline = normalizeTimeline(JSON.parse(readFileSync(timelinePath, "utf8")));
      // hasInitialSnapshot: "원본 복구" 버튼의 확인 문구를 실제 동작에 맞게 분기하기 위한 값 (항목 11)
      sendJson(response, 200, {timeline, hasInitialSnapshot: existsSync(initialSnapshotPath)});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/timeline") {
      const body = await readBody(request);
      const data = JSON.parse(body || "{}");
      if (!data.timeline) throw new Error("timeline 값이 없습니다.");
      const timeline = normalizeTimeline(data.timeline);
      maybeCaptureInitialSnapshot(); // 편집기가 덮어쓰기 전, 영상만들기 직후 상태를 보존 (항목 11)
      writeFileSync(timelinePath, JSON.stringify(timeline, null, 2), "utf8");
      rememberEditorWrite();
      sendJson(response, 200, {ok: true});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      // [항목 11] 스냅샷이 있으면 "영상을 처음 만든 직후"(자막·음성·이미지가 살아있는 상태)로,
      // 없으면(업데이트 이전에 만든 작업) 기존과 동일하게 기본 틀로 되돌린다 (폴백).
      const restoreSource = existsSync(initialSnapshotPath) ? initialSnapshotPath : defaultPropsPath;
      copyFileSync(restoreSource, timelinePath);
      rememberEditorWrite();
      sendJson(response, 200, {ok: true, restoredFromSnapshot: restoreSource === initialSnapshotPath});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/upload-image") {
      // [항목 12] 편집기 "내 이미지로 바꾸기" — base64 dataUrl(JSON)로 받아 custom_*.jpg 로 저장한다.
      // multipart 파서·추가 의존성 없음. 기존 story_0N.png 는 덮어쓰지 않아 원본이 보존된다.
      let body;
      try {
        body = await readBody(request);
      } catch {
        // readBody의 8MB 한도 초과 — 프론트가 먼저 줄여 보내지만, 만약을 위한 서버측 안내
        try {
          sendJson(response, 413, {error: "사진이 너무 커요 — 조금 작은 사진으로 다시 시도해 주세요."});
        } catch {
          // 이미 연결이 끊긴 경우는 조용히 넘어간다.
        }
        return;
      }
      const data = JSON.parse(body || "{}");
      const dataUrl = String(data.dataUrl || "");
      const match = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
      if (!match) {
        sendJson(response, 400, {error: "이미지 파일(jpg/png)만 올릴 수 있어요. 사진을 다시 선택해주세요."});
        return;
      }
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length === 0) {
        sendJson(response, 400, {error: "이미지 내용을 읽지 못했어요. 사진을 다시 선택해주세요."});
        return;
      }
      const extension = match[1] === "png" ? "png" : "jpg";
      const fileName = `custom_${Date.now()}.${extension}`;
      mkdirSync(jobPaths.publicJobRoot, {recursive: true});
      writeFileSync(path.join(jobPaths.publicJobRoot, fileName), buffer);
      // src는 기존 이미지와 동일한 규약(jobs/<jobId>/<파일명>) — 미리보기·렌더 모두 그대로 인식한다
      sendJson(response, 200, {ok: true, src: `jobs/${jobPaths.jobId}/${fileName}`});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/templates") {
      sendJson(response, 200, readTemplates());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/templates") {
      const body = await readBody(request);
      const data = JSON.parse(body || "{}");
      const timeline = normalizeTimeline(data.timeline || JSON.parse(readFileSync(timelinePath, "utf8")));
      const store = readTemplates();
      const now = new Date().toISOString();
      const templateData = templateDataFromTimeline(timeline);

      if (data.recent) {
        const existingIndex = store.templates.findIndex((template) => template.id === "recent-settings");
        const recentTemplate = {
          id: "recent-settings",
          name: "최근 사용한 설정",
          createdAt: existingIndex >= 0 ? store.templates[existingIndex].createdAt : now,
          updatedAt: now,
          data: templateData,
        };
        if (existingIndex >= 0) {
          store.templates[existingIndex] = recentTemplate;
        } else {
          store.templates.unshift(recentTemplate);
        }
        sendJson(response, 200, writeTemplates(store));
        return;
      }

      const template = {
        id: `template_${now.replace(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 6)}`,
        name: String(data.name || nextTemplateName(store.templates, timeline.productName)),
        createdAt: now,
        updatedAt: now,
        data: templateData,
      };
      store.templates = [template, ...store.templates.filter((item) => item.id !== template.id)];
      sendJson(response, 200, writeTemplates(store));
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/templates/") && url.pathname.endsWith("/apply")) {
      const templateId = decodeURIComponent(url.pathname.replace(/^\/api\/templates\//, "").replace(/\/apply$/, ""));
      const store = readTemplates();
      const template = store.templates.find((item) => item.id === templateId);
      if (!template) {
        sendJson(response, 404, {error: "템플릿을 찾을 수 없습니다."});
        return;
      }
      const timeline = normalizeTimeline(JSON.parse(readFileSync(timelinePath, "utf8")));
      const nextTimeline = applyTemplateData(timeline, template.data || {});
      maybeCaptureInitialSnapshot(); // 템플릿 적용도 편집기발 쓰기 — 직전 상태 보존 (항목 11)
      writeFileSync(timelinePath, JSON.stringify(nextTimeline, null, 2), "utf8");
      rememberEditorWrite();
      sendJson(response, 200, {ok: true, timeline: nextTimeline});
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/templates/")) {
      const templateId = decodeURIComponent(url.pathname.replace(/^\/api\/templates\//, ""));
      const store = readTemplates();
      store.templates = store.templates.filter((template) => template.id !== templateId);
      sendJson(response, 200, writeTemplates(store));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/render-jobs") {
      const body = await readBody(request);
      const data = JSON.parse(body || "{}");
      const voiceMode = data.voiceMode === "request" ? "request" : "keep";
      const quality = data.quality === "fast" ? "fast" : "high";
      const jobId = createRenderJobId();
      const progressPath = renderJobPath(jobId);
      const now = new Date().toISOString();

      const timeline = normalizeTimeline(JSON.parse(readFileSync(timelinePath, "utf8")));
      const nextTimeline = {
        ...timeline,
        editorNotes: {
          ...(timeline.editorNotes || {}),
          voiceRegenerationRequested: voiceMode === "request",
          ...(voiceMode === "request" ? {voiceRegenerationRequestedAt: now} : {}),
        },
      };
      maybeCaptureInitialSnapshot(); // 재제작 직전 — 영상만들기 직후 상태라면 이 시점에 보존된다 (항목 11)
      writeFileSync(timelinePath, JSON.stringify(nextTimeline, null, 2), "utf8");
      rememberEditorWrite();

      const initialJob = writeRenderJob(jobId, {
        status: "queued",
        message: "영상을 준비하는 중입니다",
        progress: 1,
        voiceMode,
        quality,
        createdAt: now,
      });

      void runRender({progressFile: progressPath, quality})
        .then((report) => {
          writeRenderJob(jobId, {
            status: "done",
            message: "완성되었습니다",
            progress: 100,
            voiceMode,
            quality,
            report,
            outputFile: report.outputFile,
            outputPath: report.outputPath,
            url: `/outputs/${encodeURIComponent(report.outputFile)}`,
            voiceRegenerated: Boolean(report.voiceRegenerated),
          });
        })
        .catch((error) => {
          writeRenderJob(jobId, {
            status: "error",
            message: error instanceof Error ? error.message : "영상을 만들지 못했습니다.",
            progress: 100,
            voiceMode,
            quality,
          });
        });

      sendJson(response, 202, {ok: true, jobId, job: initialJob});
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/render-jobs/")) {
      const jobId = decodeURIComponent(url.pathname.replace(/^\/api\/render-jobs\//, ""));
      const job = readRenderJob(jobId);
      if (!job) {
        sendJson(response, 404, {error: "영상 제작 기록을 찾을 수 없습니다."});
        return;
      }
      sendJson(response, 200, {job});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/render") {
      maybeCaptureInitialSnapshot(); // 렌더 자식이 timeline.json을 갱신하기 전 상태 보존 (항목 11)
      const report = await runRender();
      sendJson(response, 200, {
        ok: true,
        outputFile: report.outputFile,
        outputPath: report.outputPath,
        url: `/outputs/${encodeURIComponent(report.outputFile)}`,
        voiceRegenerated: Boolean(report.voiceRegenerated),
        voiceReport: report.voiceReport || null,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/outputs") {
      sendJson(response, 200, {outputs: listOutputs()});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/voice-presets") {
      const config = JSON.parse(readFileSync(voicePresetsPath, "utf8"));
      const presets = Array.isArray(config.presets)
        ? config.presets.map((preset) => ({
            id: String(preset.id || ""),
            label: String(preset.label || preset.id || "목소리"),
            description: String(preset.description || ""),
          })).filter((preset) => preset.id)
        : [];
      sendJson(response, 200, {presets});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bgm-list") {
      const bgmDir = path.join(projectRoot, "public", "bgm");
      const titles = {};
      const listPath = path.join(bgmDir, "bgm-list.json");
      if (existsSync(listPath)) {
        try {
          const parsed = JSON.parse(readFileSync(listPath, "utf8"));
          const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tracks) ? parsed.tracks : [];
          for (const t of arr) {
            if (t && t.file) titles[String(t.file)] = String(t.title || t.file);
          }
        } catch {
          // 목록 파일이 깨져 있어도 실제 파일 스캔으로 동작한다.
        }
      }
      const AUDIO_EXT = new Set([".mp3", ".m4a", ".wav", ".aac", ".ogg"]);
      let tracks = [];
      if (existsSync(bgmDir)) {
        try {
          tracks = readdirSync(bgmDir)
            .filter((file) => AUDIO_EXT.has(path.extname(file).toLowerCase()))
            .sort((a, b) => a.localeCompare(b, "ko"))
            .map((file) => ({
              file,
              src: `bgm/${file}`,
              title: titles[file] || file.replace(/\.[^.]+$/, ""),
            }));
        } catch {
          tracks = [];
        }
      }
      sendJson(response, 200, {tracks});
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/outputs/")) {
      sendFile(request, response, safeJoin(renderDir, url.pathname.replace(/^\/outputs\//, "")));
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/jobs/")) {
      sendFile(request, response, safeJoin(path.join(projectRoot, "public"), url.pathname));
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/public/")) {
      sendFile(request, response, safeJoin(projectRoot, url.pathname));
      return;
    }

    sendText(response, 404, "페이지를 찾을 수 없습니다.");
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "알 수 없는 오류",
    });
  }
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.log("");
    console.log("[안내] 영상 편집기가 이미 켜져 있어요. 켜져 있는 편집기를 그대로 쓰면 됩니다.");
    printOpenGuide(`http://localhost:${port}`);
    console.log("(05 영상만들기가 편집기를 미리 켜두는 경우가 있어요 — 정상이니 그대로 쓰시면 됩니다.)");
    setTimeout(() => process.exit(0), 500);
    return;
  }
  console.error(`편집기를 켜지 못했습니다: ${error.message}`);
  process.exit(1);
});

// 127.0.0.1 에만 연결: 이 작업 공간 안에서만 접속 가능 (Codespaces는 VS Code가 포트를 안전하게 포워딩)
server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}`;
  console.log(`메킷허브 영상 편집기 실행 중: ${url}`);
  printOpenGuide(url);
  // 자동 브라우저 열기는 기본 꺼짐 — 로컬(맥/윈도우)에서 --open 을 붙인 경우에만 연다
  if (process.argv.includes("--open")) openBrowserUrl(url);
});
