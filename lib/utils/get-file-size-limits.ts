type FileSizeLimits = {
  video: number;
  document: number;
  image: number;
  excel: number;
  maxFiles: number;
  maxPages: number;
};

type PartialFileSizeLimits = Partial<{
  [K in keyof FileSizeLimits]: FileSizeLimits[K] | null;
}>;

const resolveFileSizeLimit = (
  limit: number | null | undefined,
  fallback: number,
) => (limit === null ? Infinity : limit ?? fallback);

export function getFileSizeLimits({
  limits,
  isFree,
  isTrial,
}: {
  limits?: { fileSizeLimits?: PartialFileSizeLimits } | null;
  isFree: boolean;
  isTrial: boolean;
}): FileSizeLimits {
  // Default limits based on plan type
  const defaultLimits: FileSizeLimits = {
    video: 500, // 500MB
    document: isFree && !isTrial ? 100 : 350, // 100MB free, 350MB paid
    image: isFree && !isTrial ? 30 : 100, // 30MB free, 100MB paid
    excel: 40, // 40MB
    maxFiles: 150,
    maxPages: isFree && !isTrial ? 100 : 500,
  };

  // If no custom limits are set, return default limits
  if (!limits?.fileSizeLimits) {
    return defaultLimits;
  }

  // Merge custom limits with defaults
  return {
    video: resolveFileSizeLimit(limits.fileSizeLimits.video, defaultLimits.video),
    document: resolveFileSizeLimit(
      limits.fileSizeLimits.document,
      defaultLimits.document,
    ),
    image: resolveFileSizeLimit(limits.fileSizeLimits.image, defaultLimits.image),
    excel: resolveFileSizeLimit(limits.fileSizeLimits.excel, defaultLimits.excel),
    maxFiles: resolveFileSizeLimit(
      limits.fileSizeLimits.maxFiles,
      defaultLimits.maxFiles,
    ),
    maxPages: resolveFileSizeLimit(
      limits.fileSizeLimits.maxPages,
      defaultLimits.maxPages,
    ),
  };
}

// Helper function to get size limit for a specific file type
export function getFileSizeLimit(
  fileType: string,
  limits: FileSizeLimits,
): number {
  if (fileType.startsWith("video/")) {
    return limits.video;
  }
  if (fileType.startsWith("image/")) {
    return limits.image;
  }
  if (
    fileType.startsWith(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) ||
    fileType.startsWith("application/vnd.ms-excel") ||
    fileType.startsWith("application/vnd.oasis.opendocument.spreadsheet")
  ) {
    return limits.excel;
  }
  return limits.document;
}
