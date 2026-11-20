// Consumers return the document inline as JSON, so the cap has to stay below
// Vercel's 4.5 MB response limit with room for JSON escaping.
export const MAX_HTML_DOCUMENT_BYTES = 3 * 1024 * 1024;

export const HTML_DOCUMENT_FETCH_TIMEOUT_MS = 10_000;

// Must not include `allow-same-origin`: combined with `allow-scripts` the
// document could remove its own sandbox and reach Papermark's origin.
export const HTML_DOCUMENT_IFRAME_SANDBOX = "allow-scripts allow-popups";

export type HtmlDocumentRiskReport = {
  byteLength: number;
  hasInlineScript: boolean;
  hasInlineEventHandlers: boolean;
  hasForms: boolean;
  hasNestedIframes: boolean;
  hasMetaRefresh: boolean;
  externalResourceHosts: string[];
};

const EXTERNAL_URL_REGEX = /(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
const INLINE_EVENT_HANDLER_REGEX = /<[^>]+\son[a-z]+\s*=/i;

export function scanHtmlDocument(html: string): HtmlDocumentRiskReport {
  const externalResourceHosts = new Set<string>();
  for (const match of html.matchAll(EXTERNAL_URL_REGEX)) {
    try {
      externalResourceHosts.add(new URL(match[1]).host);
    } catch {
      // Malformed URLs won't resolve when rendered either.
    }
  }

  return {
    byteLength: byteLength(html),
    hasInlineScript: /<script[\s>]/i.test(html),
    hasInlineEventHandlers: INLINE_EVENT_HANDLER_REGEX.test(html),
    hasForms: /<form[\s>]/i.test(html),
    hasNestedIframes: /<iframe[\s>]/i.test(html),
    hasMetaRefresh: /<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html),
    externalResourceHosts: Array.from(externalResourceHosts),
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// Releases the socket when we bail out before reading the body; a failing
// cancel must not replace the caller-facing error.
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {}
}

export async function fetchHtmlDocumentForRender({
  url,
  maxBytes = MAX_HTML_DOCUMENT_BYTES,
  timeoutMs = HTML_DOCUMENT_FETCH_TIMEOUT_MS,
}: {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<string> {
  // The deadline covers the streamed body too, so a stalled storage backend
  // cannot hold the request open.
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      await discardBody(response);
      throw new Error(
        `Failed to fetch HTML document (status ${response.status})`,
      );
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await discardBody(response);
      throw new Error("HTML document exceeds the maximum allowed size");
    }

    const body = response.body;
    if (!body) {
      const text = await response.text();
      if (byteLength(text) > maxBytes) {
        throw new Error("HTML document exceeds the maximum allowed size");
      }
      return text;
    }

    // Enforce the cap while streaming so an oversized response is never fully
    // buffered into memory.
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let received = 0;
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error("HTML document exceeds the maximum allowed size");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();

    return text;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(`Timed out fetching HTML document after ${timeoutMs}ms`);
    }
    throw error;
  }
}

export async function resolveHtmlContentForRender({
  documentId,
  url,
}: {
  documentId: string;
  url: string;
}): Promise<string> {
  const html = await fetchHtmlDocumentForRender({ url });
  const report = scanHtmlDocument(html);

  console.info("[htmlDocument] rendering document", {
    documentId,
    byteLength: report.byteLength,
    hasInlineScript: report.hasInlineScript,
    hasInlineEventHandlers: report.hasInlineEventHandlers,
    hasForms: report.hasForms,
    hasNestedIframes: report.hasNestedIframes,
    hasMetaRefresh: report.hasMetaRefresh,
    externalResourceHosts: report.externalResourceHosts,
  });

  return html;
}
