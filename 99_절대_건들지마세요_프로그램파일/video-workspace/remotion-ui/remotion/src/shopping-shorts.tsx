import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Caption = {
  startSec: number;
  endSec: number;
  text: string;
  emphasis?: boolean;
  variant?: "caption" | "cta";
  stylePresetId?: CaptionStyle["presetId"];
};

type ImageOverlay = {
  startSec: number;
  endSec: number;
  src: string;
  fit?: "cover" | "contain";
  transition?: "none" | "soft-fade" | "slow-zoom" | "blur";
};

type CaptionStyle = {
  presetId?: "default-white" | "black-box" | "yellow-focus" | "shorts-bold" | "cta-focus";
  fontScale?: number;
  position?: "bottom" | "center";
  animation?: "none" | "rise" | "pop" | "shake";
};

type CtaBackground = {
  src: string;
  blurPx?: number;
};

type SecondaryCta = {
  // [항목 7] '네이버링크표시: 끄기' — disabled면 렌더는 이 화면을 그리지 않는다.
  // (끄기 상태의 timeline에는 disabled만 남고 표시 시간이 없어 startSec/endSec가 undefined일 수 있다)
  disabled?: boolean;
  startSec?: number;
  endSec?: number;
  text?: string;
  arrow?: boolean;
};

type BackgroundMusic = {
  src?: string;
  volume?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
};

type SourceClip = {
  index?: number;
  originalName?: string;
  src: string;
  durationSec?: number;
};

type ShoppingShortsProps = {
  videoSrc: string;
  narrationSrc?: string;
  backgroundMusic?: BackgroundMusic;
  productName: string;
  productNo: string;
  durationSec: number;
  sourceDurationSec: number;
  sourceClips?: SourceClip[];
  // [항목 8] 기획안 [05] '영상모두쓰기: 예' → true. 필드가 없으면(기존 timeline) 기존 리듬 컷 그대로.
  useAllClips?: boolean;
  hook: string;
  captions: Caption[];
  captionStyle?: CaptionStyle;
  visualFilter?: "basic" | "bright" | "warm" | "sharp" | "cinematic";
  imageOverlays?: ImageOverlay[];
  adBadge: {
    text: string;
    position: "top-right";
  };
  cta: string;
  secondaryCta?: SecondaryCta;
  ctaBackground?: CtaBackground;
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
};

export const shoppingShortsDefaultProps: ShoppingShortsProps = {
  videoSrc: "jobs/sample/source.mp4",
  narrationSrc: undefined,
  backgroundMusic: undefined,
  productName: "제품명",
  productNo: "000",
  durationSec: 24,
  sourceDurationSec: 23.5,
  sourceClips: [],
  hook: "이거 아직도 아무거나 쓰세요?",
  captions: [],
  imageOverlays: [],
  adBadge: {
    text: "광고",
    position: "top-right",
  },
  cta: "프로필 링크에서 제품번호 확인",
  thumbnailTail: {
    durationSec: 0.5,
    text: "제품번호 000",
  },
};

// 'Noto Sans CJK KR'·'NanumGothic' 은 렌더 컨테이너(리눅스)에 설치되는 실제 폰트 이름이다.
// 이 이름이 없으면 한글 자막이 전부 네모(□)로 렌더된다.
const fontFamily =
  "'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', 'Noto Sans CJK KR', 'NanumGothic', sans-serif";

const captionStylePresets = {
  "default-white": {
    color: "#FFFFFF",
    backgroundColor: "rgba(0, 0, 0, 0.22)",
    boxShadow: "0 8px 26px rgba(0, 0, 0, 0.2)",
    textShadow: "0 5px 18px rgba(0,0,0,0.86)",
    border: "0 solid transparent",
  },
  "black-box": {
    color: "#FFFFFF",
    backgroundColor: "rgba(12, 18, 28, 0.82)",
    boxShadow: "0 8px 26px rgba(0, 0, 0, 0.26)",
    textShadow: "none",
    border: "0 solid transparent",
  },
  "yellow-focus": {
    color: "#171006",
    backgroundColor: "rgba(255, 220, 70, 0.92)",
    boxShadow: "0 10px 30px rgba(255, 202, 40, 0.26)",
    textShadow: "none",
    border: "0 solid transparent",
  },
  "shorts-bold": {
    color: "#FFFFFF",
    backgroundColor: "rgba(255, 112, 94, 0.9)",
    boxShadow: "0 12px 34px rgba(255, 112, 94, 0.3)",
    textShadow: "0 5px 18px rgba(0,0,0,0.42)",
    border: "5px solid rgba(255,255,255,0.86)",
  },
  "cta-focus": {
    color: "#06111a",
    backgroundColor: "rgba(66, 240, 174, 0.92)",
    boxShadow: "0 14px 34px rgba(66, 240, 174, 0.28)",
    textShadow: "none",
    border: "5px solid rgba(255,255,255,0.74)",
  },
} satisfies Record<NonNullable<CaptionStyle["presetId"]>, {
  color: string;
  backgroundColor: string;
  boxShadow: string;
  textShadow: string;
  border: string;
}>;

const secondsToFrame = (seconds: number, fps: number) => Math.round(seconds * fps);

const useActiveCaption = (captions: Caption[]) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const currentSec = frame / fps;
  return captions.find((caption) => currentSec >= caption.startSec && currentSec < caption.endSec);
};

const visualFilterCss = (filter?: ShoppingShortsProps["visualFilter"]) => {
  if (filter === "bright") return "brightness(1.14) saturate(1.06)";
  if (filter === "warm") return "brightness(1.06) saturate(1.12) sepia(0.16)";
  if (filter === "sharp") return "contrast(1.12) saturate(1.16)";
  if (filter === "cinematic") return "contrast(1.18) saturate(0.9) brightness(0.92)";
  return "none";
};

type AutoCut = {
  src: string;
  fromFrame: number;
  durationFrames: number;
  trimBeforeFrame: number;
  trimAfterFrame: number;
  zoomSeed: number;
};

function buildAutoCuts(
  sourceClips: SourceClip[] | undefined,
  fallbackSrc: string,
  durationFrames: number,
  fps: number,
  mode?: "all-clips",
) {
  const clips = (sourceClips || []).filter((clip) => clip?.src);
  if (clips.length < 2 || durationFrames <= 0) return [];

  // [항목 8] 영상모두쓰기 모드: 넣은 클립이 전부, 각자 길이에 비례한 구간으로, 순서대로 1회씩 나온다.
  // 각 클립의 '중앙' 구간을 잘라 앞부분 편중을 없앤다. mode 미지정이면 아래 기존 리듬 컷 로직을
  // 한 글자도 바꾸지 않고 그대로 탄다 (기본 배치의 컷 시점·zoomSeed 불변 — 원칙 1).
  if (mode === "all-clips") {
    const knownDurations = clips.map((clip) => Math.max(0, Number(clip.durationSec || 0)));
    const totalKnownSec = knownDurations.reduce((sum, value) => sum + value, 0);
    const allCuts: AutoCut[] = [];
    let cursorFrame = 0;
    for (let i = 0; i < clips.length; i += 1) {
      const remainingFrames = durationFrames - cursorFrame;
      if (remainingFrames <= 0) break;
      const remainingClips = clips.length - i;
      // 길이 정보가 있으면 전체 길이에 비례해 배분하고, 없으면 남은 구간을 균등 배분한다.
      const share =
        totalKnownSec > 0 && knownDurations[i] > 0
          ? Math.round(durationFrames * (knownDurations[i] / totalKnownSec))
          : Math.round(remainingFrames / remainingClips);
      const cutFrames =
        i === clips.length - 1
          ? remainingFrames // 마지막 클립이 반올림 오차를 흡수해 총 길이를 정확히 채운다
          : Math.max(1, Math.min(share, remainingFrames - (remainingClips - 1))); // 뒤 클립에도 최소 1프레임 보장
      const cutSec = cutFrames / fps;
      const clipDurationSec = knownDurations[i];
      // 클립이 배분 구간보다 길면 중앙 구간을, 짧으면 처음부터 재생한다.
      const trimBeforeSec = clipDurationSec > cutSec ? Math.max(0, (clipDurationSec - cutSec) / 2) : 0;
      const trimBeforeFrame = secondsToFrame(trimBeforeSec, fps);
      allCuts.push({
        src: clips[i].src || fallbackSrc,
        fromFrame: cursorFrame,
        durationFrames: cutFrames,
        trimBeforeFrame,
        trimAfterFrame: trimBeforeFrame + cutFrames,
        zoomSeed: i % 4,
      });
      cursorFrame += cutFrames;
    }
    return allCuts;
  }

  const rhythmSec = [2.1, 1.7, 2.4, 1.9, 2.7, 1.8];
  const cursors = new Map<number, number>();
  const cuts: AutoCut[] = [];
  let fromFrame = 0;
  let rhythmIndex = 0;

  while (fromFrame < durationFrames && rhythmIndex < 80) {
    const clip = clips[rhythmIndex % clips.length];
    const clipDurationSec = Math.max(0, Number(clip.durationSec || 0));
    const targetSec = rhythmSec[rhythmIndex % rhythmSec.length];
    const remainingFrames = durationFrames - fromFrame;
    const cutFrames = Math.max(1, Math.min(secondsToFrame(targetSec, fps), remainingFrames));
    const cutSec = cutFrames / fps;
    const maxStartSec = clipDurationSec > cutSec ? Math.max(0, clipDurationSec - cutSec - 0.1) : 0;
    const clipKey = clip.index ?? rhythmIndex % clips.length;
    const cursorSec = cursors.get(clipKey) ?? 0.15;
    const trimBeforeSec = Math.min(cursorSec, maxStartSec);
    const nextCursorSec = trimBeforeSec + cutSec + 0.35;
    cursors.set(clipKey, nextCursorSec >= maxStartSec ? 0.15 : nextCursorSec);
    const trimBeforeFrame = secondsToFrame(trimBeforeSec, fps);

    cuts.push({
      src: clip.src || fallbackSrc,
      fromFrame,
      durationFrames: cutFrames,
      trimBeforeFrame,
      trimAfterFrame: trimBeforeFrame + cutFrames,
      zoomSeed: rhythmIndex % 4,
    });

    fromFrame += cutFrames;
    rhythmIndex += 1;
  }

  return cuts;
}

const SourceCutVideo: React.FC<{
  cut: AutoCut;
  visualFilter?: ShoppingShortsProps["visualFilter"];
}> = ({cut, visualFilter}) => {
  const frame = useCurrentFrame();
  const fadeFrames = Math.min(5, Math.max(1, Math.floor(cut.durationFrames / 4)));
  const fadeIn = frame < fadeFrames ? 0.82 + (frame / fadeFrames) * 0.18 : 1;
  const fadeOut =
    frame > cut.durationFrames - fadeFrames
      ? 0.94 + Math.max(0, cut.durationFrames - frame) / fadeFrames * 0.06
      : 1;
  const scale = interpolate(frame, [0, cut.durationFrames], [1.018 + cut.zoomSeed * 0.006, 1.042 + cut.zoomSeed * 0.006], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <OffthreadVideo
      src={staticFile(cut.src)}
      muted
      trimBefore={cut.trimBeforeFrame}
      trimAfter={cut.trimAfterFrame}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: Math.min(fadeIn, fadeOut),
        transform: `scale(${scale})`,
        filter: visualFilterCss(visualFilter),
      }}
    />
  );
};

const SourceVideoLayer: React.FC<{
  videoSrc: string;
  sourceClips?: SourceClip[];
  durationFrames: number;
  opacity: number;
  visualFilter?: ShoppingShortsProps["visualFilter"];
  useAllClips?: boolean;
}> = ({videoSrc, sourceClips, durationFrames, opacity, visualFilter, useAllClips}) => {
  const {fps} = useVideoConfig();
  // [항목 8] useAllClips가 true일 때만 새 배치(mode)로 — 아니면 기존 호출과 완전히 동일하다.
  const cuts = buildAutoCuts(sourceClips, videoSrc, durationFrames, fps, useAllClips ? "all-clips" : undefined);

  if (cuts.length === 0) {
    return (
      <OffthreadVideo
        src={staticFile(videoSrc)}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity,
          filter: visualFilterCss(visualFilter),
        }}
      />
    );
  }

  return (
    <AbsoluteFill style={{opacity}}>
      {cuts.map((cut, index) => (
        <Sequence key={`${cut.src}-${index}`} from={cut.fromFrame} durationInFrames={cut.durationFrames}>
          <SourceCutVideo cut={cut} visualFilter={visualFilter} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const AdBadge: React.FC<{text?: string}> = ({text}) => {
  const lines = String(text || "광고")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        right: 42,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        padding: lines.length > 1 ? "9px 14px 8px" : "8px 15px 7px",
        borderRadius: 4,
        backgroundColor: "rgba(0, 0, 0, 0.54)",
        color: "white",
        fontFamily,
        fontSize: lines.length > 1 ? 21 : 25,
        fontWeight: 800,
        lineHeight: 1.06,
        letterSpacing: 0,
      }}
    >
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
};

const CaptionOverlay: React.FC<{captions: Caption[]; captionStyle?: CaptionStyle}> = ({captions, captionStyle}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const active = useActiveCaption(captions);

  if (!active) return null;

  const localFrame = frame - secondsToFrame(active.startSec, fps);
  const opacity = interpolate(localFrame, [0, 5, 12], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(localFrame, [0, 8], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const isCta = active.variant === "cta";
  const visibleText = active.text.split("\n").slice(0, isCta ? 3 : 2).join("\n");
  const presetId = active.stylePresetId || captionStyle?.presetId || "black-box";
  const preset = captionStylePresets[presetId] || captionStylePresets["black-box"];
  const fontScale = Math.max(0.78, Math.min(1.22, Number(captionStyle?.fontScale || 1)));
  // 자막이 화면에서 최대 2줄로만 보이도록, 문장이 길면 폰트를 자동으로 줄인다.
  // (폭 ~1004px, 기본 90px 폰트 기준 한 줄 약 11자 → 2줄 약 22자. 그보다 길면 비례 축소, 하한 66%)
  const captionTextLength = visibleText.replace(/\n/g, "").length;
  const lengthScale = isCta ? 1 : Math.max(0.66, Math.min(1, 22 / Math.max(1, captionTextLength)));
  const centerCaption = captionStyle?.position === "center";
  const animation = captionStyle?.animation || "rise";
  const popScale =
    animation === "pop"
      ? interpolate(localFrame, [0, 5, 12], [0.9, 1.06, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const shakeX = animation === "shake" && localFrame < 16 ? Math.sin(localFrame * 1.7) * 8 : 0;
  const entryY = animation === "none" ? 0 : y;

  return (
    <div
      style={{
        position: "absolute",
        left: isCta ? 48 : 38,
        right: isCta ? 48 : 38,
        top: isCta || centerCaption ? "50%" : undefined,
        bottom: isCta || centerCaption ? undefined : 245,
        zIndex: 16,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform:
          isCta || centerCaption
            ? `translate(${shakeX}px, calc(-50% + ${entryY}px)) scale(${popScale})`
            : `translate(${shakeX}px, ${entryY}px) scale(${popScale})`,
      }}
    >
      <div
        style={{
          maxWidth: isCta ? 984 : 1004,
          borderRadius: 8,
          padding: isCta ? "28px 34px 26px" : "22px 30px 20px",
          backgroundColor: isCta && presetId === "black-box" ? "rgba(0, 0, 0, 0.78)" : preset.backgroundColor,
          boxShadow: preset.boxShadow,
          border: preset.border,
          color: preset.color,
          fontFamily,
          fontSize: (isCta ? 88 : 90) * fontScale * lengthScale,
          fontWeight: 900,
          lineHeight: isCta ? 1.16 : 1.12,
          textAlign: "center",
          letterSpacing: 0,
          whiteSpace: "pre-line",
          textShadow: preset.textShadow,
        }}
      >
        {visibleText}
      </div>
    </div>
  );
};

const ImageOverlayLayer: React.FC<{images: ImageOverlay[]; visualFilter?: ShoppingShortsProps["visualFilter"]}> = ({
  images,
  visualFilter,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const currentSec = frame / fps;
  const sortedImages = [...images].sort((left, right) => left.startSec - right.startSec);
  const activeIndex = sortedImages.findIndex((image) => currentSec >= image.startSec && currentSec < image.endSec);
  const active = activeIndex >= 0 ? sortedImages[activeIndex] : null;

  if (!active) return null;

  const next = sortedImages[activeIndex + 1];
  const hasImmediateNext = Boolean(next && next.startSec >= active.endSec && next.startSec - active.endSec <= 0.35);
  const localFrame = frame - secondsToFrame(active.startSec, fps);
  const durationFrames = Math.max(1, secondsToFrame(active.endSec - active.startSec, fps));
  const fadeOutStartFrame = Math.max(0, durationFrames - 8);
  const transition = active.transition || "slow-zoom";
  const fadeIn = transition === "soft-fade" || transition === "blur";
  const opacity = hasImmediateNext
    ? fadeIn
      ? interpolate(localFrame, [0, 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1
    : fadeIn
      ? interpolate(localFrame, [0, 8, fadeOutStartFrame, durationFrames], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : interpolate(localFrame, [fadeOutStartFrame, durationFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  const scale = transition === "slow-zoom" ? interpolate(localFrame, [0, durationFrames], [1.03, 1.11], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }) : 1.02;
  const blurPx =
    transition === "blur"
      ? interpolate(localFrame, [0, 8, durationFrames - 8, durationFrames], [12, 0, 0, 10], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  const baseFilter = visualFilterCss(visualFilter);
  const imageFilter = [baseFilter === "none" ? "" : baseFilter, blurPx ? `blur(${blurPx}px)` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <AbsoluteFill
      style={{
        zIndex: 8,
        opacity,
        backgroundColor: "#111111",
      }}
    >
      <img
        src={staticFile(active.src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: active.fit ?? "cover",
          transform: `scale(${scale})`,
          filter: imageFilter || undefined,
        }}
      />
    </AbsoluteFill>
  );
};

const CtaBackgroundLayer: React.FC<{captions: Caption[]; background?: CtaBackground}> = ({captions, background}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const currentSec = frame / fps;
  const active = captions.find(
    (caption) => caption.variant === "cta" && currentSec >= caption.startSec && currentSec < caption.endSec,
  );

  if (!active || !background?.src) return null;

  const localFrame = frame - secondsToFrame(active.startSec, fps);
  const durationFrames = Math.max(1, secondsToFrame(active.endSec - active.startSec, fps));
  const opacity = interpolate(localFrame, [0, 6, durationFrames - 6, durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{zIndex: 13, opacity, backgroundColor: "#050505"}}>
      <img
        src={staticFile(background.src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: `blur(${background.blurPx ?? 14}px)`,
          transform: "scale(1.08)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.68) 48%, rgba(0,0,0,0.74) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const SecondaryCtaOverlay: React.FC<{cta?: SecondaryCta}> = ({cta}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // [항목 7] 끄기(disabled) 상태이거나 표시 시간이 없으면 그리지 않는다.
  // (startSec/endSec가 undefined인 객체가 들어오면 아래 비교가 모두 false가 되어 항상 그려지는 사고 방지)
  if (!cta || cta.disabled) return null;
  const startSec = Number(cta.startSec);
  const endSec = Number(cta.endSec);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;

  const currentSec = frame / fps;
  if (currentSec < startSec || currentSec >= endSec) return null;

  const localFrame = frame - secondsToFrame(startSec, fps);
  const durationFrames = Math.max(1, secondsToFrame(endSec - startSec, fps));
  const opacity = interpolate(localFrame, [0, 5, durationFrames - 6, durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const textRise = interpolate(localFrame, [0, 6], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const arrowMove = Math.sin(localFrame / 4.5) * 22;
  const lines = String(cta.text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  // 세 줄이 빠르게 등장하도록 stagger를 줄여, 2초 표시 구간 동안 온전히 보이는 시간을 최대화한다.
  const lineMotion = (index: number) => {
    const start = index * 5;
    return {
      opacity: interpolate(localFrame, [start, start + 5], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
      transform: `translateY(${interpolate(localFrame, [start, start + 5], [18, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })}px)`,
    };
  };

  return (
    <AbsoluteFill
      style={{
        zIndex: 18,
        opacity,
        fontFamily,
        pointerEvents: "none",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.32) 45%, rgba(0,0,0,0.74) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 70,
          right: 70,
          bottom: 310,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 24,
          transform: `translateY(${textRise}px)`,
          letterSpacing: 0,
        }}
      >
        <div
          style={{
            ...lineMotion(0),
            color: "#FFFFFF",
            fontSize: 58,
            fontWeight: 900,
            lineHeight: 1.05,
            textShadow: "0 7px 24px rgba(0,0,0,0.88)",
          }}
        >
          {lines[0] || "왼쪽아래 링크를 클릭 후"}
        </div>
        <div
          style={{
            ...lineMotion(1),
            color: "#FFE45C",
            fontSize: 102,
            fontWeight: 950,
            lineHeight: 0.96,
            textShadow: "0 8px 0 rgba(0,0,0,0.60), 0 16px 30px rgba(0,0,0,0.86)",
          }}
        >
          {lines[1] || "지금 바로"}
        </div>
        <div
          style={{
            ...lineMotion(2),
            color: "#FFFFFF",
            fontSize: 70,
            fontWeight: 950,
            lineHeight: 1,
            textShadow: "0 7px 24px rgba(0,0,0,0.90)",
          }}
        >
          {lines[2] || "확인하세요 :)"}
        </div>
      </div>
      {cta.arrow === false ? null : (
        <div
          style={{
            position: "absolute",
            left: 86 - arrowMove,
            bottom: 92 - arrowMove,
            color: "#FFFFFF",
            fontSize: 150,
            fontWeight: 950,
            lineHeight: 1,
            transform: "rotate(-4deg)",
            textShadow:
              "0 0 0 #111827, 0 10px 0 rgba(0,0,0,0.68), 0 0 28px rgba(255,228,92,0.92), 0 18px 34px rgba(0,0,0,0.94)",
          }}
        >
          ↙
        </div>
      )}
    </AbsoluteFill>
  );
};

const ThumbnailTail: React.FC<{
  tail: ShoppingShortsProps["thumbnailTail"];
  cta: string;
  productName: string;
}> = ({tail, cta, productName}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const headline = tail.headline || tail.text;
  // 썸네일 문구: 더 크게(진현님 요청) + 화면 중간~중간아래로 올림(예전 176은 거의 바닥이었음).
  const headlineFontSize = tail.headlineFontSize ?? 184;
  const headlineBottom = tail.headlineBottom ?? 760;
  const headlineHorizontalInset = tail.headlineHorizontalInset ?? 54;
  const showProductLabel = !tail.hideProductLabel;

  return (
    <AbsoluteFill
      style={{
        zIndex: 30,
        opacity,
        backgroundColor: "#111111",
        alignItems: "center",
        justifyContent: "center",
        fontFamily,
      }}
    >
      {tail.src ? (
        <img
          src={staticFile(tail.src)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.22) 38%, rgba(0,0,0,0.82) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: headlineHorizontalInset,
          right: headlineHorizontalInset,
          bottom: headlineBottom,
          textAlign: "center",
        }}
      >
        {showProductLabel ? (
          <div
            style={{
              display: "inline-block",
              color: "#FFFFFF",
              backgroundColor: "rgba(0, 0, 0, 0.70)",
              border: "4px solid rgba(255, 255, 255, 0.86)",
              borderRadius: 8,
              padding: "10px 20px 8px",
              fontSize: 39,
              fontWeight: 900,
              marginBottom: 20,
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            {tail.productLabel || productName}
          </div>
        ) : null}
        <div
          style={{
            color: "#FFFFFF",
            fontSize: headlineFontSize,
            fontWeight: 950,
            lineHeight: 0.94,
            letterSpacing: 0,
            whiteSpace: "pre",
            wordBreak: "keep-all",
            textShadow:
              "0 8px 0 rgba(0,0,0,0.70), 0 16px 34px rgba(0,0,0,0.92)",
          }}
        >
          {headline}
        </div>
        {tail.subheadline ? (
          <div
            style={{
              display: "inline-block",
              color: "#111827",
              backgroundColor: "rgba(255,255,255,0.92)",
              borderRadius: 8,
              fontSize: 46,
              fontWeight: 900,
              marginTop: 26,
              padding: "12px 24px 10px",
              letterSpacing: 0,
            }}
          >
            {tail.subheadline}
          </div>
        ) : !tail.hideCta ? (
          <div
            style={{
              color: "#FFFFFF",
              fontSize: 36,
              fontWeight: 850,
              marginTop: 20,
              letterSpacing: 0,
              textShadow: "0 4px 14px rgba(0,0,0,0.86)",
            }}
          >
            {cta}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const ShoppingShorts: React.FC<ShoppingShortsProps> = (props) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const tailFrames = secondsToFrame(props.thumbnailTail.durationSec, fps);
  const totalFrames = Math.ceil(props.durationSec * fps);
  const tailFrom = Math.max(0, totalFrames - tailFrames);
  const videoOpacity = interpolate(frame, [0, 7, tailFrom - 8, tailFrom], [0, 1, 1, 0.88], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const introScale = interpolate(frame, [0, 24], [1.035, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bgmBaseVolume = props.backgroundMusic?.volume ?? 0.055;
  const fadeInFrames = Math.max(0, secondsToFrame(props.backgroundMusic?.fadeInSec || 0, fps));
  const fadeOutFrames = Math.max(0, secondsToFrame(props.backgroundMusic?.fadeOutSec || 0, fps));
  const bgmVolume = (audioFrame: number) => {
    const fadeInVolume = fadeInFrames > 0 ? interpolate(audioFrame, [0, fadeInFrames], [0, bgmBaseVolume], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) : bgmBaseVolume;
    const fadeOutVolume =
      fadeOutFrames > 0
        ? interpolate(audioFrame, [Math.max(0, totalFrames - fadeOutFrames), totalFrames], [bgmBaseVolume, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : bgmBaseVolume;
    return Math.min(fadeInVolume, fadeOutVolume);
  };
  return (
    <AbsoluteFill style={{backgroundColor: "#050505"}}>
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `scale(${introScale})`,
        }}
      >
        <SourceVideoLayer
          videoSrc={props.videoSrc}
          sourceClips={props.sourceClips}
          durationFrames={tailFrom}
          opacity={videoOpacity}
          visualFilter={props.visualFilter}
          useAllClips={props.useAllClips}
        />
      </div>
      {props.narrationSrc ? <Audio src={staticFile(props.narrationSrc)} volume={1} /> : null}
      {props.backgroundMusic?.src ? (
        <Audio src={staticFile(props.backgroundMusic.src)} volume={bgmVolume} />
      ) : null}
      <ImageOverlayLayer images={props.imageOverlays || []} visualFilter={props.visualFilter} />
      <CtaBackgroundLayer captions={props.captions} background={props.ctaBackground} />
      <AdBadge text={props.adBadge?.text || "광고"} />
      <CaptionOverlay captions={props.captions} captionStyle={props.captionStyle} />
      <SecondaryCtaOverlay cta={props.secondaryCta} />
      <Sequence from={tailFrom} durationInFrames={tailFrames}>
        <ThumbnailTail
          tail={props.thumbnailTail}
          cta={props.cta}
          productName={props.productName}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
