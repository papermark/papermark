import { queue } from "@trigger.dev/sdk";

/**
 * Redaction feature Trigger.dev queues.
 */

// Detecting PII regions in page images with Gemini. Detection tasks are
// moderately expensive (one Vertex AI call per page), so cap concurrency.
export const detectRedactionsQueue = queue({
  name: "detect-redactions",
  concurrencyLimit: 5,
});

// Burning accepted redactions into the PDF and re-rasterizing. More CPU /
// memory intensive but short-lived per job; keep concurrency modest.
export const applyRedactionsQueue = queue({
  name: "apply-redactions",
  concurrencyLimit: 5,
});
