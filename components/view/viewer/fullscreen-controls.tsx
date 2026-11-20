import { Minimize, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export function FullscreenControls({
  controlsVisible = true,
  showRotate = false,
  onRotate,
  onExit,
  className,
}: {
  controlsVisible?: boolean;
  showRotate?: boolean;
  onRotate?: () => void;
  onExit: () => void;
  className?: string;
}) {
  const { t } = useTranslation("viewer");

  return (
    <div
      className={cn(
        "absolute right-3 top-3 z-[70] flex items-center gap-2 transition-opacity duration-300",
        controlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    >
      {showRotate && onRotate ? (
        <button
          type="button"
          onClick={onRotate}
          aria-label={t("fullscreenControls.rotate")}
          title={t("fullscreenControls.rotate")}
          className="rounded-full bg-gray-950/50 p-2 text-white shadow-lg backdrop-blur"
        >
          <RotateCw className="size-5" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onExit}
        aria-label={t("fullscreenControls.exitFullscreen")}
        title={t("fullscreenControls.exitFullscreen")}
        className="rounded-full bg-gray-950/50 p-2 text-white shadow-lg backdrop-blur"
      >
        <Minimize className="size-5" />
      </button>
    </div>
  );
}
