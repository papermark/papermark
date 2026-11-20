/**
 * Trigger a document download from one of the link-scoped download endpoints.
 *
 * Handles two response shapes:
 *  1. Buffered binary (watermarked PDFs) -> save as blob via `<a download>`.
 *  2. JSON `{ downloadUrl }` -> hand to a hidden iframe. We can't use
 *     `<a download>` here because the `download` attribute is ignored for
 *     cross-origin URLs, which would turn the click into a top-level
 *     navigation to the CloudFront URL.
 */
export async function downloadFromLinkEndpoint({
  endpoint,
  body,
  fallbackFileName,
}: {
  endpoint: string;
  body: Record<string, unknown>;
  fallbackFileName: string;
}): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error || errorData.message || "Failed to download file",
    );
  }

  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    const { downloadUrl } = (await response.json()) as {
      downloadUrl: string;
      fileName?: string;
    };

    triggerDownloadFromUrl(downloadUrl);
    return;
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);

  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.rel = "noopener noreferrer";
  link.download =
    extractFilenameFromContentDisposition(
      response.headers.get("content-disposition"),
    ) ?? fallbackFileName;

  window.document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
    if (link.parentNode) {
      window.document.body.removeChild(link);
    }
  }, 100);
}

function triggerDownloadFromUrl(url: string): void {
  const iframe = window.document.createElement("iframe");
  iframe.style.display = "none";
  window.document.body.appendChild(iframe);
  iframe.src = url;

  setTimeout(() => {
    if (iframe.parentNode) {
      window.document.body.removeChild(iframe);
    }
  }, 5000);
}

export function extractFilenameFromContentDisposition(
  disposition: string | null,
): string | null {
  if (!disposition) return null;

  const starMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch && starMatch[1]) {
    try {
      return decodeURIComponent(starMatch[1]);
    } catch {
      return starMatch[1];
    }
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/);
  if (quotedMatch && quotedMatch[1]) return quotedMatch[1];

  return null;
}
