import { cn } from "@/lib/utils";
import {
  classifyDataroomBanner,
  type DataroomBannerKind,
} from "@/ee/features/branding/lib/dataroom-banner";

type Props = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  /** Aspect ratio: "cover" fills the wrapping box; "intrinsic" lets media set its own height. */
  fit?: "cover" | "intrinsic";
  /** Optional onLoad-style ready signal — consumers can rely on initial paint instead. */
  onKindResolved?: (kind: DataroomBannerKind) => void;
};

/**
 * Renders a dataroom banner image / video / YouTube embed based on the saved URL.
 * Returns null when the banner is hidden ("no-banner") or empty.
 */
export function DataroomBannerMedia({
  src,
  alt = "Banner",
  className,
  fit = "cover",
}: Props) {
  const classified = classifyDataroomBanner(src);

  if (classified.kind === "none" || !classified.src) return null;

  const fitClass =
    fit === "cover" ? "h-full w-full object-cover" : "w-full";

  if (classified.kind === "youtube" && classified.youtubeId) {
    return (
      <iframe
        className={cn(fitClass, "border-0", className)}
        src={`https://www.youtube.com/embed/${classified.youtubeId}?modestbranding=1&rel=0`}
        title={alt}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    );
  }

  if (classified.kind === "video") {
    return (
      <video
        className={cn(fitClass, className)}
        src={classified.src}
        muted
        loop
        playsInline
        autoPlay
        controls={false}
      />
    );
  }

  return (
    <img
      className={cn(fitClass, className)}
      src={classified.src}
      alt={alt}
    />
  );
}
