import React, { useCallback, useEffect, useRef, useState } from "react";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

const HIDE_CONTROLS_DELAY_MS = 2500;

/**
 * Video overlay with fully custom controls. We render `controls={false}` so no
 * native control bar (and therefore no fullscreen button) appears — the only
 * reliable way to hide fullscreen on iOS Safari, which ignores `controlsList`.
 */
export function MediaVideoOverlay({
  src,
  poster,
  isCurrentPage,
  style,
}: {
  src: string;
  poster?: string;
  isCurrentPage: boolean;
  style: React.CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isCurrentPage) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isCurrentPage]);

  useEffect(
    () => () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
    },
    [],
  );

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    hideTimeout.current = setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused) setControlsVisible(false);
    }, HIDE_CONTROLS_DELAY_MS);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(event.target.value);
    video.currentTime = next;
    setCurrentTime(next);
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const seekBackground = `linear-gradient(to right, white ${progress}%, rgba(255,255,255,0.35) ${progress}%)`;

  return (
    <div
      style={style}
      className="group/video overflow-hidden"
      onPointerMove={revealControls}
      onPointerLeave={() => {
        if (isPlaying) setControlsVisible(false);
      }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted
        playsInline
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noremoteplayback nofullscreen"
        className="h-full w-full object-contain"
        onClick={() => {
          togglePlay();
          revealControls();
        }}
        onPlay={() => {
          setIsPlaying(true);
          revealControls();
        }}
        onPause={() => {
          setIsPlaying(false);
          setControlsVisible(true);
        }}
        onEnded={() => setControlsVisible(true)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => setIsMuted(e.currentTarget.muted)}
      />

      {!isPlaying ? (
        <button
          type="button"
          aria-label="Play video"
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform hover:scale-105">
            <Play className="ml-0.5 h-6 w-6 fill-current" />
          </span>
        </button>
      ) : null}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 transition-opacity duration-200",
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={togglePlay}
          className="shrink-0 text-white transition-opacity hover:opacity-80"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
        </button>

        <span className="shrink-0 select-none text-[11px] font-medium tabular-nums text-white">
          {formatTime(currentTime)}
        </span>

        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={duration || 0}
          step="any"
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          onPointerDown={revealControls}
          style={{ background: seekBackground }}
          className="h-1 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />

        <span className="shrink-0 select-none text-[11px] font-medium tabular-nums text-white">
          {formatTime(duration)}
        </span>

        <button
          type="button"
          aria-label={isMuted ? "Unmute" : "Mute"}
          onClick={toggleMute}
          className="shrink-0 text-white transition-opacity hover:opacity-80"
        >
          {isMuted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
