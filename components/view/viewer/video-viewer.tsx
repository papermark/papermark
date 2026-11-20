import { useEffect, useRef, useState } from "react";

import { ConfidentialViewOverlay } from "@/ee/features/permissions/components/confidential-view/confidential-view-overlay";
import { toast } from "sonner";

import { createVideoTracker } from "@/lib/tracking/video-tracking";
import { cn } from "@/lib/utils";

import { ScreenProtector } from "../ScreenProtection";
import Nav, { TNavData } from "../nav";
import { MediaPlayer } from "./video-player";

export default function VideoViewer({
  file,
  screenshotProtectionEnabled,
  confidentialViewEnabled,
  versionNumber,
  navData,
}: {
  file: string;
  screenshotProtectionEnabled: boolean;
  confidentialViewEnabled?: boolean;
  versionNumber: number;
  navData: TNavData;
}) {
  const { isPreview, linkId, documentId, viewId, dataroomId, allowDownload } =
    navData;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const videoTrackerRef = useRef<ReturnType<typeof createVideoTracker> | null>(
    null,
  );

  // Initialize video tracker
  useEffect(() => {
    if (!videoRef.current) return;

    videoTrackerRef.current = createVideoTracker(videoRef.current, {
      linkId,
      documentId,
      viewId,
      dataroomId,
      versionNumber,
      isMuted: false,
      isFocused: isWindowFocused,
      isFullscreen: false,
      isPreview,
      playbackRate: 1,
      volume: 1,
    });

    return () => {
      videoTrackerRef.current?.cleanup();
    };
  }, [
    linkId,
    documentId,
    viewId,
    dataroomId,
    versionNumber,
    isPreview,
    isWindowFocused,
  ]);

  // Handle visibility change for analytics
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!videoTrackerRef.current) return;
      videoTrackerRef.current.trackVisibilityChange(
        document.visibilityState === "visible",
      );
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Handle screenshot protection
  useEffect(() => {
    if (!screenshotProtectionEnabled) return;

    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [screenshotProtectionEnabled]);

  const handleVideoError = (error: Error) => {
    console.error("Video playback error:", error);
    toast.error("Error playing video. Please try again.");
  };

  return (
    <>
      <Nav navData={navData} />
      <div
        style={{ height: "calc(100dvh - 64px)" }}
        className={cn(
          "relative flex items-center justify-center bg-black p-4",
          !isWindowFocused &&
            screenshotProtectionEnabled &&
            "blur-xl transition-all duration-300",
        )}
      >
        <div className="relative flex h-full w-full items-center justify-center">
          <MediaPlayer
            ref={videoRef}
            mediaSrc={file}
            onError={handleVideoError}
            preventDownload={!allowDownload}
          />
          {screenshotProtectionEnabled && <ScreenProtector />}
          {confidentialViewEnabled ? <ConfidentialViewOverlay /> : null}
        </div>
      </div>
    </>
  );
}
