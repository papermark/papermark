export function getSupportedContentType(contentType: string): string | null {
  switch (contentType) {
    case "application/pdf":
      return "pdf";
    case "application/vnd.ms-excel":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel.sheet.macroEnabled.12":
    case "application/vnd.ms-excel.sheet.binary.macroEnabled.12":
    case "text/csv":
    case "text/tab-separated-values":
    case "application/vnd.oasis.opendocument.spreadsheet":
      return "sheet";
    case "application/msword":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.oasis.opendocument.text":
    case "application/rtf":
    case "text/rtf":
    case "text/plain":
    case "text/markdown":
      return "docs";
    case "application/vnd.ms-powerpoint":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.oasis.opendocument.presentation":
    case "application/vnd.apple.keynote":
    case "application/x-iwork-keynote-sffkey":
      return "slides";
    case "image/vnd.dwg":
    case "image/vnd.dxf":
      return "cad";
    case "image/png":
    case "image/jpeg":
    case "image/jpg":
      return "image";
    case "application/zip":
    case "application/x-zip-compressed":
    case "application/vnd.rar":
    case "application/x-rar-compressed":
    case "application/x-tar":
    case "application/gzip":
    case "application/x-gzip":
    case "application/x-compressed-tar":
      return "zip";
    case "video/mp4":
    case "video/quicktime":
    case "video/x-msvideo":
    case "video/webm":
    case "video/ogg":
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
    case "audio/mpeg":
      return "video";
    case "application/vnd.google-earth.kml+xml":
    case "application/vnd.google-earth.kmz":
    case "application/x-esri-shape":
    case "application/x-esri-shape-index":
    case "application/x-dbf":
    case "application/x-esri-sbn":
    case "application/x-esri-sbx":
    case "application/x-mapserver-qix":
      return "map";
    case "application/vnd.ms-outlook":
    case "message/rfc822":
      return "email";
    case "text/html":
      return "html";
    case "image/tiff":
    case "image/x-ecw":
    case "application/x-bak":
    case "application/x-spss-sav":
      return "other";
    default:
      return null;
  }
}

// Checks the extension too because browsers often upload `.md` as `text/plain`.
export function isMarkdownFile({
  name,
  contentType,
}: {
  name?: string | null;
  contentType?: string | null;
}): boolean {
  if (contentType === "text/markdown") return true;
  if (name && /\.(md|markdown|mdown|mkd|mdx)$/i.test(name)) return true;
  return false;
}

// Checks the extension too because browsers often upload `.html` with an empty
// or generic content type.
export function isHtmlFile({
  name,
  contentType,
}: {
  name?: string | null;
  contentType?: string | null;
}): boolean {
  if (contentType === "text/html") return true;
  if (name && /\.html?$/i.test(name)) return true;
  return false;
}

export function getExtensionFromContentType(
  contentType: string,
): string | null {
  switch (contentType) {
    case "application/pdf":
      return "pdf";
    case "application/vnd.ms-excel":
      return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "application/vnd.ms-excel.sheet.macroEnabled.12":
      return "xlsm";
    case "application/vnd.ms-excel.sheet.binary.macroEnabled.12":
      return "xlsb";
    case "text/csv":
      return "csv";
    case "text/tab-separated-values":
      return "tsv";
    case "application/vnd.oasis.opendocument.spreadsheet":
      return "ods";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.oasis.opendocument.text":
      return "odt";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "pptx";
    case "application/vnd.oasis.opendocument.presentation":
      return "odp";
    case "application/vnd.ms-powerpoint":
      return "ppt";
    case "application/vnd.apple.keynote":
    case "application/x-iwork-keynote-sffkey":
      return "key";
    case "application/msword":
      return "doc";
    case "application/rtf":
    case "text/rtf":
      return "rtf";
    case "text/plain":
      return "txt";
    case "text/markdown":
      return "md";
    case "image/vnd.dwg":
      return "dwg";
    case "image/vnd.dxf":
      return "dxf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpeg";
    case "image/jpg":
      return "jpg";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/x-msvideo":
      return "avi";
    case "video/webm":
      return "webm";
    case "video/ogg":
      return "ogg";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "application/vnd.google-earth.kml+xml":
      return "kml";
    case "application/vnd.google-earth.kmz":
      return "kmz";
    case "application/vnd.ms-outlook":
      return "msg";
    case "message/rfc822":
      return "eml";
    case "text/html":
      return "html";
    case "image/tiff":
      return "tiff";
    case "image/x-ecw":
      return "ecw";
    case "application/x-bak":
      return "bak";
    case "application/x-spss-sav":
      return "sav";
    case "application/x-esri-shape":
      return "shp";
    case "application/x-esri-shape-index":
      return "shx";
    case "application/x-dbf":
      return "dbf";
    case "application/x-esri-sbn":
      return "sbn";
    case "application/x-esri-sbx":
      return "sbx";
    case "application/x-mapserver-qix":
      return "qix";
    case "application/zip":
    case "application/x-zip-compressed":
      return "zip";
    case "application/vnd.rar":
    case "application/x-rar-compressed":
      return "rar";
    case "application/x-tar":
      return "tar";
    case "application/gzip":
    case "application/x-gzip":
      return "gz";
    case "application/x-compressed-tar":
      return "tar.gz";
    default:
      return null;
  }
}

/**
 * Ensure a download filename has a file extension.
 *
 * Document.name is mostly populated from the original `file.name` at upload
 * time, so it usually already includes the extension. However, owners can
 * rename documents via the UI without keeping the extension, and some legacy
 * uploads may have stripped extensions. When such a name is used as a
 * download filename, the OS can't infer the file type.
 *
 * Behavior:
 *  - If `name` already ends with a plausible extension (1-8 alphanumeric
 *    characters after a final dot), it is returned unchanged.
 *  - Otherwise we append the extension derived from `contentType` first
 *    (most accurate) and fall back to `type` (Papermark's internal type
 *    column, e.g. "pdf", "sheet", "image").
 *  - Returns the original name if no extension can be derived.
 */
export function ensureFileExtension({
  name,
  contentType,
  type,
}: {
  name: string | null | undefined;
  contentType?: string | null;
  type?: string | null;
}): string {
  if (!name) return name ?? "";

  if (/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    return name;
  }

  const derivedFromContentType = contentType
    ? getExtensionFromContentType(contentType)
    : null;

  // `type` is the Papermark-internal short type. Most values are generic
  // buckets ("sheet", "image", "docs", "slides", "video", "map", "email",
  // "cad", "other") or non-file kinds ("notion", "link") that must NOT be
  // appended as a fake extension. Only fall back to `type` when it is on a
  // strict allow-list of values that correspond to a single real extension,
  // and additionally validate it matches a filename-safe shape so a stray
  // value can never produce an unsafe filename suffix.
  const ALLOWED_TYPE_EXTENSIONS = new Set(["pdf", "zip"]);
  const usableType =
    type &&
    ALLOWED_TYPE_EXTENSIONS.has(type) &&
    /^[a-z0-9]{1,6}$/.test(type)
      ? type
      : null;

  const ext = derivedFromContentType || usableType;
  return ext ? `${name}.${ext}` : name;
}

export function supportsAdvancedExcelMode(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) return false;

  return (
    contentType === "application/vnd.ms-excel" || // .xls
    contentType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || // .xlsx
    contentType === "application/vnd.ms-excel.sheet.macroEnabled.12" // .xlsm
  );
}
