import { z } from "zod";

export const customFieldDataSchema = z.object({
  type: z.enum([
    "SHORT_TEXT",
    "LONG_TEXT",
    "NUMBER",
    "PHONE_NUMBER",
    "URL",
    "CHECKBOX",
  ]),
  identifier: z.string(),
  label: z.string(),
  placeholder: z.string().nullable().optional(),
  required: z.boolean().default(false),
  disabled: z.boolean().default(false),
  orderIndex: z.number().default(0),
});

export const watermarkConfigSchema = z
  .object({
    text: z.string(),
    isTiled: z.boolean(),
    color: z.string(),
    fontSize: z.number(),
    opacity: z.number(),
    rotation: z.number(),
    position: z.string(),
  })
  .nullable();

export const presetDataSchema = z.object({
  name: z.string(),
  // Social Media Card
  enableCustomMetaTag: z.boolean(),
  metaFavicon: z.string().nullable(),
  metaImage: z.string().nullable(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),

  // // Custom Fields
  enableCustomFields: z.boolean().optional(),
  customFields: z.array(customFieldDataSchema).nullable().optional(),

  // Watermark
  enableWatermark: z.boolean(),
  watermarkConfig: watermarkConfigSchema,

  // Viewer Access Control
  enableAllowList: z.boolean(),
  allowList: z.array(z.string()),
  enableDenyList: z.boolean(),
  denyList: z.array(z.string()),

  // Email Protection
  emailProtected: z.boolean(),
  emailAuthenticated: z.boolean().optional(),

  // Additional Options
  enableNotification: z.boolean(),
  allowDownload: z.boolean().optional(),
  enablePassword: z.boolean(),
  password: z.string().nullable(),
  expiresAt: z.string().nullable(),
  expiresIn: z.number().nullable().optional(),
  enableScreenshotProtection: z.boolean().optional(),
  enableConfidentialView: z.boolean().optional(),

  // Agreement
  enableAgreement: z.boolean().optional(),
  agreementId: z.string().nullable().optional(),

  // Banner
  showBanner: z.boolean().optional(),
});

export type PresetDataSchema = z.infer<typeof presetDataSchema>;
