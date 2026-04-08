import { queue } from "@trigger.dev/sdk";

import type { BasePlan } from "../swr/use-billing";

// Task-specific queues
export const convertFilesToPdfQueue = queue({
  name: "convert-files-to-pdf",
  concurrencyLimit: 10,
});

export const convertCadToPdfQueue = queue({
  name: "convert-cad-to-pdf",
  concurrencyLimit: 2,
});

export const convertKeynoteToPdfQueue = queue({
  name: "convert-keynote-to-pdf",
  concurrencyLimit: 2,
});

// AI processing queues
export const processPdfForAIQueue = queue({
  name: "process-pdf-for-ai",
  concurrencyLimit: 5,
});

export const processImageForAIQueue = queue({
  name: "process-image-for-ai",
  concurrencyLimit: 5,
});

export const processExcelForAIQueue = queue({
  name: "process-excel-for-ai",
  concurrencyLimit: 5,
});

export const processDocumentForAIQueue = queue({
  name: "process-document-for-ai",
  concurrencyLimit: 10,
});

export const addFileToVectorStoreQueue = queue({
  name: "add-file-to-vector-store",
  concurrencyLimit: 10,
});

// Plan-based conversion queues (used at trigger time)
const concurrencyConfig: Record<string, number> = {
  free: 1,
  starter: 1,
  pro: 2,
  business: 10,
  datarooms: 10,
  "datarooms-plus": 10,
  "datarooms-premium": 10,
  "datarooms-unlimited": 10,
};

export const conversionFreeQueue = queue({
  name: "conversion-free",
  concurrencyLimit: 1,
});
export const conversionStarterQueue = queue({
  name: "conversion-starter",
  concurrencyLimit: 1,
});
export const conversionProQueue = queue({
  name: "conversion-pro",
  concurrencyLimit: 2,
});
export const conversionBusinessQueue = queue({
  name: "conversion-business",
  concurrencyLimit: 10,
});
export const conversionDataroomsQueue = queue({
  name: "conversion-datarooms",
  concurrencyLimit: 10,
});
export const conversionDataroomsPlusQueue = queue({
  name: "conversion-datarooms-plus",
  concurrencyLimit: 10,
});
export const conversionDataroomsPremiumQueue = queue({
  name: "conversion-datarooms-premium",
  concurrencyLimit: 10,
});
export const conversionDataroomsUnlimitedQueue = queue({
  name: "conversion-datarooms-unlimited",
  concurrencyLimit: 10,
});

/**
 * Returns the queue name string for the given plan.
 * The queue must be pre-defined above (v4 requirement).
 */
export const conversionQueueName = (plan: string): string => {
  const planName = plan.split("+")[0] as BasePlan;
  return `conversion-${planName}`;
};
