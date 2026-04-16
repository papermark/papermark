import { z } from "zod";

/**
 * Zod validation schemas for the redaction feature.
 *
 * These validate enum-like values stored as strings in the database
 * (see prisma/schema/redaction.prisma). Using Zod instead of Prisma
 * enums avoids migrations when we add new categories/statuses later.
 */

export const RedactionJobStatusSchema = z.enum([
  "PENDING",
  "DETECTING",
  "REVIEW",
  "APPLYING",
  "APPLIED",
  "FAILED",
]);
export type RedactionJobStatus = z.infer<typeof RedactionJobStatusSchema>;

export const RedactionStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "APPLIED",
]);
export type RedactionStatus = z.infer<typeof RedactionStatusSchema>;

export const RedactionCategorySchema = z.enum([
  "PII_NAME",
  "PII_EMAIL",
  "PII_PHONE",
  "PII_SSN",
  "PII_ADDRESS",
  "PII_TAX_ID",
  "PII_ACCOUNT_NUMBER",
  "CUSTOM_TERM",
  "IMAGE",
  "OTHER",
]);
export type RedactionCategory = z.infer<typeof RedactionCategorySchema>;

export const RedactionSourceSchema = z.enum(["AI", "MANUAL"]);
export type RedactionSource = z.infer<typeof RedactionSourceSchema>;

export const RedactionReasonSchema = z.enum([
  "PRIVACY",
  "GDPR",
  "CPRA",
  "STRATEGIC",
  "COMMERCIAL",
  "OTHER",
]);
export type RedactionReason = z.infer<typeof RedactionReasonSchema>;

export const RedactionConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RedactionConfidence = z.infer<typeof RedactionConfidenceSchema>;

/**
 * A normalized redaction box in 0-1000 coordinate space
 * (matching Gemini's native box2d output range).
 */
export const RedactionBoxSchema = z.object({
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
  width: z.number().min(0).max(1000),
  height: z.number().min(0).max(1000),
});
export type RedactionBox = z.infer<typeof RedactionBoxSchema>;

/**
 * Request payload to create a new redaction job.
 */
export const CreateRedactionJobSchema = z.object({
  documentId: z.string().cuid(),
  /** User-provided custom terms to redact (in addition to AI PII detection) */
  customTerms: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
});
export type CreateRedactionJobInput = z.infer<typeof CreateRedactionJobSchema>;

/**
 * Schema for adding a manually-drawn redaction on top of an existing job.
 */
export const AddManualRedactionSchema = z.object({
  pageNumber: z.number().int().positive(),
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
  width: z.number().min(0).max(1000),
  height: z.number().min(0).max(1000),
  category: RedactionCategorySchema.optional(),
  reason: RedactionReasonSchema.optional(),
  detectedText: z.string().max(1000).optional(),
});
export type AddManualRedactionInput = z.infer<typeof AddManualRedactionSchema>;

/**
 * Schema for bulk updating the status of redaction items (accept/decline).
 */
export const UpdateRedactionItemsSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().cuid(),
        status: RedactionStatusSchema,
      }),
    )
    .min(1)
    .max(1000),
});
export type UpdateRedactionItemsInput = z.infer<
  typeof UpdateRedactionItemsSchema
>;

/**
 * Gemini structured output schema for a single detected redaction.
 *
 * Gemini returns bounding boxes in the native `box2d` format:
 * `[yMin, xMin, yMax, xMax]` normalized to a 0-1000 scale.
 */
export const DetectedRedactionSchema = z.object({
  box2d: z
    .array(z.number().min(0).max(1000))
    .length(4)
    .describe(
      "Bounding box in [yMin, xMin, yMax, xMax] format normalized to 0-1000",
    ),
  detectedText: z
    .string()
    .max(1000)
    .describe("The exact text that should be redacted"),
  category: RedactionCategorySchema.describe(
    "The type of PII or sensitive content",
  ),
  confidence: RedactionConfidenceSchema.describe("Detection confidence"),
});
export type DetectedRedaction = z.infer<typeof DetectedRedactionSchema>;

/**
 * Wrapping object for Gemini's structured output (via `generateObject`).
 */
export const DetectedRedactionsSchema = z.object({
  redactions: z
    .array(DetectedRedactionSchema)
    .describe(
      "List of regions to redact. Return an empty array if no sensitive content is present.",
    ),
});
export type DetectedRedactions = z.infer<typeof DetectedRedactionsSchema>;
