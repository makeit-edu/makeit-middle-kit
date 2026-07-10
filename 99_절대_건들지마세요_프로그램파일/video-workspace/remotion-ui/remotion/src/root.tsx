import React from "react";
import {Composition} from "remotion";
import {ShoppingShorts, shoppingShortsDefaultProps} from "./shopping-shorts";

const FPS = 30;
const MAX_FRAMES = FPS * 90; // 안전 상한 (90초) — 음성이 비정상적으로 길어도 폭주 방지

export const Root: React.FC = () => {
  return (
    <Composition
      id="ShoppingShorts"
      component={ShoppingShorts}
      durationInFrames={FPS * 40}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={shoppingShortsDefaultProps}
      calculateMetadata={({props}) => {
        // 영상 길이를 실제 음성 길이(durationSec)에 맞춘다. 40초 고정이 아니라 가변.
        // (자막이 많아 음성이 40초를 넘어도 잘리지 않고 끝까지 렌더된다)
        const durationSec = Math.max(1, Number((props as {durationSec?: number}).durationSec) || 40);
        return {
          durationInFrames: Math.min(Math.ceil(durationSec * FPS), MAX_FRAMES),
          fps: FPS,
        };
      }}
    />
  );
};
