export type VideoProcessingMode = "probe" | "optimize";

export function videoProcessingMode(input: {
  type: string | null | undefined;
  contentType: string | null | undefined;
}): VideoProcessingMode | null {
  const contentType = input.contentType?.split(";")[0].trim().toLowerCase();

  if (input.type !== "video" || !contentType?.startsWith("video/")) {
    return null;
  }

  if (contentType === "video/mp4") {
    return "probe";
  }

  return "optimize";
}
