import React, {useEffect, useMemo, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Player, type PlayerRef} from "@remotion/player";
import {ShoppingShorts} from "../../remotion/src/shopping-shorts";

type Caption = {
  startSec: number;
  endSec: number;
  text: string;
  emphasis?: boolean;
  variant?: "caption" | "cta";
  stylePresetId?: CaptionStylePresetId;
};

type ImageOverlay = {
  startSec: number;
  endSec: number;
  src: string;
  fit?: "cover" | "contain";
  imageId?: string;
  transition?: "none" | "soft-fade" | "slow-zoom" | "blur";
};

type Scene = {
  id?: string;
  startSec?: number;
  endSec?: number;
  source?: "generated-image" | "source-video" | string;
  overlayText?: string;
};

type AudioSegment = {
  index: number;
  text: string;
  caption?: string;
  durationSec: number;
  displayDurationSec?: number;
};

type CaptionStylePresetId = "default-white" | "black-box" | "yellow-focus" | "shorts-bold" | "cta-focus";

type CaptionStyle = {
  presetId?: CaptionStylePresetId;
  fontScale?: number;
  position?: "bottom" | "center";
  animation?: "none" | "rise" | "pop" | "shake";
};

type Timeline = {
  productName: string;
  productNo: string;
  durationSec: number;
  hook: string;
  videoSrc: string;
  narrationSrc?: string;
  backgroundMusic?: {
    src?: string;
    volume?: number;
    title?: string;
    fadeInSec?: number;
    fadeOutSec?: number;
  };
  captions: Caption[];
  captionStyle?: CaptionStyle;
  visualFilter?: "basic" | "bright" | "warm" | "sharp" | "cinematic";
  imageOverlays?: ImageOverlay[];
  scenes?: Scene[];
  audio?: {
    provider?: string;
    mode?: string;
    presetId?: string;
    speed?: number;
    durationSec?: number;
    segments?: AudioSegment[];
  };
  adBadge: {
    text: string;
    position: "top-right";
  };
  cta: string;
  ctaBackground?: {
    src: string;
    blurPx?: number;
  };
  thumbnailTail: {
    durationSec: number;
    text: string;
    headline?: string;
    subheadline?: string;
    productLabel?: string;
    hideProductLabel?: boolean;
    headlineFontSize?: number;
    headlineBottom?: number;
    headlineHorizontalInset?: number;
    hideCta?: boolean;
    src?: string;
  };
  sourceDurationSec: number;
  fps?: number;
  editorNotes?: {
    voiceRegenerationRequested?: boolean;
    voiceRegenerationRequestedAt?: string;
    revisionPrompts?: Record<string, string>;
  };
};

type TimelineItem = {
  id: string;
  label: string;
  sublabel?: string;
  startSec: number;
  endSec: number;
  kind: "caption" | "image" | "video" | "audio" | "bgm" | "thumbnail";
  index?: number;
  accent: string;
  volume?: number;
};

type TimelineTrack = {
  id: string;
  title: string;
  hint: string;
  items: TimelineItem[];
};

type RenderVoiceMode = "keep" | "request";
type ExportQuality = "fast" | "high";

type RenderJobStatus = {
  jobId: string;
  status: "queued" | "running" | "done" | "error";
  message: string;
  progress: number;
  voiceMode?: RenderVoiceMode;
  quality?: ExportQuality;
  outputFile?: string;
  url?: string;
  voiceRegenerated?: boolean;
};

type OutputItem = {
  file: string;
  url: string;
  sizeMb: number;
  createdAt: string;
};

type VoicePreset = {
  id: string;
  label: string;
  description?: string;
};

type EditorTemplate = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  data?: {
    captionStyle?: CaptionStyle;
    visualFilter?: Timeline["visualFilter"];
    audioPresetId?: string;
    backgroundMusic?: {
      volume?: number;
      title?: string;
      fadeInSec?: number;
      fadeOutSec?: number;
    };
    thumbnailTail?: Partial<Timeline["thumbnailTail"]>;
  };
};

type TimelineItemTiming = {
  startSec: number;
  endSec: number;
};

type FriendlyError = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

const LICENSE_CODE = "weolbumakeitmiddle1";
const LICENSE_STORAGE_KEY = "makeit-middle-editor-license";
const defaultStatus = "쇼핑숏폼 작업을 불러오는 중입니다.";
const PREVIEW_SCALE_MIN = 70;
const PREVIEW_SCALE_MAX = 150;
const PREVIEW_SCALE_DEFAULT = 100;
const TIMELINE_HEIGHT_SCALE_MIN = 70;
const TIMELINE_HEIGHT_SCALE_MAX = 150;
const TIMELINE_HEIGHT_SCALE_DEFAULT = 100;
const FONT_SCALE_MIN = 0.9;
const FONT_SCALE_MAX = 1.4;
const FONT_SCALE_DEFAULT = 1;
const FONT_SCALE_STORAGE_KEY = "makeit-hub-editor-font-scale";
const CAPTION_STYLE_PRESETS: Array<{id: CaptionStylePresetId; label: string; sample: string}> = [
  {id: "default-white", label: "기본 흰색", sample: "깔끔한 흰색 자막"},
  {id: "black-box", label: "검정 박스", sample: "잘 보이는 박스 자막"},
  {id: "yellow-focus", label: "노란 강조", sample: "중요 문장 강조"},
  {id: "shorts-bold", label: "쇼츠 강조형", sample: "짧고 강한 자막"},
  {id: "cta-focus", label: "CTA 강조형", sample: "마지막 행동 유도"},
];
const FALLBACK_VOICE_PRESETS: VoicePreset[] = [
  {id: "natural", label: "자연형", description: "편안하게 들리는 기본 목소리"},
  {id: "commerce-soft", label: "부드러운 광고형", description: "부담스럽지 않은 광고 톤"},
  {id: "lively-story", label: "후기형", description: "후기 쇼츠에 어울리는 생동감"},
  {id: "lively-reaction", label: "리액션 강화형", description: "질문과 반응이 또렷한 톤"},
  {id: "fast-short", label: "빠른 쇼츠형", description: "짧은 쇼츠에 맞는 빠른 톤"},
];

const licensedFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("X-Makeit-License", LICENSE_CODE);
  return fetch(input, {...init, headers});
};

function numberOrFallback(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getStoredFontScale() {
  if (typeof window === "undefined") return FONT_SCALE_DEFAULT;
  const stored = Number(window.localStorage.getItem(FONT_SCALE_STORAGE_KEY));
  return Number.isFinite(stored) ? clamp(stored, FONT_SCALE_MIN, FONT_SCALE_MAX) : FONT_SCALE_DEFAULT;
}

function cloneTimeline(timeline: Timeline) {
  return JSON.parse(JSON.stringify(timeline)) as Timeline;
}

function toFriendlyError(error: unknown, fallbackTitle: string): FriendlyError {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("ElevenLabs") || message.includes("API 키")) {
    return {
      title: "음성을 만들지 못했습니다",
      message: "새 음성을 만드는 중 문제가 생겼습니다. 인터넷 연결 또는 API 키 설정을 확인해주세요.",
    };
  }
  if (message.includes("저장")) {
    return {
      title: "저장하지 못했습니다",
      message: "수정한 내용을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
  if (message.includes("렌더") || message.includes("영상")) {
    return {
      title: "영상을 만들지 못했습니다",
      message: "영상을 만드는 중 문제가 생겼습니다. 잠시 후 다시 시도해주세요.",
    };
  }
  if (message.includes("불러오")) {
    return {
      title: "편집 내용을 불러오지 못했습니다",
      message: "편집 내용을 불러오지 못했습니다. 서버가 켜져 있는지 확인해주세요.",
    };
  }
  return {
    title: fallbackTitle,
    message: "작업을 마치지 못했습니다. 다시 한 번 시도해주세요.",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatSeconds(value: number) {
  return `${Number(value || 0).toFixed(2)}초`;
}

function formatClock(value: number) {
  const safeValue = Math.max(0, value || 0);
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatOutputDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "제작 시간 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function captionStyleLabel(presetId?: string) {
  return CAPTION_STYLE_PRESETS.find((preset) => preset.id === presetId)?.label || "기본";
}

type BgmTrack = {file: string; src: string; title: string};

function voicePresetLabel(presets: VoicePreset[], presetId?: string) {
  return presets.find((preset) => preset.id === presetId)?.label || "기본";
}

function shortText(value: string, maxLength = 22) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function roundTime(value: number) {
  return Math.round(value * 100) / 100;
}

function getViewportSize() {
  if (typeof window === "undefined") return {width: 1440, height: 940};
  return {width: window.innerWidth, height: window.innerHeight};
}

function getResponsivePreviewHeight(viewport: {width: number; height: number}, scale: number) {
  const baseHeight = clamp(Math.min(viewport.width * 0.16, viewport.height * 0.3), 190, 620);
  const maxHeight = Math.max(320, Math.min(viewport.height * 0.64, 760));
  return Math.round(clamp((baseHeight * scale) / 100, 170, maxHeight));
}

function getResponsiveTimelineRowHeight(viewport: {width: number; height: number}, scale: number) {
  const baseHeight = clamp(viewport.height * 0.05, 36, 66);
  return Math.round(clamp((baseHeight * scale) / 100, 34, 88));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function App() {
  const playerRef = useRef<PlayerRef>(null);
  const currentSecRef = useRef(0);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [status, setStatus] = useState(defaultStatus);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [history, setHistory] = useState<Timeline[]>([]);
  const [future, setFuture] = useState<Timeline[]>([]);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"select" | "cut">("select");
  const [lockedTracks, setLockedTracks] = useState<Set<string>>(() => new Set());
  const [toolFlash, setToolFlash] = useState<"select" | "cut" | null>(null);
  const toolFlashFirst = useRef(true);
  const [currentSec, setCurrentSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineHeightScale, setTimelineHeightScale] = useState(TIMELINE_HEIGHT_SCALE_DEFAULT);
  const [previewScale, setPreviewScale] = useState(PREVIEW_SCALE_DEFAULT);
  const [fontScale, setFontScale] = useState(getStoredFontScale);
  const [viewportSize, setViewportSize] = useState(getViewportSize);
  const [captionTextDirty, setCaptionTextDirty] = useState(false);
  const [voiceDecisionOpen, setVoiceDecisionOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [pendingVoiceMode, setPendingVoiceMode] = useState<RenderVoiceMode>("keep");
  const [exportQuality, setExportQuality] = useState<ExportQuality>("high");
  const [renderJob, setRenderJob] = useState<RenderJobStatus | null>(null);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [outputDrawerOpen, setOutputDrawerOpen] = useState(false);
  const [jobs, setJobs] = useState<{jobId: string; productName: string; productNo: string; hasOutput: boolean}[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string>("");
  const [jobMenuOpen, setJobMenuOpen] = useState(false);
  const [templates, setTemplates] = useState<EditorTemplate[]>([]);
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false);
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>(FALLBACK_VOICE_PRESETS);
  const [bgmTracks, setBgmTracks] = useState<BgmTrack[]>([]);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  const [layerEditBaseline, setLayerEditBaseline] = useState<{
    timeline: Timeline;
    captionTextDirty: boolean;
  } | null>(null);
  const [licenseInput, setLicenseInput] = useState("");
  const [licenseError, setLicenseError] = useState("");
  const [licenseVerified, setLicenseVerified] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(LICENSE_STORAGE_KEY) === LICENSE_CODE;
  });

  const fps = timeline?.fps || 30;
  const durationInFrames = Math.max(30, Math.ceil((timeline?.durationSec || 24) * fps));
  const previewProgress = clamp((currentSec / Math.max(timeline?.durationSec || 1, 1)) * 100, 0, 100);
  const previewHeight = getResponsivePreviewHeight(viewportSize, previewScale);
  const previewSizeProgress = clamp(
    ((previewScale - PREVIEW_SCALE_MIN) / (PREVIEW_SCALE_MAX - PREVIEW_SCALE_MIN)) * 100,
    0,
    100,
  );
  const fontSizeProgress = clamp(((fontScale - FONT_SCALE_MIN) / (FONT_SCALE_MAX - FONT_SCALE_MIN)) * 100, 0, 100);

  const timelineItems = useMemo(() => (timeline ? buildTimelineItems(timeline) : []), [timeline]);
  const activeTimelineItem = useMemo(
    () => timelineItems.find((item) => item.id === selectedTimelineId) || null,
    [selectedTimelineId, timelineItems],
  );

  const timelineTracks = useMemo<TimelineTrack[]>(() => {
    return [
      {
        id: "captions",
        title: "자막",
        hint: "말이 보이는 구간",
        items: timelineItems.filter((item) => item.kind === "caption"),
      },
      {
        id: "images",
        title: "이미지",
        hint: "GPT 이미지/컷 전환",
        items: timelineItems.filter((item) => item.kind === "image"),
      },
      {
        id: "video",
        title: "원본 영상",
        hint: "직접 촬영한 영상",
        items: timelineItems.filter((item) => item.kind === "video"),
      },
      {
        id: "audio",
        title: "음성",
        hint: "나레이션 문장",
        items: timelineItems.filter((item) => item.kind === "audio"),
      },
      {
        id: "bgm",
        title: "BGM",
        hint: "배경음악 볼륨",
        items: timelineItems.filter((item) => item.kind === "bgm"),
      },
      {
        id: "thumbnail",
        title: "썸네일",
        hint: "마지막 고정 프레임",
        items: timelineItems.filter((item) => item.kind === "thumbnail"),
      },
    ];
  }, [timelineItems]);
  const timelineRowHeight = getResponsiveTimelineRowHeight(viewportSize, timelineHeightScale);
  const timelineScrollHeight = Math.round(
    timelineRowHeight * timelineTracks.length + Math.max(timelineTracks.length - 1, 0) * 4 + 28,
  );
  const timelineHeightProgress = clamp(
    ((timelineHeightScale - TIMELINE_HEIGHT_SCALE_MIN) /
      (TIMELINE_HEIGHT_SCALE_MAX - TIMELINE_HEIGHT_SCALE_MIN)) *
      100,
    0,
    100,
  );

  const refreshPreviewFrame = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const frame = Math.round(currentSecRef.current * fps);
        playerRef.current?.seekTo(frame);
      });
    });
  };

  const updateTimelineWithHistory = (updater: (current: Timeline) => Timeline) => {
    setTimeline((current) => {
      if (!current) return current;
      setHistory((items) => [...items.slice(-49), cloneTimeline(current)]);
      setFuture([]);
      return updater(current);
    });
  };

  const updateCaption = (index: number, patch: Partial<Caption>) => {
    updateTimelineWithHistory((current) => {
      const captions = current.captions.map((caption, captionIndex) =>
        captionIndex === index ? {...caption, ...patch} : caption,
      );
      return {...current, captions};
    });
    refreshPreviewFrame();
  };

  const updateCaptionText = (index: number, text: string) => {
    updateCaption(index, {text});
    setCaptionTextDirty(true);
  };

  const updateCaptionStyle = (patch: Partial<CaptionStyle>) => {
    updateTimelineWithHistory((current) => {
      return {
        ...current,
        captionStyle: {
          presetId: "black-box",
          ...(current.captionStyle || {}),
          ...patch,
        },
      };
    });
    refreshPreviewFrame();
  };

  const updateCaptionStylePreset = (index: number, presetId: CaptionStylePresetId, applyToAll: boolean) => {
    updateTimelineWithHistory((current) => {
      if (applyToAll) {
        return {
          ...current,
          captionStyle: {
            ...(current.captionStyle || {}),
            presetId,
          },
          captions: current.captions.map((caption) => ({...caption, stylePresetId: presetId})),
        };
      }

      const captions = current.captions.map((caption, captionIndex) =>
        captionIndex === index ? {...caption, stylePresetId: presetId} : caption,
      );
      return {...current, captions};
    });
    refreshPreviewFrame();
  };

  const updateImageOverlay = (index: number, patch: Partial<ImageOverlay>) => {
    updateTimelineWithHistory((current) => {
      const imageOverlays = (current.imageOverlays || []).map((overlay, overlayIndex) =>
        overlayIndex === index ? {...overlay, ...patch} : overlay,
      );
      return {...current, imageOverlays};
    });
    refreshPreviewFrame();
  };

  const updateThumbnail = (patch: Partial<Timeline["thumbnailTail"]>) => {
    updateTimelineWithHistory((current) => {
      return {...current, thumbnailTail: {...current.thumbnailTail, ...patch}};
    });
    refreshPreviewFrame();
  };

  const updateScene = (index: number, patch: Partial<Scene>) => {
    updateTimelineWithHistory((current) => {
      const scenes = (current.scenes || []).map((scene, sceneIndex) =>
        sceneIndex === index ? {...scene, ...patch} : scene,
      );
      return {...current, scenes};
    });
    refreshPreviewFrame();
  };

  const updateBackgroundMusic = (patch: Partial<NonNullable<Timeline["backgroundMusic"]>>) => {
    updateTimelineWithHistory((current) => {
      return {
        ...current,
        backgroundMusic: {
          ...(current.backgroundMusic || {}),
          ...patch,
        },
      };
    });
    refreshPreviewFrame();
  };

  const updateAudioSettings = (patch: Partial<NonNullable<Timeline["audio"]>>) => {
    updateTimelineWithHistory((current) => {
      return {
        ...current,
        audio: {
          ...(current.audio || {}),
          ...patch,
        },
      };
    });
  };

  const updateVisualFilter = (visualFilter: NonNullable<Timeline["visualFilter"]>) => {
    updateTimelineWithHistory((current) => ({...current, visualFilter}));
    refreshPreviewFrame();
  };

  const undoTimeline = () => {
    if (!timeline || history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [cloneTimeline(timeline), ...items].slice(0, 50));
    setTimeline(cloneTimeline(previous));
    setStatus("실행 취소했습니다.");
    refreshPreviewFrame();
  };

  const redoTimeline = () => {
    if (!timeline || future.length === 0) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items.slice(-49), cloneTimeline(timeline)]);
    setTimeline(cloneTimeline(next));
    setStatus("다시 실행했습니다.");
    refreshPreviewFrame();
  };

  const toggleTrackLock = (trackId: string) => {
    setLockedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  // 커트 도구가 클릭한 "그 지점"에서 블록을 자른다(재생헤드와 무관). 전 레이어 공용.
  const splitItemAt = (item: TimelineItem, rawSplitSec: number) => {
    if (!timeline) return;
    if (lockedTracks.has(item.kind)) {
      setStatus("잠긴 트랙이에요. 트랙 자물쇠를 풀고 편집하세요.");
      return;
    }
    const splitSec = roundTime(rawSplitSec);
    if (splitSec <= item.startSec + 0.12 || splitSec >= item.endSec - 0.12) {
      setFriendlyError({
        title: "자르기 위치를 확인해주세요",
        message: "블록의 가운데 부분을 클릭해서 잘라주세요. 너무 끝쪽은 자를 수 없어요.",
      });
      return;
    }

    updateTimelineWithHistory((current) => {
      if (item.kind === "caption" && typeof item.index === "number") {
        const captions = [...current.captions];
        const target = captions[item.index];
        captions.splice(item.index, 1, {...target, endSec: splitSec}, {...target, startSec: splitSec});
        // 자막-음성 연동: 음성 세그먼트도 같은 순서로 나눠 표시를 맞춘다.
        // 실제 음성은 렌더 시 자막(captions) 기준으로 다시 만들어지므로 자막=음성이 유지된다.
        let nextAudio = current.audio;
        if (current.audio && Array.isArray(current.audio.segments)) {
          const segs = [...current.audio.segments];
          const segIdx = segs.findIndex((seg) => seg.index === item.index);
          if (segIdx !== -1) {
            const segTarget = segs[segIdx];
            const half = Math.max(roundTime((segTarget.durationSec || 0) / 2), 0.2);
            segs.splice(
              segIdx,
              1,
              {...segTarget, durationSec: half},
              {...segTarget, durationSec: Math.max(roundTime((segTarget.durationSec || 0) - half), 0.2)},
            );
          }
          nextAudio = {...current.audio, segments: segs.map((seg, i) => ({...seg, index: i}))};
        }
        return {
          ...current,
          captions,
          audio: nextAudio,
          editorNotes: {...(current.editorNotes || {}), voiceRegenerationRequested: true},
        };
      }
      if (item.kind === "image" && typeof item.index === "number") {
        const imageOverlays = [...(current.imageOverlays || [])];
        const target = imageOverlays[item.index];
        imageOverlays.splice(item.index, 1, {...target, endSec: splitSec}, {...target, startSec: splitSec});
        return {...current, imageOverlays};
      }
      if (item.kind === "video" && typeof item.index === "number") {
        const scenes = [...(current.scenes || [])];
        const target = scenes[item.index];
        scenes.splice(item.index, 1, {...target, endSec: splitSec}, {...target, startSec: splitSec});
        return {...current, scenes};
      }
      return current;
    });
    setStatus("클릭한 지점에서 잘랐습니다.");
    refreshPreviewFrame();
  };

  const splitSelectedItem = () => {
    if (!timeline || !activeTimelineItem) return;
    const cursorSec = currentSecRef.current;
    const midpointSec = activeTimelineItem.startSec + (activeTimelineItem.endSec - activeTimelineItem.startSec) / 2;
    const splitSec =
      cursorSec > activeTimelineItem.startSec + 0.12 && cursorSec < activeTimelineItem.endSec - 0.12
        ? cursorSec
        : midpointSec;
    splitItemAt(activeTimelineItem, splitSec);
  };

  const duplicateTimelineItem = (item: TimelineItem) => {
    const duration = Math.max(item.endSec - item.startSec, 0.3);
    updateTimelineWithHistory((current) => {
      const nextStart = roundTime(clamp(item.endSec, 0, Math.max(current.durationSec - duration, 0)));
      const nextEnd = roundTime(clamp(nextStart + duration, nextStart + 0.2, current.durationSec));
      if (item.kind === "caption" && typeof item.index === "number") {
        const captions = [...current.captions];
        captions.splice(item.index + 1, 0, {...captions[item.index], startSec: nextStart, endSec: nextEnd});
        return {...current, captions};
      }
      if (item.kind === "image" && typeof item.index === "number") {
        const imageOverlays = [...(current.imageOverlays || [])];
        imageOverlays.splice(item.index + 1, 0, {...imageOverlays[item.index], startSec: nextStart, endSec: nextEnd});
        return {...current, imageOverlays};
      }
      if (item.kind === "video" && typeof item.index === "number") {
        const scenes = [...(current.scenes || [])];
        scenes.splice(item.index + 1, 0, {...scenes[item.index], startSec: nextStart, endSec: nextEnd});
        return {...current, scenes};
      }
      return current;
    });
    setStatus("구간을 복사했습니다.");
    refreshPreviewFrame();
  };

  const deleteTimelineItem = (item: TimelineItem) => {
    if (lockedTracks.has(item.kind)) {
      setStatus("잠긴 트랙이에요. 트랙 자물쇠를 풀고 편집하세요.");
      return;
    }
    if (!window.confirm("이 구간을 삭제할까요?")) return;
    // ripple: 삭제한 구간 뒤에 있는 같은 트랙 블록들을 빈 만큼 앞으로 당긴다(캡컷과 동일).
    const gap = Math.max(item.endSec - item.startSec, 0);
    const rippleAfter = <T extends {startSec?: number; endSec?: number}>(list: T[]): T[] =>
      list.map((el) =>
        Number(el.startSec) >= item.startSec - 0.001
          ? {
              ...el,
              startSec: roundTime(Math.max(0, Number(el.startSec) - gap)),
              endSec: roundTime(Math.max(0.2, Number(el.endSec) - gap)),
            }
          : el,
      );
    updateTimelineWithHistory((current) => {
      if (item.kind === "caption" && typeof item.index === "number") {
        const captions = rippleAfter(current.captions.filter((_, index) => index !== item.index));
        // 자막-음성 연동: 대응하는 음성 세그먼트도 함께 삭제한다(자막=음성 유지).
        let nextAudio = current.audio;
        if (current.audio && Array.isArray(current.audio.segments)) {
          const segs = current.audio.segments
            .filter((seg) => seg.index !== item.index)
            .map((seg, i) => ({...seg, index: i}));
          nextAudio = {...current.audio, segments: segs};
        }
        return {
          ...current,
          captions,
          audio: nextAudio,
          editorNotes: {...(current.editorNotes || {}), voiceRegenerationRequested: true},
        };
      }
      if (item.kind === "image" && typeof item.index === "number") {
        const imageOverlays = rippleAfter((current.imageOverlays || []).filter((_, index) => index !== item.index));
        return {...current, imageOverlays};
      }
      if (item.kind === "video" && typeof item.index === "number") {
        const scenes = rippleAfter((current.scenes || []).filter((_, index) => index !== item.index));
        return {...current, scenes};
      }
      if (item.kind === "bgm") {
        return {...current, backgroundMusic: {...current.backgroundMusic, volume: 0}};
      }
      return current;
    });
    setLayerEditBaseline(null);
    setSelectedTimelineId(null);
    setStatus(item.kind === "bgm" ? "BGM을 껐습니다." : "구간을 삭제하고 뒤 블록을 당겼습니다.");
    refreshPreviewFrame();
  };

  const updateRevisionPrompt = (itemId: string, prompt: string) => {
    setTimeline((current) => {
      if (!current) return current;
      return {
        ...current,
        editorNotes: {
          ...(current.editorNotes || {}),
          revisionPrompts: {
            ...(current.editorNotes?.revisionPrompts || {}),
            [itemId]: prompt,
          },
        },
      };
    });
  };

  const updateTimelineItemTiming = (item: TimelineItem, timing: TimelineItemTiming) => {
    if (!timeline) return;
    const minDuration = item.kind === "caption" ? 0.18 : 0.35;
    const startSec = roundTime(clamp(timing.startSec, 0, timeline.durationSec - minDuration));
    const endSec = roundTime(clamp(timing.endSec, startSec + minDuration, timeline.durationSec));

    if (item.kind === "caption" && typeof item.index === "number") {
      updateCaption(item.index, {startSec, endSec});
      return;
    }

    if (item.kind === "image" && typeof item.index === "number") {
      updateImageOverlay(item.index, {startSec, endSec});
      return;
    }

    if (item.kind === "video" && typeof item.index === "number") {
      updateScene(item.index, {startSec, endSec});
      return;
    }

    if (item.kind === "thumbnail") {
      updateThumbnail({durationSec: roundTime(Math.max(timeline.durationSec - startSec, minDuration))});
    }
  };

  const pausePreview = () => {
    playerRef.current?.pause();
    setIsPlaying(false);
  };

  const seekToSec = (sec: number, options: {pause?: boolean} = {}) => {
    if (options.pause !== false) {
      pausePreview();
    }
    const maxSec = timeline?.durationSec ?? sec;
    const safeSec = clamp(sec, 0, Math.max(maxSec, 0));
    playerRef.current?.seekTo(Math.round(safeSec * fps));
    currentSecRef.current = safeSec;
    setCurrentSec(safeSec);
  };

  const startPreview = async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      await player.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(Boolean(player.isPlaying?.()));
      setStatus("재생을 시작하지 못했습니다. 미리보기 화면의 재생 버튼을 한 번 눌러주세요.");
      setFriendlyError({
        title: "미리보기를 재생하지 못했습니다",
        message: "미리보기 화면의 재생 버튼을 한 번 눌러주세요. 그 다음에는 스페이스바로 재생할 수 있습니다.",
      });
    }
  };

  const togglePlayback = async () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) {
      player.pause();
      setIsPlaying(false);
      return;
    }
    await startPreview();
  };

  const jumpBySeconds = (seconds: number) => {
    seekToSec(currentSecRef.current + seconds);
  };

  const jumpByFrames = (frames: number) => {
    seekToSec(currentSecRef.current + frames / fps);
  };

  const zoomTimeline = (nextZoom: number) => {
    setTimelineZoom(clamp(nextZoom, 0.5, 3));
  };

  useEffect(() => {
    const handleResize = () => setViewportSize(getViewportSize());
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    if (!licenseVerified || !timeline) return undefined;
    const timer = window.setInterval(() => {
      const currentFrame = playerRef.current?.getCurrentFrame?.();
      if (typeof currentFrame === "number") {
        const nextSec = currentFrame / fps;
        currentSecRef.current = nextSec;
        setCurrentSec(nextSec);
      }
      setIsPlaying(Boolean(playerRef.current?.isPlaying?.()));
    }, 160);
    return () => window.clearInterval(timer);
  }, [fps, licenseVerified, timeline]);

  useEffect(() => {
    if (!licenseVerified || !timeline) return;
    refreshPreviewFrame();
  }, [fps, licenseVerified, timeline]);

  const focusTimelineItem = (item: TimelineItem) => {
    if (timeline) {
      setLayerEditBaseline({timeline: cloneTimeline(timeline), captionTextDirty});
    }
    seekToSec(item.startSec);
    setSelectedTimelineId(item.id);
  };

  const cancelLayerEdit = () => {
    if (layerEditBaseline) {
      setTimeline(cloneTimeline(layerEditBaseline.timeline));
      setCaptionTextDirty(layerEditBaseline.captionTextDirty);
      setStatus("수정 내용을 취소했습니다.");
    }
    setLayerEditBaseline(null);
    setSelectedTimelineId(null);
  };

  const applyLayerEdit = () => {
    setLayerEditBaseline(null);
    setSelectedTimelineId(null);
    setStatus("수정 내용을 적용했습니다. 저장 버튼을 누르면 파일에 저장됩니다.");
    void saveCurrentTemplate(true).catch(() => {
      setStatus("수정 내용을 적용했습니다. 저장 버튼을 누르면 파일에 저장됩니다.");
    });
  };

  const loadTimeline = async () => {
    const response = await licensedFetch("/api/timeline");
    if (!response.ok) throw new Error("타임라인을 불러오지 못했습니다.");
    const data = await response.json();
    setTimeline(data.timeline);
    setHistory([]);
    setFuture([]);
    setStatus("샘플 영상을 불러왔습니다. 아래 타임라인 블록을 누르면 해당 구간을 바로 수정할 수 있습니다.");
  };

  const loadOutputs = async () => {
    const response = await licensedFetch("/api/outputs");
    if (!response.ok) throw new Error("완성 영상을 불러오지 못했습니다.");
    const data = await response.json();
    setOutputs(Array.isArray(data.outputs) ? data.outputs : []);
  };

  const loadJobs = async () => {
    const response = await licensedFetch("/api/jobs");
    if (!response.ok) return;
    const data = await response.json();
    setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    setCurrentJobId(data.current || "");
  };

  const switchJob = async (jobId: string) => {
    if (!jobId || jobId === currentJobId) return;
    setBusy(true);
    try {
      const response = await licensedFetch("/api/switch-job", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({jobId}),
      });
      if (!response.ok) throw new Error("작업 전환에 실패했습니다.");
      setCurrentJobId(jobId);
      await loadTimeline();
      await loadOutputs();
      setStatus("불러온 작업: " + jobId + " — 이전에 만든 영상을 편집할 수 있습니다.");
    } catch (error) {
      setFriendlyError(toFriendlyError(error, "작업을 불러오지 못했습니다"));
    } finally {
      setBusy(false);
    }
  };

  const loadVoicePresets = async () => {
    const response = await licensedFetch("/api/voice-presets");
    if (!response.ok) throw new Error("목소리 목록을 불러오지 못했습니다.");
    const data = await response.json();
    setVoicePresets(Array.isArray(data.presets) && data.presets.length > 0 ? data.presets : FALLBACK_VOICE_PRESETS);
  };

  const loadBgmTracks = async () => {
    const response = await licensedFetch("/api/bgm-list");
    if (!response.ok) throw new Error("BGM 목록을 불러오지 못했습니다.");
    const data = await response.json();
    setBgmTracks(Array.isArray(data.tracks) ? data.tracks : []);
  };

  const loadTemplates = async () => {
    const response = await licensedFetch("/api/templates");
    if (!response.ok) throw new Error("템플릿을 불러오지 못했습니다.");
    const data = await response.json();
    setTemplates(Array.isArray(data.templates) ? data.templates : []);
  };

  async function saveCurrentTemplate(recent = false) {
    if (!timeline) return;
    const response = await licensedFetch("/api/templates", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({timeline, recent}),
    });
    if (!response.ok) throw new Error("템플릿을 저장하지 못했습니다.");
    const data = await response.json();
    setTemplates(Array.isArray(data.templates) ? data.templates : []);
    setStatus(recent ? "최근 사용한 설정을 기억했습니다." : "현재 설정을 템플릿으로 저장했습니다.");
  }

  const applyTemplate = async (templateId: string) => {
    const response = await licensedFetch(`/api/templates/${encodeURIComponent(templateId)}/apply`, {method: "POST"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "템플릿을 적용하지 못했습니다.");
    if (timeline) {
      setHistory((items) => [...items.slice(-49), cloneTimeline(timeline)]);
      setFuture([]);
    }
    setTimeline(data.timeline);
    setStatus("템플릿을 적용하고 저장했습니다.");
    refreshPreviewFrame();
  };

  const deleteTemplate = async (templateId: string) => {
    const response = await licensedFetch(`/api/templates/${encodeURIComponent(templateId)}`, {method: "DELETE"});
    if (!response.ok) throw new Error("템플릿을 삭제하지 못했습니다.");
    const data = await response.json();
    setTemplates(Array.isArray(data.templates) ? data.templates : []);
    setStatus("템플릿을 삭제했습니다.");
  };

  useEffect(() => {
    loadTimeline().catch((error) => {
      setStatus("편집 내용을 불러오지 못했습니다.");
      setFriendlyError(toFriendlyError(error, "편집 내용을 불러오지 못했습니다"));
    });
    loadJobs().catch(() => {});
  }, []);

  useEffect(() => {
    if (!licenseVerified) return;
    loadOutputs().catch(() => {
      setOutputs([]);
    });
    loadVoicePresets().catch(() => {
      setVoicePresets(FALLBACK_VOICE_PRESETS);
    });
    loadBgmTracks().catch(() => {
      setBgmTracks([]);
    });
    loadTemplates().catch(() => {
      setTemplates([]);
    });
  }, [licenseVerified]);

  // a/b 도구 전환 시 화면 가운데에 아이콘(🖱 선택 / ✂ 커트)을 잠깐 깜빡 띄운다.
  useEffect(() => {
    if (toolFlashFirst.current) {
      toolFlashFirst.current = false;
      return;
    }
    setToolFlash(editorMode);
    // 커트는 "무엇을 자를 수 있는지" 안내 문구를 읽을 시간을 주려고 조금 더 오래 띄운다.
    const timer = window.setTimeout(() => setToolFlash(null), editorMode === "cut" ? 2200 : 900);
    return () => window.clearTimeout(timer);
  }, [editorMode]);

  const saveTimeline = async (timelineOverride?: Timeline) => {
    const nextTimeline = timelineOverride || timeline;
    if (!nextTimeline) return false;
    setBusy(true);
    setStatus("수정한 값을 저장하는 중입니다.");
    try {
      const response = await licensedFetch("/api/timeline", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({timeline: nextTimeline}),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "저장에 실패했습니다.");
      }
      setStatus("저장 완료. 미리보기와 렌더링에 같은 값이 적용됩니다.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.");
      setFriendlyError(toFriendlyError(error, "저장하지 못했습니다"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openExportDialog = (voiceMode: RenderVoiceMode) => {
    setPendingVoiceMode(voiceMode);
    setExportQuality("high");
    setExportDialogOpen(true);
  };

  const runRenderVideo = async (voiceMode: RenderVoiceMode, quality: ExportQuality) => {
    if (!timeline) return;
    const timelineToSave =
      voiceMode === "request"
        ? {
            ...timeline,
            editorNotes: {
              ...(timeline.editorNotes || {}),
              voiceRegenerationRequested: true,
              voiceRegenerationRequestedAt: new Date().toISOString(),
            },
          }
        : timeline;

    setTimeline(timelineToSave);
    setRendering(true);
    setRenderJob({
      jobId: "starting",
      status: "queued",
      message: "영상을 준비하는 중입니다",
      progress: 1,
      voiceMode,
      quality,
    });
    setCaptionTextDirty(false);
    setExportDialogOpen(false);
    setStatus(
      voiceMode === "request"
        ? "새 음성을 만들고 영상을 제작하는 중입니다. 잠시만 기다려주세요."
        : "렌더링을 시작했습니다. 이 과정은 로컬에서 영상을 만드는 작업이며 OpenAI API 비용은 발생하지 않습니다.",
    );
    try {
      const saved = await saveTimeline(timelineToSave);
      if (!saved) throw new Error("저장에 실패해서 렌더링을 중단했습니다.");
      setStatus(
        voiceMode === "request"
          ? "새 음성을 만들고 영상을 제작하는 중입니다. 잠시만 기다려주세요."
          : "영상을 제작하는 중입니다. 잠시만 기다려주세요.",
      );
      const response = await licensedFetch("/api/render-jobs", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({voiceMode, quality}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "렌더링에 실패했습니다.");
      setRenderJob(data.job || {
        jobId: data.jobId,
        status: "queued",
        message: "영상을 준비하는 중입니다",
        progress: 1,
        voiceMode,
        quality,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "렌더링 중 오류가 발생했습니다.");
      setFriendlyError(toFriendlyError(error, "영상을 만들지 못했습니다"));
      setRenderJob(null);
      setRendering(false);
    }
  };

  const renderVideo = async () => {
    if (!timeline) return;
    // 자막 글자를 고쳤거나(captionTextDirty), 저장된 음성이 지금 자막과 글자가 다르면 → 음성을 새 자막에 맞춰 다시 만든다.
    // 둘 다 아니면(타이밍·이미지만 변경) 음성은 그대로 두고 화면만 다시 렌더한다(크레딧 0).
    const caps = timeline.captions || [];
    const segs = ((timeline.audio as {segments?: Array<{text?: string}>} | undefined)?.segments) || [];
    const norm = (s?: string) => String(s || "").replace(/\s/g, "");
    const voiceMismatch =
      caps.length !== segs.length || caps.some((c, i) => norm(segs[i]?.text) !== norm(c.text));
    openExportDialog(captionTextDirty || voiceMismatch ? "request" : "keep");
  };

  useEffect(() => {
    if (!renderJob || renderJob.jobId === "starting" || renderJob.status === "done" || renderJob.status === "error") {
      return undefined;
    }

    let cancelled = false;

    const pollRenderJob = async () => {
      try {
        const response = await licensedFetch(`/api/render-jobs/${encodeURIComponent(renderJob.jobId)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "영상 제작 상태를 확인하지 못했습니다.");
        const nextJob = data.job as RenderJobStatus;
        if (cancelled) return;
        setRenderJob(nextJob);
        setStatus(nextJob.message || "영상을 제작하는 중입니다.");

        if (nextJob.status === "done") {
          setRendering(false);
          setCaptionTextDirty(false);
          if (nextJob.voiceRegenerated) {
            await loadTimeline();
          }
          await loadOutputs();
          if (!cancelled) {
            setOutputDrawerOpen(true);
            setStatus(nextJob.outputFile ? `완성되었습니다: ${nextJob.outputFile}` : "영상 제작이 완료되었습니다.");
          }
        }

        if (nextJob.status === "error") {
          setRendering(false);
          setFriendlyError(toFriendlyError(new Error(nextJob.message), "영상을 만들지 못했습니다"));
        }
      } catch (error) {
        if (cancelled) return;
        setRendering(false);
        setRenderJob((current) =>
          current
            ? {
                ...current,
                status: "error",
                message: error instanceof Error ? error.message : "영상 제작 상태를 확인하지 못했습니다.",
                progress: 100,
              }
            : current,
        );
        setFriendlyError(toFriendlyError(error, "영상을 만들지 못했습니다"));
      }
    };

    void pollRenderJob();
    const timer = window.setInterval(() => {
      void pollRenderJob();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [renderJob?.jobId, renderJob?.status]);

  const resetTimeline = async () => {
    if (!window.confirm("시계 쇼츠 샘플의 원본 설정으로 되돌릴까요?")) return;
    setBusy(true);
    setStatus("원본 설정으로 되돌리는 중입니다.");
    try {
      const response = await licensedFetch("/api/reset", {method: "POST"});
      if (!response.ok) throw new Error("초기화에 실패했습니다.");
      await loadTimeline();
      setSelectedTimelineId(null);
      setCaptionTextDirty(false);
      setStatus("원본 설정으로 되돌렸습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "초기화 중 오류가 발생했습니다.");
      setFriendlyError(toFriendlyError(error, "원본으로 되돌리지 못했습니다"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!licenseVerified || !timeline) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const editable = isEditableTarget(event.target);

      if (editable && !(modifier && (key === "s" || key === "e"))) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
        return;
      }

      // 캡컷식 도구 전환: a = 선택(마우스), b = 커트
      if (!modifier && key === "a") {
        event.preventDefault();
        setEditorMode("select");
        setStatus("선택 도구 (마우스)");
        return;
      }

      if (!modifier && key === "b") {
        event.preventDefault();
        setEditorMode("cut");
        setStatus("커트 도구 — 자를 지점을 클릭하세요");
        return;
      }

      // 분할(맥 ⌘B / 윈도우 Ctrl+B): 선택한 블록을 재생선 위치에서 자른다
      if (modifier && key === "b") {
        event.preventDefault();
        splitSelectedItem();
        return;
      }

      // 복제(맥 ⌘D / 윈도우 Ctrl+D)
      if (modifier && key === "d" && activeTimelineItem) {
        event.preventDefault();
        duplicateTimelineItem(activeTimelineItem);
        return;
      }

      // 삭제(Delete / Backspace)
      if ((key === "delete" || key === "backspace") && activeTimelineItem) {
        event.preventDefault();
        deleteTimelineItem(activeTimelineItem);
        return;
      }

      if (key === "k") {
        event.preventDefault();
        pausePreview();
        return;
      }

      if (key === "j") {
        event.preventDefault();
        jumpBySeconds(event.shiftKey ? -5 : -1);
        return;
      }

      if (key === "l") {
        event.preventDefault();
        jumpBySeconds(event.shiftKey ? 5 : 1);
        return;
      }

      if (key === "," || key === "<") {
        event.preventDefault();
        jumpByFrames(event.shiftKey ? -5 : -1);
        return;
      }

      if (key === "." || key === ">") {
        event.preventDefault();
        jumpByFrames(event.shiftKey ? 5 : 1);
        return;
      }

      if (modifier && key === "s") {
        event.preventDefault();
        void saveTimeline();
        return;
      }

      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoTimeline();
        } else {
          undoTimeline();
        }
        return;
      }

      if (modifier && key === "y") {
        event.preventDefault();
        redoTimeline();
        return;
      }

      if (modifier && key === "e") {
        event.preventDefault();
        void renderVideo();
        return;
      }

      if (key === "arrowleft") {
        event.preventDefault();
        jumpBySeconds(event.shiftKey ? -5 : -1);
        return;
      }

      if (key === "arrowright") {
        event.preventDefault();
        jumpBySeconds(event.shiftKey ? 5 : 1);
        return;
      }

      if (key === "home") {
        event.preventDefault();
        seekToSec(0);
        return;
      }

      if (key === "end") {
        event.preventDefault();
        seekToSec(timeline.durationSec);
        return;
      }

      if ((modifier && (key === "=" || key === "+")) || (!modifier && (key === "=" || key === "+"))) {
        event.preventDefault();
        zoomTimeline(timelineZoom + 0.15);
        return;
      }

      if ((modifier && key === "-") || (!modifier && key === "-")) {
        event.preventDefault();
        zoomTimeline(timelineZoom - 0.15);
        return;
      }

      if (key === "0") {
        event.preventDefault();
        zoomTimeline(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fps, future.length, history.length, licenseVerified, timeline, timelineZoom, selectedTimelineId]);

  const submitLicense = () => {
    if (licenseInput.trim() !== LICENSE_CODE) {
      setLicenseError("라이센스 코드가 맞지 않습니다. 강의 안내에 있는 코드를 그대로 입력해주세요.");
      return;
    }
    window.localStorage.setItem(LICENSE_STORAGE_KEY, LICENSE_CODE);
    setLicenseVerified(true);
    setLicenseError("");
  };

  if (!licenseVerified) {
    return (
      <main className="license-screen">
        <section className="license-card">
          <div className="brand-lockup">
            <span>made by makeit</span>
            <h1>메킷허브 영상 편집기</h1>
            <p>
              안내받은 라이센스 코드를 입력하면 촬영본, 자막, 이미지, 음성, BGM을
              한 화면에서 확인하고 수정할 수 있습니다.
            </p>
          </div>

          <div className="license-form">
            <label>
              라이센스 코드
              <input
                autoFocus
                value={licenseInput}
                placeholder="라이센스 코드를 입력하세요"
                onChange={(event) => setLicenseInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitLicense();
                }}
              />
            </label>
            {licenseError ? <p className="license-error">{licenseError}</p> : null}
            <button className="primary-button" onClick={submitLicense}>
              편집기 열기
            </button>
          </div>

          <div className="cost-note">
            <strong>비용 안내</strong>
            <p>
              이 화면에서 자막을 고치고, 미리보고, 렌더링하는 작업은 내 컴퓨터에서
              실행되므로 OpenAI API 비용이 발생하지 않습니다. 새 대본, 새 이미지, 새 음성을
              다시 생성할 때만 별도 AI/TTS 비용이 생길 수 있습니다.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!timeline) {
    return (
      <main className="loading-screen">
        <div className="loading-card">
          <span>made by makeit</span>
          <h1>메킷허브 영상 편집기를 준비하고 있습니다.</h1>
          <p>{status}</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="editor-shell compact-editor-shell"
      style={{"--editor-font-scale": fontScale} as React.CSSProperties}
    >
      <section className="preview-stage" style={{"--preview-height": `${previewHeight}px`} as React.CSSProperties}>
        <div className="preview-stage-header">
          <div className="preview-title">
            <span className="preview-eyebrow">영상 미리보기</span>
            <h1>메킷허브 영상편집기</h1>
            {jobs.length > 0 && (
              <div className="job-switcher">
                <button
                  type="button"
                  className="job-switcher-current"
                  onClick={() => setJobMenuOpen((v) => !v)}
                  disabled={busy || rendering}
                  title="이전에 만든 다른 영상 작업을 불러옵니다"
                >
                  <span className="job-switcher-eyebrow">지금 편집 중인 영상</span>
                  <span className="job-switcher-name">
                    {(() => {
                      const cur = jobs.find((j) => j.jobId === currentJobId);
                      return cur ? (cur.productNo ? cur.productNo + " - " : "") + cur.productName : currentJobId || "작업 없음";
                    })()}
                    <span className="job-switcher-caret">▾</span>
                  </span>
                </button>
                {jobMenuOpen && (
                  <ul className="job-list">
                    {jobs.map((job) => (
                      <li key={job.jobId}>
                        <button
                          type="button"
                          className={"job-list-item" + (job.jobId === currentJobId ? " is-current" : "")}
                          onClick={() => { setJobMenuOpen(false); void switchJob(job.jobId); }}
                        >
                          {(job.productNo ? job.productNo + " - " : "") + job.productName}
                          {job.hasOutput ? " ✓" : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="preview-control-stack">
            <label className="compact-range-control">
              <span>영상 크기</span>
              <input
                className="preview-size-slider"
                type="range"
                min={PREVIEW_SCALE_MIN}
                max={PREVIEW_SCALE_MAX}
                step="1"
                value={previewScale}
                aria-label="영상 미리보기 크기"
                style={{"--preview-size-progress": `${previewSizeProgress}%`} as React.CSSProperties}
                onChange={(event) => setPreviewScale(Number(event.target.value))}
              />
            </label>
            <label className="compact-range-control">
              <span>글씨 크기</span>
              <input
                className="font-size-slider"
                type="range"
                min={FONT_SCALE_MIN}
                max={FONT_SCALE_MAX}
                step="0.01"
                value={fontScale}
                aria-label="편집기 글씨 크기"
                style={{"--font-size-progress": `${fontSizeProgress}%`} as React.CSSProperties}
                onChange={(event) => setFontScale(Number(event.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="preview-stage-body">
          <div className="video-frame" data-playing={isPlaying ? "true" : "false"}>
            <Player
              ref={playerRef}
              component={ShoppingShorts as React.FC<Record<string, unknown>>}
              inputProps={timeline as unknown as Record<string, unknown>}
              durationInFrames={durationInFrames}
              compositionWidth={1080}
              compositionHeight={1920}
              fps={fps}
              controls
              acknowledgeRemotionLicense
              clickToPlay={false}
              spaceKeyToPlayOrPause={false}
              loop
              style={{
                width: "100%",
                aspectRatio: "9 / 16",
                borderRadius: 8,
                overflow: "hidden",
                backgroundColor: "#050505",
              }}
            />
          </div>
        </div>

        <div className="preview-stage-footer">
          <div className="preview-scrub-area">
            <div className="preview-time-row">
              <strong>{formatClock(currentSec)}</strong>
              <span>{formatClock(timeline.durationSec)}</span>
            </div>
            <input
              className="preview-scrubber"
              type="range"
              min="0"
              max={timeline.durationSec}
              step="0.01"
              value={Math.min(currentSec, timeline.durationSec)}
              aria-label="미리보기 재생 위치"
              style={{"--preview-progress": `${previewProgress}%`} as React.CSSProperties}
              onChange={(event) => seekToSec(Number(event.target.value))}
            />
            <p className="preview-status">{status}</p>
          </div>

          <div className="preview-actions">
            <button className="ghost-button" onClick={resetTimeline} disabled={busy || rendering}>
              원본 복구
            </button>
            <button className="primary-button" onClick={() => void saveTimeline()} disabled={busy || rendering}>
              {busy ? "저장 중" : "저장"}
            </button>
            <button className="render-button" onClick={renderVideo} disabled={busy || rendering}>
              {rendering ? "영상 다시 제작 중" : "수정한 영상 다시 제작하기"}
            </button>
          </div>
        </div>
      </section>

      <section className="timeline-workbench" aria-label="하단 타임라인 편집">
        <TimelineBoard
          tracks={timelineTracks}
          durationSec={timeline.durationSec}
          currentSec={currentSec}
          selectedItemId={selectedTimelineId}
          editorMode={editorMode}
          onCutItem={splitItemAt}
          lockedTracks={lockedTracks}
          onToggleTrackLock={toggleTrackLock}
          onSelect={focusTimelineItem}
          onSeek={(sec) => seekToSec(sec)}
          zoom={timelineZoom}
          onZoomChange={zoomTimeline}
          onResetZoom={() => zoomTimeline(1)}
          timelineRowHeight={timelineRowHeight}
          timelineScrollHeight={timelineScrollHeight}
          timelineHeightScale={timelineHeightScale}
          timelineHeightProgress={timelineHeightProgress}
          onTimelineHeightChange={setTimelineHeightScale}
          canUndo={history.length > 0}
          canRedo={future.length > 0}
          onUndo={undoTimeline}
          onRedo={redoTimeline}
          onItemTimingChange={updateTimelineItemTiming}
          onBgmVolumeChange={(volume) => updateBackgroundMusic({volume})}
        />
        <div className="output-strip">
          <button
            type="button"
            className={`ghost-button output-toggle-button${editorMode === "select" ? " tool-active" : ""}`}
            onClick={() => setEditorMode("select")}
            title="선택 도구 (단축키 a) — 클릭·드래그로 블록을 고르고 옮깁니다"
          >
            🖱 선택 (a)
          </button>
          <button
            type="button"
            className={`ghost-button output-toggle-button${editorMode === "cut" ? " tool-active" : ""}`}
            onClick={() => setEditorMode("cut")}
            title="커트 도구 (단축키 b) — 클립에서 자를 지점을 클릭합니다"
          >
            ✂ 커트 (b)
          </button>
          <button
            type="button"
            className="ghost-button output-toggle-button"
            onClick={splitSelectedItem}
            disabled={!activeTimelineItem || !["caption", "image", "video"].includes(activeTimelineItem.kind)}
          >
            현재 위치 자르기
          </button>
          <button
            type="button"
            className="ghost-button output-toggle-button"
            onClick={() => {
              void loadTemplates();
              setTemplatePanelOpen((open) => !open);
            }}
          >
            템플릿 {templates.length > 0 ? `${templates.length}개` : "저장"}
          </button>
          <button
            type="button"
            className="ghost-button output-toggle-button"
            onClick={() => {
              void loadOutputs();
              setOutputDrawerOpen((open) => !open);
            }}
          >
            완성 영상 {outputs.length > 0 ? `${outputs.length}개` : "보기"}
          </button>
        </div>
        {templatePanelOpen ? (
          <TemplatePanel
            templates={templates}
            voicePresets={voicePresets}
            onSave={() => void saveCurrentTemplate(false).catch((error) => setFriendlyError(toFriendlyError(error, "템플릿을 저장하지 못했습니다")))}
            onApply={(templateId) =>
              void applyTemplate(templateId).catch((error) => setFriendlyError(toFriendlyError(error, "템플릿을 적용하지 못했습니다")))
            }
            onDelete={(templateId) =>
              void deleteTemplate(templateId).catch((error) => setFriendlyError(toFriendlyError(error, "템플릿을 삭제하지 못했습니다")))
            }
            onRefresh={() => void loadTemplates()}
          />
        ) : null}
        {outputDrawerOpen ? <OutputDrawer outputs={outputs} onRefresh={() => void loadOutputs()} /> : null}
      </section>

      {activeTimelineItem ? (
        <LayerInspector
          item={activeTimelineItem}
          timeline={timeline}
          revisionPrompt={timeline.editorNotes?.revisionPrompts?.[activeTimelineItem.id] || ""}
          voicePresets={voicePresets}
          bgmTracks={bgmTracks}
          onCancel={cancelLayerEdit}
          onApply={applyLayerEdit}
          onCaptionTextChange={updateCaptionText}
          onCaptionChange={updateCaption}
          onCaptionStyleChange={updateCaptionStyle}
          onCaptionStylePresetChange={updateCaptionStylePreset}
          onImageChange={updateImageOverlay}
          onSceneChange={updateScene}
          onThumbnailChange={updateThumbnail}
          onBackgroundMusicChange={updateBackgroundMusic}
          onAudioChange={updateAudioSettings}
          onVisualFilterChange={updateVisualFilter}
          onSplit={splitSelectedItem}
          onDuplicate={duplicateTimelineItem}
          onDelete={deleteTimelineItem}
          onRevisionPromptChange={(prompt) => updateRevisionPrompt(activeTimelineItem.id, prompt)}
          onSeek={seekToSec}
        />
      ) : null}

      {toolFlash ? (
        <div className={`tool-flash ${toolFlash}`} aria-hidden="true">
          <span className="tool-flash-icon">{toolFlash === "cut" ? "✂" : "🖱"}</span>
          <span className="tool-flash-label">{toolFlash === "cut" ? "커트" : "선택"}</span>
          {toolFlash === "cut" ? (
            <span className="tool-flash-hint">
              자막 · 이미지 · BGM만 자를 수 있어요
              <br />
              (원본 영상 · 음성은 자동이라 못 건드려요)
            </span>
          ) : null}
        </div>
      ) : null}

      {friendlyError ? (
        <FriendlyErrorModal
          error={friendlyError}
          onClose={() => setFriendlyError(null)}
        />
      ) : null}

      {voiceDecisionOpen ? (
        <VoiceDecisionModal
          onClose={() => setVoiceDecisionOpen(false)}
          onKeepVoice={() => {
            setVoiceDecisionOpen(false);
            openExportDialog("keep");
          }}
          onRequestVoice={() => {
            setVoiceDecisionOpen(false);
            openExportDialog("request");
          }}
        />
      ) : null}

      {exportDialogOpen ? (
        <ExportQualityModal
          voiceMode={pendingVoiceMode}
          quality={exportQuality}
          onQualityChange={setExportQuality}
          onClose={() => setExportDialogOpen(false)}
          onStart={() => void runRenderVideo(pendingVoiceMode, exportQuality)}
        />
      ) : null}

      {renderJob ? (
        <RenderProgressModal
          job={renderJob}
          onShowOutputs={() => {
            setOutputDrawerOpen(true);
            setRenderJob(null);
          }}
          onClose={() => setRenderJob(null)}
        />
      ) : null}
    </main>
  );
}

function LayerInspector({
  item,
  timeline,
  revisionPrompt,
  voicePresets,
  bgmTracks,
  onCancel,
  onApply,
  onCaptionTextChange,
  onCaptionChange,
  onCaptionStyleChange,
  onCaptionStylePresetChange,
  onImageChange,
  onSceneChange,
  onThumbnailChange,
  onBackgroundMusicChange,
  onAudioChange,
  onVisualFilterChange,
  onSplit,
  onDuplicate,
  onDelete,
  onRevisionPromptChange,
  onSeek,
}: {
  item: TimelineItem;
  timeline: Timeline;
  revisionPrompt: string;
  voicePresets: VoicePreset[];
  bgmTracks: BgmTrack[];
  onCancel: () => void;
  onApply: () => void;
  onCaptionTextChange: (index: number, text: string) => void;
  onCaptionChange: (index: number, patch: Partial<Caption>) => void;
  onCaptionStyleChange: (patch: Partial<CaptionStyle>) => void;
  onCaptionStylePresetChange: (index: number, presetId: CaptionStylePresetId, applyToAll: boolean) => void;
  onImageChange: (index: number, patch: Partial<ImageOverlay>) => void;
  onSceneChange: (index: number, patch: Partial<Scene>) => void;
  onThumbnailChange: (patch: Partial<Timeline["thumbnailTail"]>) => void;
  onBackgroundMusicChange: (patch: Partial<NonNullable<Timeline["backgroundMusic"]>>) => void;
  onAudioChange: (patch: Partial<NonNullable<Timeline["audio"]>>) => void;
  onVisualFilterChange: (visualFilter: NonNullable<Timeline["visualFilter"]>) => void;
  onSplit: () => void;
  onDuplicate: (item: TimelineItem) => void;
  onDelete: (item: TimelineItem) => void;
  onRevisionPromptChange: (prompt: string) => void;
  onSeek: (sec: number) => void;
}) {
  const caption = item.kind === "caption" && typeof item.index === "number" ? timeline.captions[item.index] : null;
  const image = item.kind === "image" && typeof item.index === "number" ? timeline.imageOverlays?.[item.index] : null;
  const scene = item.kind === "video" && typeof item.index === "number" ? timeline.scenes?.[item.index] : null;
  const audio =
    item.kind === "audio" && typeof item.index === "number"
      ? timeline.audio?.segments?.find((segment) => segment.index === item.index)
      : null;
  const [applyCaptionStyleToAll, setApplyCaptionStyleToAll] = useState(false);
  useEffect(() => {
    setApplyCaptionStyleToAll(false);
  }, [item.id]);
  const activeCaptionStyle = caption?.stylePresetId || timeline.captionStyle?.presetId || "black-box";
  const activeVoicePreset = timeline.audio?.presetId || "lively-reaction";

  return (
    <div className="layer-modal-backdrop" role="dialog" aria-modal="true" aria-label="선택한 레이어 편집">
    <aside className={`layer-inspector layer-modal ${item.kind}`} aria-label="선택한 레이어 편집">
      <div className="layer-inspector-header">
        <div>
          <span>선택한 레이어</span>
          <h2>{item.label}</h2>
          <p>
            {formatClock(item.startSec)} - {formatClock(item.endSec)} · {item.kind.toUpperCase()}
          </p>
        </div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="레이어 편집 닫기">
          ×
        </button>
      </div>

      <div className="layer-inspector-actions">
        <button type="button" className="mini-button" onClick={() => onSeek(item.startSec)}>
          이 구간 보기
        </button>
        <span>타임라인에서 드래그하면 시작/종료 시간이 바로 바뀝니다.</span>
      </div>

      {caption && typeof item.index === "number" ? (
        <div className="layer-form-grid">
          <label>
            시작
            <input
              type="number"
              step="0.01"
              value={caption.startSec}
              onChange={(event) =>
                onCaptionChange(item.index as number, {
                  startSec: numberOrFallback(event.target.value, caption.startSec),
                })
              }
            />
          </label>
          <label>
            종료
            <input
              type="number"
              step="0.01"
              value={caption.endSec}
              onChange={(event) =>
                onCaptionChange(item.index as number, {
                  endSec: numberOrFallback(event.target.value, caption.endSec),
                })
              }
            />
          </label>
          <label>
            자막 종류
            <select
              value={caption.variant || "caption"}
              onChange={(event) =>
                onCaptionChange(item.index as number, {variant: event.target.value as Caption["variant"]})
              }
            >
              <option value="caption">일반 자막</option>
              <option value="cta">CTA</option>
            </select>
          </label>
          <label>
            자막 움직임
            <select
              value={timeline.captionStyle?.animation || "rise"}
              onChange={(event) => onCaptionStyleChange({animation: event.target.value as CaptionStyle["animation"]})}
            >
              <option value="none">움직임 없음</option>
              <option value="rise">톡 올라오기</option>
              <option value="pop">살짝 확대</option>
              <option value="shake">강조 흔들림</option>
            </select>
          </label>
          <label className="layer-full">
            자막 문구
            <textarea
              rows={4}
              value={caption.text}
              onChange={(event) => onCaptionTextChange(item.index as number, event.target.value)}
            />
          </label>
          <div className="layer-full preset-section">
            <div className="preset-section-heading">
              <strong>자막 모양</strong>
              <label className="preset-apply-all">
                <input
                  type="checkbox"
                  checked={applyCaptionStyleToAll}
                  onChange={(event) => setApplyCaptionStyleToAll(event.target.checked)}
                />
                전체 자막 적용
              </label>
            </div>
            <p className="preset-section-help">
              {applyCaptionStyleToAll
                ? "체크되어 있어서 아래 모양을 누르면 모든 자막에 적용됩니다."
                : "체크가 꺼져 있어서 지금 선택한 자막에만 적용됩니다."}
            </p>
            <div className="caption-style-grid">
              {CAPTION_STYLE_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className={`caption-style-card ${preset.id} ${activeCaptionStyle === preset.id ? "active" : ""}`}
                  onClick={() => onCaptionStylePresetChange(item.index as number, preset.id, applyCaptionStyleToAll)}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.sample}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="layer-note">
            자막 문구를 바꾸면 영상 제작 버튼을 눌렀을 때 음성도 새로 만들지 한 번만 확인합니다.
          </p>
        </div>
      ) : null}

      {image && typeof item.index === "number" ? (
        <div className="layer-form-grid">
          <img className="layer-preview-image" src={`/${image.src}`} alt="" />
          <label>
            시작
            <input
              type="number"
              step="0.1"
              value={image.startSec}
              onChange={(event) =>
                onImageChange(item.index as number, {
                  startSec: numberOrFallback(event.target.value, image.startSec),
                })
              }
            />
          </label>
          <label>
            종료
            <input
              type="number"
              step="0.1"
              value={image.endSec}
              onChange={(event) =>
                onImageChange(item.index as number, {
                  endSec: numberOrFallback(event.target.value, image.endSec),
                })
              }
            />
          </label>
          <label>
            맞춤 방식
            <select
              value={image.fit || "cover"}
              onChange={(event) => onImageChange(item.index as number, {fit: event.target.value as ImageOverlay["fit"]})}
            >
              <option value="cover">화면 꽉 채우기</option>
              <option value="contain">전체 보이기</option>
            </select>
          </label>
          <label>
            전환 효과
            <select
              value={image.transition || "slow-zoom"}
              onChange={(event) =>
                onImageChange(item.index as number, {transition: event.target.value as ImageOverlay["transition"]})
              }
            >
              <option value="none">없음</option>
              <option value="soft-fade">부드럽게</option>
              <option value="slow-zoom">천천히 확대</option>
              <option value="blur">흐림</option>
            </select>
          </label>
          <label className="layer-full">
            이미지 수정 요청 메모
            <textarea
              rows={3}
              value={revisionPrompt}
              placeholder="예: 배경을 더 밝게, 제품이 더 크게 보이게, 손 움직임을 줄이기"
              onChange={(event) => onRevisionPromptChange(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {scene && typeof item.index === "number" ? (
        <div className="layer-form-grid">
          <label>
            시작
            <input
              type="number"
              step="0.1"
              value={scene.startSec ?? item.startSec}
              onChange={(event) =>
                onSceneChange(item.index as number, {
                  startSec: numberOrFallback(event.target.value, scene.startSec ?? item.startSec),
                })
              }
            />
          </label>
          <label>
            종료
            <input
              type="number"
              step="0.1"
              value={scene.endSec ?? item.endSec}
              onChange={(event) =>
                onSceneChange(item.index as number, {
                  endSec: numberOrFallback(event.target.value, scene.endSec ?? item.endSec),
                })
              }
            />
          </label>
          <label className="layer-full">
            전체 화면 느낌
            <select
              value={timeline.visualFilter || "basic"}
              onChange={(event) => onVisualFilterChange(event.target.value as NonNullable<Timeline["visualFilter"]>)}
            >
              <option value="basic">기본</option>
              <option value="bright">밝게</option>
              <option value="warm">따뜻하게</option>
              <option value="sharp">선명하게</option>
              <option value="cinematic">시네마틱</option>
            </select>
          </label>
          <label className="layer-full">
            원본 영상 수정 요청 메모
            <textarea
              rows={3}
              value={revisionPrompt}
              placeholder="예: 이 구간은 0.5초만 더 짧게, 제품을 잡는 장면 위주로, 흔들림 적은 컷으로"
              onChange={(event) => onRevisionPromptChange(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {audio ? (
        <div className="layer-form-grid">
          <label className="layer-full">
            음성 문장
            <textarea rows={3} value={audio.text} readOnly />
          </label>
          <p className="layer-note">
            음성은 1.2배속 리액션 톤으로 자동 생성됩니다. (목소리 선택 기능은 사용하지 않습니다)
          </p>
        </div>
      ) : null}

      {item.kind === "bgm" ? (
        <div className="layer-form-grid">
          <label>
            BGM 볼륨
            <input
              type="range"
              min="0"
              max="0.3"
              step="0.005"
              value={timeline.backgroundMusic?.volume ?? 0}
              onChange={(event) => onBackgroundMusicChange({volume: Number(event.target.value)})}
            />
          </label>
          <label>
            BGM 곡 선택
            <select
              value={timeline.backgroundMusic?.src || ""}
              onChange={(event) => {
                const src = event.target.value;
                if (!src) {
                  onBackgroundMusicChange({src: "", title: ""});
                  return;
                }
                const track = bgmTracks.find((t) => t.src === src);
                onBackgroundMusicChange({src, title: track?.title || ""});
              }}
            >
              <option value="">BGM 없음</option>
              {bgmTracks.map((track) => (
                <option key={track.src} value={track.src}>
                  {track.title}
                </option>
              ))}
            </select>
          </label>
          {timeline.backgroundMusic?.src ? (
            <audio
              controls
              src={`/public/${timeline.backgroundMusic.src}`}
              style={{width: "100%", marginTop: 4}}
            />
          ) : null}
          {bgmTracks.length === 0 ? (
            <p className="layer-note">
              public/bgm 폴더에 음원(mp3)을 넣으면 여기 목록에 나타납니다. (README_BGM_넣는법.txt 참고)
            </p>
          ) : null}
          <label className="layer-checkbox">
            <input
              type="checkbox"
              checked={Boolean(timeline.backgroundMusic?.fadeInSec)}
              onChange={(event) => onBackgroundMusicChange({fadeInSec: event.target.checked ? 1 : 0})}
            />
            처음에 부드럽게 시작
          </label>
          <label className="layer-checkbox">
            <input
              type="checkbox"
              checked={Boolean(timeline.backgroundMusic?.fadeOutSec)}
              onChange={(event) => onBackgroundMusicChange({fadeOutSec: event.target.checked ? 1 : 0})}
            />
            끝에 부드럽게 줄이기
          </label>
          <p className="layer-note">
            타임라인의 BGM 블록 안 가로선을 위아래로 드래그해도 볼륨이 바로 바뀝니다.
          </p>
        </div>
      ) : null}

      {item.kind === "thumbnail" ? (
        <div className="layer-form-grid">
          <label className="layer-full">
            썸네일 문구
            <textarea
              rows={3}
              value={timeline.thumbnailTail.headline ?? timeline.thumbnailTail.text ?? ""}
              onChange={(event) => onThumbnailChange({headline: event.target.value})}
            />
          </label>
          <label>
            표시 시간
            <input
              type="number"
              min="0.2"
              max="2"
              step="0.1"
              value={timeline.thumbnailTail.durationSec}
              onChange={(event) =>
                onThumbnailChange({
                  durationSec: numberOrFallback(event.target.value, timeline.thumbnailTail.durationSec),
                })
              }
            />
          </label>
        </div>
      ) : null}

      <div className="layer-modal-footer">
        {["caption", "image", "video"].includes(item.kind) ? (
          <button type="button" className="ghost-button layer-modal-button" onClick={onSplit}>
            자르기
          </button>
        ) : null}
        {["caption", "image", "video"].includes(item.kind) ? (
          <button type="button" className="ghost-button layer-modal-button" onClick={() => onDuplicate(item)}>
            복사
          </button>
        ) : null}
        {["caption", "image", "video", "bgm"].includes(item.kind) ? (
          <button type="button" className="ghost-button layer-modal-button danger" onClick={() => onDelete(item)}>
            {item.kind === "bgm" ? "BGM 끄기" : "삭제"}
          </button>
        ) : null}
        <button type="button" className="ghost-button layer-modal-button" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="primary-button layer-modal-button" onClick={onApply}>
          적용
        </button>
      </div>
    </aside>
    </div>
  );
}

function FriendlyErrorModal({error, onClose}: {error: FriendlyError; onClose: () => void}) {
  return (
    <div className="modal-backdrop friendly-error-backdrop" role="dialog" aria-modal="true" aria-label={error.title}>
      <section className="friendly-error-modal">
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <span>문제가 생겼습니다</span>
        <h2>{error.title}</h2>
        <p>{error.message}</p>
        <div className="friendly-error-actions">
          {error.actionLabel && error.onAction ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                onClose();
                error.onAction?.();
              }}
            >
              {error.actionLabel}
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={onClose}>
            확인
          </button>
        </div>
      </section>
    </div>
  );
}

function VoiceDecisionModal({
  onClose,
  onKeepVoice,
  onRequestVoice,
}: {
  onClose: () => void;
  onKeepVoice: () => void;
  onRequestVoice: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="음성 재생성 확인">
      <section className="voice-modal">
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <span>음성 확인</span>
        <h2>자막을 바꿨습니다. 음성도 새로 만들까요?</h2>
        <p>
          자막과 음성을 맞추려면 새 음성이 필요합니다. 비용이 생길 수 있으니 모든 수정을 끝낸 뒤 한 번만 누르는 것이 좋습니다.
        </p>
        <div className="voice-modal-actions">
          <button type="button" className="ghost-button" onClick={onKeepVoice}>
            음성은 그대로 쓰기
          </button>
          <button type="button" className="render-button" onClick={onRequestVoice}>
            음성도 새로 만들기
          </button>
        </div>
      </section>
    </div>
  );
}

function ExportQualityModal({
  voiceMode,
  quality,
  onQualityChange,
  onClose,
  onStart,
}: {
  voiceMode: RenderVoiceMode;
  quality: ExportQuality;
  onQualityChange: (quality: ExportQuality) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="영상 제작 선택">
      <section className="export-modal">
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <span>영상 제작</span>
        <h2>{voiceMode === "request" ? "새 음성과 함께 영상을 만들까요?" : "영상을 어떤 방식으로 만들까요?"}</h2>
        <p>
          {voiceMode === "request"
            ? "바꾼 자막에 맞춰 새 음성을 만든 뒤 영상을 제작합니다. 모든 수정을 마친 뒤 한 번만 시작해주세요."
            : "확인용은 빠르게 만들고, 업로드할 영상은 고화질 제작을 선택하면 됩니다."}
        </p>
        <div className="export-quality-grid">
          <button
            type="button"
            className={`export-quality-card ${quality === "fast" ? "active" : ""}`}
            onClick={() => onQualityChange("fast")}
          >
            <strong>빠른 제작</strong>
            <span>확인용 영상을 빠르게 만듭니다</span>
          </button>
          <button
            type="button"
            className={`export-quality-card ${quality === "high" ? "active" : ""}`}
            onClick={() => onQualityChange("high")}
          >
            <strong>고화질 제작</strong>
            <span>최종 업로드용으로 만듭니다</span>
          </button>
        </div>
        <div className="voice-modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            취소
          </button>
          <button type="button" className="render-button" onClick={onStart}>
            제작 시작
          </button>
        </div>
      </section>
    </div>
  );
}

function RenderProgressModal({
  job,
  onShowOutputs,
  onClose,
}: {
  job: RenderJobStatus;
  onShowOutputs: () => void;
  onClose: () => void;
}) {
  const done = job.status === "done";
  const failed = job.status === "error";
  const progress = clamp(Number(job.progress || 0), 0, 100);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="영상 제작 진행">
      <section className="render-progress-modal">
        {done || failed ? (
          <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        ) : null}
        <span>{done ? "완성" : failed ? "문제 발생" : "제작 중"}</span>
        <h2>{done ? "영상이 완성되었습니다" : failed ? "영상을 만들지 못했습니다" : "영상을 만들고 있습니다"}</h2>
        <p>{job.message || "잠시만 기다려주세요."}</p>
        <div className="render-progress-track" aria-label="영상 제작 진행률">
          <i style={{width: `${progress}%`}} />
        </div>
        <strong className="render-progress-percent">{Math.round(progress)}%</strong>
        {done ? (
          <div className="voice-modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              닫기
            </button>
            <button type="button" className="render-button" onClick={onShowOutputs}>
              완성 영상 보기
            </button>
          </div>
        ) : null}
        {failed ? (
          <div className="voice-modal-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              확인
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function OutputDrawer({outputs, onRefresh}: {outputs: OutputItem[]; onRefresh: () => void}) {
  return (
    <section className="output-drawer" aria-label="완성 영상 보관함">
      <div className="output-drawer-header">
        <div>
          <span>완성 영상</span>
          <h2>결과물 보관함</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onRefresh}>
          새로고침
        </button>
      </div>
      {outputs.length === 0 ? (
        <p className="output-empty">아직 완성된 영상이 없습니다. 제작이 끝나면 여기에 표시됩니다.</p>
      ) : (
        <div className="output-list">
          {outputs.map((output) => (
            <article className="output-item" key={output.file}>
              <div>
                <strong>{output.file}</strong>
                <span>
                  {formatOutputDate(output.createdAt)} · {output.sizeMb.toFixed(1)}MB
                </span>
              </div>
              <a className="primary-button" href={output.url} target="_blank" rel="noreferrer">
                보기
              </a>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TemplatePanel({
  templates,
  voicePresets,
  onSave,
  onApply,
  onDelete,
  onRefresh,
}: {
  templates: EditorTemplate[];
  voicePresets: VoicePreset[];
  onSave: () => void;
  onApply: (templateId: string) => void;
  onDelete: (templateId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="template-panel" aria-label="템플릿 보관함">
      <div className="output-drawer-header">
        <div>
          <span>템플릿</span>
          <h2>자주 쓰는 설정</h2>
        </div>
        <div className="template-actions">
          <button type="button" className="ghost-button" onClick={onRefresh}>
            새로고침
          </button>
          <button type="button" className="primary-button" onClick={onSave}>
            현재 설정 저장
          </button>
        </div>
      </div>
      {templates.length === 0 ? (
        <p className="output-empty">저장된 템플릿이 없습니다. 마음에 드는 자막 모양, 목소리, BGM 설정을 저장해두세요.</p>
      ) : (
        <div className="template-list">
          {templates.map((template) => (
            <article className="template-item" key={template.id}>
              <div>
                <strong>{template.name}</strong>
                <span>{formatOutputDate(template.updatedAt)}</span>
              </div>
              <div className="template-summary">
                <span>자막 {captionStyleLabel(template.data?.captionStyle?.presetId)}</span>
                <span>목소리 {voicePresetLabel(voicePresets, template.data?.audioPresetId)}</span>
                <span>BGM {Math.round((template.data?.backgroundMusic?.volume ?? 0) * 100)}%</span>
              </div>
              <div className="template-item-actions">
                <button type="button" className="primary-button" onClick={() => onApply(template.id)}>
                  이 템플릿 쓰기
                </button>
                {template.id !== "recent-settings" ? (
                  <button type="button" className="ghost-button" onClick={() => onDelete(template.id)}>
                    삭제
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineBoard({
  tracks,
  durationSec,
  currentSec,
  editorMode,
  onCutItem,
  lockedTracks,
  onToggleTrackLock,
  onSelect,
  onSeek,
  selectedItemId,
  zoom,
  onZoomChange,
  onResetZoom,
  timelineRowHeight,
  timelineScrollHeight,
  timelineHeightScale,
  timelineHeightProgress,
  onTimelineHeightChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onItemTimingChange,
  onBgmVolumeChange,
}: {
  tracks: TimelineTrack[];
  durationSec: number;
  currentSec: number;
  selectedItemId: string | null;
  editorMode: "select" | "cut";
  onCutItem: (item: TimelineItem, sec: number) => void;
  lockedTracks: Set<string>;
  onToggleTrackLock: (trackId: string) => void;
  onSelect: (item: TimelineItem) => void;
  onSeek: (sec: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onResetZoom: () => void;
  timelineRowHeight: number;
  timelineScrollHeight: number;
  timelineHeightScale: number;
  timelineHeightProgress: number;
  onTimelineHeightChange: (scale: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onItemTimingChange: (item: TimelineItem, timing: TimelineItemTiming) => void;
  onBgmVolumeChange: (volume: number) => void;
}) {
  const dragRef = useRef<{
    item: TimelineItem;
    mode: "move" | "resize-start" | "resize-end" | "volume";
    startX: number;
    startY: number;
    laneRect: DOMRect;
    itemRect: DOMRect;
    startSec: number;
    endSec: number;
    hasMoved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [cutHover, setCutHover] = useState<{trackId: string; pct: number} | null>(null);

  const markers = useMemo(() => {
    const values = [];
    for (let second = 0; second <= durationSec; second += 5) values.push(second);
    if (!values.includes(durationSec)) values.push(durationSec);
    return values;
  }, [durationSec]);
  const cursorLeft = clamp((currentSec / Math.max(durationSec, 1)) * 100, 0, 100);
  const zoomProgress = clamp(((zoom - 0.5) / (3 - 0.5)) * 100, 0, 100);

  const getSnapCandidate = (value: number, item: TimelineItem) => {
    const candidates = [0, durationSec, currentSec];
    tracks.forEach((track) => {
      track.items.forEach((candidate) => {
        if (candidate.id === item.id) return;
        candidates.push(candidate.startSec, candidate.endSec);
      });
    });

    const threshold = 0.3;
    const nearest = candidates.reduce(
      (best, candidate) => {
        const distance = Math.abs(candidate - value);
        return distance < best.distance ? {value: candidate, distance} : best;
      },
      {value, distance: Number.POSITIVE_INFINITY},
    );
    return nearest.distance <= threshold ? nearest : {value, distance: Number.POSITIVE_INFINITY};
  };

  const beginTimelineDrag = (
    event: React.PointerEvent<HTMLElement>,
    item: TimelineItem,
    mode: "move" | "resize-start" | "resize-end" | "volume",
  ) => {
    if (lockedTracks.has(item.kind)) return;
    const laneElement = (event.currentTarget as HTMLElement).closest(".track-lane") as HTMLElement | null;
    const itemElement = (event.currentTarget as HTMLElement).closest(".timeline-item") as HTMLElement | null;
    if (!laneElement || !itemElement) return;
    event.preventDefault();
    event.stopPropagation();
    onSeek(item.startSec);
    dragRef.current = {
      item,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      laneRect: laneElement.getBoundingClientRect(),
      itemRect: itemElement.getBoundingClientRect(),
      startSec: item.startSec,
      endSec: item.endSec,
      hasMoved: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const moveDistance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
      if (!drag.hasMoved && moveDistance < 4) return;
      if (!drag.hasMoved) {
        drag.hasMoved = true;
        setDraggingItemId(drag.item.id);
      }

      if (drag.mode === "volume") {
        const ratio = clamp((drag.itemRect.bottom - moveEvent.clientY) / Math.max(drag.itemRect.height, 1), 0, 1);
        onBgmVolumeChange(roundTime(ratio * 0.3));
        onSeek(drag.item.startSec);
        return;
      }

      const deltaSec = ((moveEvent.clientX - drag.startX) / Math.max(drag.laneRect.width, 1)) * durationSec;
      const originalDuration = Math.max(drag.endSec - drag.startSec, 0.18);
      let nextStart = drag.startSec;
      let nextEnd = drag.endSec;

      if (drag.mode === "move") {
        nextStart = clamp(drag.startSec + deltaSec, 0, durationSec - originalDuration);
        nextEnd = nextStart + originalDuration;
        const startSnap = getSnapCandidate(nextStart, drag.item);
        const endSnap = getSnapCandidate(nextEnd, drag.item);
        if (endSnap.distance < startSnap.distance) {
          nextEnd = endSnap.value;
          nextStart = clamp(nextEnd - originalDuration, 0, durationSec - originalDuration);
        } else {
          nextStart = startSnap.value;
          nextEnd = nextStart + originalDuration;
        }
        nextStart = clamp(nextStart, 0, durationSec - originalDuration);
        nextEnd = nextStart + originalDuration;
      }

      if (drag.mode === "resize-start") {
        nextStart = clamp(drag.startSec + deltaSec, 0, drag.endSec - 0.18);
        nextStart = getSnapCandidate(nextStart, drag.item).value;
        nextStart = clamp(nextStart, 0, drag.endSec - 0.18);
      }

      if (drag.mode === "resize-end") {
        nextEnd = clamp(drag.endSec + deltaSec, drag.startSec + 0.18, durationSec);
        nextEnd = getSnapCandidate(nextEnd, drag.item).value;
        nextEnd = clamp(nextEnd, drag.startSec + 0.18, durationSec);
      }

      const roundedStart = roundTime(nextStart);
      const roundedEnd = roundTime(nextEnd);
      onItemTimingChange(drag.item, {
        startSec: roundedStart,
        endSec: roundedEnd,
      });
      onSeek(drag.mode === "resize-end" ? roundedEnd : roundedStart);
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (drag?.hasMoved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      dragRef.current = null;
      setDraggingItemId(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const seekFromPointer = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    onSeek(ratio * durationSec);
  };

  const updateTimelineHeightFromPointer = (clientY: number, rect: DOMRect) => {
    const ratio = clamp((rect.bottom - clientY) / Math.max(rect.height, 1), 0, 1);
    const nextScale =
      TIMELINE_HEIGHT_SCALE_MIN + ratio * (TIMELINE_HEIGHT_SCALE_MAX - TIMELINE_HEIGHT_SCALE_MIN);
    onTimelineHeightChange(Math.round(nextScale));
  };

  const beginTimelineHeightDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const sliderRect = event.currentTarget.getBoundingClientRect();
    updateTimelineHeightFromPointer(event.clientY, sliderRect);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTimelineHeightFromPointer(moveEvent.clientY, sliderRect);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleTimelineHeightKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 2;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      onTimelineHeightChange(clamp(timelineHeightScale + step, TIMELINE_HEIGHT_SCALE_MIN, TIMELINE_HEIGHT_SCALE_MAX));
    }
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      onTimelineHeightChange(clamp(timelineHeightScale - step, TIMELINE_HEIGHT_SCALE_MIN, TIMELINE_HEIGHT_SCALE_MAX));
    }
    if (event.key === "Home") {
      event.preventDefault();
      onTimelineHeightChange(TIMELINE_HEIGHT_SCALE_MIN);
    }
    if (event.key === "End") {
      event.preventDefault();
      onTimelineHeightChange(TIMELINE_HEIGHT_SCALE_MAX);
    }
  };

  return (
    <section
      className="timeline-board"
      style={
        {
          "--timeline-row-height": `${timelineRowHeight}px`,
          "--timeline-scroll-height": `${timelineScrollHeight}px`,
        } as React.CSSProperties
      }
    >
      <div className="timeline-header">
        <div>
          <span>Timeline</span>
          <h2>하단 타임라인 편집</h2>
        </div>

      </div>
      <div className="timeline-tools" aria-label="타임라인 확대 축소">
        <div className="timeline-history-controls" aria-label="편집 되돌리기 도구">
          <button
            type="button"
            className="timeline-icon-button"
            onClick={onUndo}
            disabled={!canUndo}
            title="실행 취소 (⌘Z / Ctrl+Z)"
            aria-label="실행 취소"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
          <button
            type="button"
            className="timeline-icon-button"
            onClick={onRedo}
            disabled={!canRedo}
            title="다시 실행 (⌘⇧Z / Ctrl+Shift+Z)"
            aria-label="다시 실행"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 14 5-5-5-5" />
              <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
            </svg>
          </button>
        </div>
        <input
          className="timeline-zoom-slider"
          type="range"
          min="0.5"
          max="3"
          step="0.01"
          value={zoom}
          aria-label="타임라인 확대 축소"
          style={{"--timeline-zoom-progress": `${zoomProgress}%`} as React.CSSProperties}
          onChange={(event) => onZoomChange(Number(event.target.value))}
        />
        <button type="button" onClick={onResetZoom}>기본</button>
      </div>

      <div className="timeline-legend" aria-label="타임라인 색상 안내">
        <span><i className="legend-caption" /> 자막</span>
        <span><i className="legend-image" /> 이미지</span>
        <span><i className="legend-video" /> 원본 영상</span>
        <span><i className="legend-audio" /> 음성</span>
        <span><i className="legend-bgm" /> BGM</span>
        <span><i className="legend-thumbnail" /> 썸네일</span>
      </div>

      <div className="timeline-body-shell">
        <div className="timeline-scroll">
          <div className="timeline-scale" style={{width: `${zoom * 100}%`}}>
            <div className="timeline-ruler" onClick={seekFromPointer}>
              <strong className="playhead-time" style={{left: `${cursorLeft}%`}}>
                {formatClock(currentSec)}
              </strong>
              {markers.map((marker) => {
                const left = clamp((marker / Math.max(durationSec, 1)) * 100, 0, 100);
                return (
                  <span key={marker} style={{left: `${left}%`}}>
                    {formatClock(marker)}
                  </span>
                );
              })}
            </div>

            <div className={`timeline-tracks${editorMode === "cut" ? " cut-mode" : ""}`}>
              {tracks.map((track) => (
                <div className="track-row" key={track.id}>
                  <div className="track-label">
                    <div className="track-label-head">
                      <strong>{track.title}</strong>
                      <button
                        type="button"
                        className={`track-lock-button${lockedTracks.has(track.id) ? " locked" : ""}`}
                        onClick={() => onToggleTrackLock(track.id)}
                        title={lockedTracks.has(track.id) ? "잠금 해제 (편집 가능하게)" : "트랙 잠그기 (실수 편집 방지)"}
                        aria-label={lockedTracks.has(track.id) ? "트랙 잠금 해제" : "트랙 잠그기"}
                      >
                        {lockedTracks.has(track.id) ? "🔒" : "🔓"}
                      </button>
                    </div>
                    <span>{track.hint}</span>
                  </div>
                  <div
                    className="track-lane"
                    onClick={seekFromPointer}
                    onMouseMove={
                      editorMode === "cut"
                        ? (event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setCutHover({
                              trackId: track.id,
                              pct: clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100, 0, 100),
                            });
                          }
                        : undefined
                    }
                    onMouseLeave={editorMode === "cut" ? () => setCutHover(null) : undefined}
                  >
                    <div className="timeline-cursor" style={{left: `${cursorLeft}%`}} />
                    {editorMode === "cut" && cutHover && cutHover.trackId === track.id ? (
                      <div className="cut-guide-line" style={{left: `${cutHover.pct}%`}} />
                    ) : null}
                    {track.items.map((item) => {
                      const left = clamp((item.startSec / Math.max(durationSec, 1)) * 100, 0, 100);
                      const width = clamp(((item.endSec - item.startSec) / Math.max(durationSec, 1)) * 100, 2.8, 100 - left);
                      const canResize = item.kind === "caption" || item.kind === "image" || item.kind === "video" || item.kind === "thumbnail";
                      const volumeTop = 100 - clamp(((item.volume ?? 0) / 0.3) * 100, 7, 92);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`timeline-item ${item.kind} ${selectedItemId === item.id ? "active" : ""} ${
                            draggingItemId === item.id ? "dragging" : ""
                          }`}
                          style={{left: `${left}%`, width: `${width}%`, background: item.accent}}
                          onPointerDown={(event) => beginTimelineDrag(event, item, "move")}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (suppressClickRef.current) return;
                            if (editorMode === "cut") {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
                              onCutItem(item, item.startSec + ratio * (item.endSec - item.startSec));
                              return;
                            }
                            onSelect(item);
                          }}
                          title={`${item.label} ${formatClock(item.startSec)}-${formatClock(item.endSec)}`}
                        >
                          {canResize ? (
                            <>
                              <span
                                className="resize-handle start"
                                onPointerDown={(event) => beginTimelineDrag(event, item, "resize-start")}
                              />
                              <span
                                className="resize-handle end"
                                onPointerDown={(event) => beginTimelineDrag(event, item, "resize-end")}
                              />
                            </>
                          ) : null}
                          <strong>{item.label}</strong>
                          {item.sublabel ? <span>{item.sublabel}</span> : null}
                          {item.kind === "bgm" ? (
                            <span
                              className="volume-line"
                              style={{top: `${volumeTop}%`}}
                              onPointerDown={(event) => beginTimelineDrag(event, item, "volume")}
                            >
                              <i />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <label className="timeline-height-control" title="타임라인 높이 조절">
          <span>높이</span>
          <div
            className="timeline-height-slider"
            role="slider"
            tabIndex={0}
            aria-label="타임라인 높이 조절"
            aria-valuemin={TIMELINE_HEIGHT_SCALE_MIN}
            aria-valuemax={TIMELINE_HEIGHT_SCALE_MAX}
            aria-valuenow={timelineHeightScale}
            style={{"--timeline-height-progress": `${timelineHeightProgress}%`} as React.CSSProperties}
            onPointerDown={beginTimelineHeightDrag}
            onKeyDown={handleTimelineHeightKeyDown}
          >
            <i className="timeline-height-slider-track" />
            <i className="timeline-height-slider-fill" />
            <i className="timeline-height-slider-thumb" />
          </div>
        </label>
      </div>
    </section>
  );
}

function buildTimelineItems(timeline: Timeline): TimelineItem[] {
  const duration = Math.max(timeline.durationSec, 1);
  const items: TimelineItem[] = [];

  timeline.captions.forEach((caption, index) => {
    items.push({
      id: `caption-${index}`,
      label: caption.variant === "cta" ? "CTA" : shortText(caption.text, 18),
      sublabel: `${formatClock(caption.startSec)}-${formatClock(caption.endSec)}`,
      startSec: caption.startSec,
      endSec: Math.max(caption.endSec, caption.startSec + 0.2),
      kind: "caption",
      index,
      accent: caption.variant === "cta" ? "linear-gradient(135deg, #ff7a1a, #ffbd59)" : "linear-gradient(135deg, #e65f45, #ff9673)",
    });
  });

  (timeline.imageOverlays || []).forEach((overlay, index) => {
    items.push({
      id: `image-${index}`,
      label: overlay.imageId ? shortText(overlay.imageId, 18) : `이미지 ${index + 1}`,
      sublabel: `${formatClock(overlay.startSec)}-${formatClock(overlay.endSec)}`,
      startSec: overlay.startSec,
      endSec: Math.max(overlay.endSec, overlay.startSec + 0.4),
      kind: "image",
      index,
      accent: "linear-gradient(135deg, #20d9d2, #0f828f)",
    });
  });

  const videoScenes = (timeline.scenes || [])
    .map((scene, index) => ({scene, index}))
    .filter(
      ({scene}) => scene.source === "source-video" && Number.isFinite(scene.startSec) && Number.isFinite(scene.endSec),
    );
  if (videoScenes.length > 0) {
    videoScenes.forEach(({scene, index}, orderIndex) => {
      const startSec = scene.startSec || 0;
      const endSec = scene.endSec || duration;
      items.push({
        id: `video-${scene.id || index}`,
        label: scene.overlayText ? shortText(scene.overlayText, 18) : `원본 영상 ${orderIndex + 1}`,
        sublabel: `${formatClock(startSec)}-${formatClock(endSec)}`,
        startSec,
        endSec: Math.max(endSec, startSec + 0.4),
        kind: "video",
        index,
        accent: "linear-gradient(135deg, #2c7df7, #1e41b8)",
      });
    });
  } else {
    items.push({
      id: "video-full",
      label: "원본 영상",
      sublabel: "전체 구간",
      startSec: 0,
      endSec: duration,
      kind: "video",
      accent: "linear-gradient(135deg, #2c7df7, #1e41b8)",
    });
  }

  let audioCursor = 0;
  const audioSegments = timeline.audio?.segments || [];
  audioSegments.forEach((segment) => {
    const segmentDuration = Math.max(segment.displayDurationSec || segment.durationSec || 0.4, 0.4);
    items.push({
      id: `audio-${segment.index}`,
      label: shortText(segment.text, 20),
      sublabel: formatSeconds(segmentDuration),
      startSec: audioCursor,
      endSec: Math.min(audioCursor + segmentDuration, duration),
      kind: "audio",
      index: segment.index,
      accent: "linear-gradient(135deg, #936dff, #5232c9)",
    });
    audioCursor += segmentDuration;
  });
  if (audioSegments.length === 0 && timeline.narrationSrc) {
    items.push({
      id: "audio-full",
      label: "나레이션",
      sublabel: "전체 음성",
      startSec: 0,
      endSec: duration,
      kind: "audio",
      accent: "linear-gradient(135deg, #936dff, #5232c9)",
    });
  }

  if (timeline.backgroundMusic?.src) {
    items.push({
      id: "bgm-full",
      label: timeline.backgroundMusic.title || "BGM",
      sublabel: `볼륨 ${timeline.backgroundMusic.volume ?? 0}`,
      startSec: 0,
      endSec: duration,
      kind: "bgm",
      volume: timeline.backgroundMusic.volume ?? 0,
      accent: "linear-gradient(135deg, #0fa86c, #045c46)",
    });
  }

  const thumbnailDuration = Math.max(timeline.thumbnailTail.durationSec || 0.6, 0.2);
  items.push({
    id: "thumbnail-tail",
    label: "마지막 썸네일",
    sublabel: formatSeconds(thumbnailDuration),
    startSec: Math.max(duration - thumbnailDuration, 0),
    endSec: duration,
    kind: "thumbnail",
    accent: "linear-gradient(135deg, #f2c35b, #c56b1f)",
  });

  return items;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
