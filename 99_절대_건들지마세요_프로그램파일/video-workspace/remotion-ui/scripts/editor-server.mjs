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
  renderDir = jobPaths.renderDir;
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

function runRender({progressFile, quality} = {}) {
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
      if (code !== 0) {
        reject(new Error(stderr || `렌더링 프로세스 실패: ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`렌더링 결과를 해석하지 못했습니다: ${stdout}`));
      }
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
      sendJson(response, 200, {timeline});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/timeline") {
      const body = await readBody(request);
      const data = JSON.parse(body || "{}");
      if (!data.timeline) throw new Error("timeline 값이 없습니다.");
      const timeline = normalizeTimeline(data.timeline);
      writeFileSync(timelinePath, JSON.stringify(timeline, null, 2), "utf8");
      sendJson(response, 200, {ok: true});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      copyFileSync(defaultPropsPath, timelinePath);
      sendJson(response, 200, {ok: true});
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
      writeFileSync(timelinePath, JSON.stringify(nextTimeline, null, 2), "utf8");
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
      writeFileSync(timelinePath, JSON.stringify(nextTimeline, null, 2), "utf8");

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
