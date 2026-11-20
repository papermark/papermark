import { LinkWithViews, WatermarkConfig } from "@/lib/types";

import { DEFAULT_LINK_TYPE } from "@/components/links/link-sheet";

/**
 * Maps a saved link onto the shape the link sheet edits, so any surface that
 * can name a link can also open it for editing.
 */
export const buildLinkFormData = (link: LinkWithViews): DEFAULT_LINK_TYPE => ({
  id: link.id,
  name: link.name || `Link #${link.id.slice(-5)}`,
  domain: link.domainSlug,
  slug: link.slug,
  expiresAt: link.expiresAt,
  password: link.password,
  emailProtected: link.emailProtected,
  emailAuthenticated: link.emailAuthenticated,
  allowDownload: link.allowDownload ? link.allowDownload : false,
  allowList: link.allowList,
  denyList: link.denyList,
  visitorGroupIds:
    link.visitorGroups?.map(
      (vg: { visitorGroupId: string }) => vg.visitorGroupId,
    ) || [],
  enableNotification: link.enableNotification ? link.enableNotification : false,
  enableFeedback: link.enableFeedback ? link.enableFeedback : false,
  enableScreenshotProtection: link.enableScreenshotProtection
    ? link.enableScreenshotProtection
    : false,
  enableConfidentialView: link.enableConfidentialView
    ? link.enableConfidentialView
    : false,
  enableCustomMetatag: link.enableCustomMetatag
    ? link.enableCustomMetatag
    : false,
  enableQuestion: link.enableQuestion ? link.enableQuestion : false,
  questionText: link.feedback ? link.feedback.data?.question : "",
  questionType: link.feedback ? link.feedback.data?.type : "",
  metaTitle: link.metaTitle,
  metaDescription: link.metaDescription,
  metaImage: link.metaImage,
  metaFavicon: link.metaFavicon,
  enableAgreement: link.enableAgreement ? link.enableAgreement : false,
  agreementId: link.agreementId,
  showBanner: link.showBanner ?? false,
  enableWatermark: link.enableWatermark ?? false,
  watermarkConfig: link.watermarkConfig as WatermarkConfig | null,
  audienceType: link.audienceType,
  groupId: link.groupId,
  customFields: link.customFields || [],
  tags: link.tags.map((tag) => tag.id) || [],
  enableConversation: link.enableConversation ?? false,
  enableUpload: link.enableUpload ?? false,
  isFileRequestOnly: link.isFileRequestOnly ?? false,
  uploadFolderIds: Array.isArray(link.uploadFolderIds)
    ? link.uploadFolderIds
    : [],
  uploadFolders: Array.isArray(link.uploadFolders) ? link.uploadFolders : [],
  enableIndexFile: link.enableIndexFile ?? false,
  permissionGroupId: link.permissionGroupId ?? null,
  welcomeMessage: link.welcomeMessage ?? null,
  brandId: link.brandId ?? null,
  dataroomBrandId: link.dataroom?.brandId ?? null,
  enableAIAgents: link.enableAIAgents ?? false,
});
