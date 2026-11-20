/**
 * Shared contract for the postMessage channel between the access-screen editor
 * (`access-screen-preview.tsx`) and the preview iframe page
 * (`pages/custom_fields_ppreview_demo.tsx`). Kept dependency-free so neither
 * side pulls the other's bundle in.
 */
export const ACCESS_PREVIEW_MESSAGE = "papermark:access-preview" as const;
export const ACCESS_PREVIEW_READY = "papermark:access-preview-ready" as const;

export type AccessPreviewField = {
  type: string;
  identifier: string;
  label: string;
  placeholder?: string | null;
  required?: boolean;
};

export type AccessPreviewPayload = {
  requireEmail: boolean;
  requirePassword: boolean;
  requireAgreement: boolean;
  welcomeMessage: string;
  fields: AccessPreviewField[];
};
