import { extractFilenameFromContentDisposition } from "./download-document";

/**
 * GET a file-download endpoint and save the response, using the filename from
 * the Content-Disposition header. Mirrors the dataroom index / request-list
 * template download flows.
 */
export async function downloadFileFromApi(
  url: string,
  fallbackFileName = "download.xlsx",
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body?.message || "Download failed");
  }

  const filename =
    extractFilenameFromContentDisposition(
      res.headers.get("Content-Disposition"),
    ) ?? fallbackFileName;

  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener noreferrer";
  window.document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
    if (link.parentNode) window.document.body.removeChild(link);
  }, 100);
}
