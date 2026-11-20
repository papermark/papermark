export const SIGNING_TEMPLATE_PDF_CONTENT_TYPE = "application/pdf";
export const MAX_SIGNING_TEMPLATE_PDF_BYTES = 30 * 1024 * 1024;
export const MAX_SIGNING_TEMPLATE_PDF_MB = Math.floor(
  MAX_SIGNING_TEMPLATE_PDF_BYTES / (1024 * 1024),
);

export const getSigningTemplateTooLargeMessage = () =>
  `PDF is too large for signing setup (max ${MAX_SIGNING_TEMPLATE_PDF_MB} MB).`;
