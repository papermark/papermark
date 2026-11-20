import {
  resolveBaseBrand,
  teamBrandOgSelect,
  teamBrandViewerSelect,
  teamBrandWorkflowSelect,
} from "@/ee/features/branding/lib/resolve-base-brand";
import {
  inheritsTeamBrand,
  resolveDisplayedDataroomBrand,
} from "@/ee/features/branding/lib/resolve-dataroom-displayed-brand";
import { resolvePublicLinkMeta } from "@/ee/features/branding/lib/resolve-public-link-meta";
import type { ResolvedPublicLinkMeta } from "@/ee/features/branding/lib/resolve-public-link-meta";
import {
  Brand,
  DataroomBrand,
  ItemType,
  LinkAudienceType,
  LinkType,
  PermissionGroupAccessControls,
  Prisma,
  ViewerGroupAccessControls,
} from "@prisma/client";

import { getFeatureFlags } from "@/lib/featureFlags";
import { resolveDataroomIndexEnabledForViewer } from "@/lib/featureFlags/dataroom-index-viewer";
import prisma from "@/lib/prisma";
import { sortItemsByIndexAndName } from "@/lib/utils/sort-items-by-index-name";

// ============================================================================
// Types
// ============================================================================

type LinkFetchStatus =
  | "ok"
  | "not_found"
  | "archived"
  | "deleted"
  | "expired"
  | "free"
  | "frozen";

export type { ResolvedPublicLinkMeta };

export type LinkFetchResult =
  | {
      status: "ok";
      linkType: LinkType;
      link: any;
      brand: Partial<Brand> | Partial<DataroomBrand> | null;
      linkId?: string;
      publicMeta: ResolvedPublicLinkMeta;
      /** Server-only resolved flag for dataroom visitor views (not serialized onto link). */
      dataroomIndexEnabledForViewer?: boolean;
    }
  | {
      status: Exclude<LinkFetchStatus, "ok">;
    };

// Common select object for link queries
const linkSelect = {
  id: true,
  expiresAt: true,
  emailProtected: true,
  emailAuthenticated: true,
  allowDownload: true,
  enableFeedback: true,
  enableScreenshotProtection: true,
  enableConfidentialView: true,
  password: true,
  isArchived: true,
  deletedAt: true,
  enableIndexFile: true,
  enableCustomMetatag: true,
  metaTitle: true,
  metaDescription: true,
  metaImage: true,
  metaFavicon: true,
  welcomeMessage: true,
  brandId: true,
  enableQuestion: true,
  linkType: true,
  feedback: {
    select: {
      id: true,
      data: true,
    },
  },
  enableAgreement: true,
  agreement: true,
  showBanner: true,
  enableWatermark: true,
  watermarkConfig: true,
  groupId: true,
  permissionGroupId: true,
  audienceType: true,
  dataroomId: true,
  dataroom: {
    select: {
      brandId: true,
    },
  },
  teamId: true,
  team: {
    select: {
      plan: true,
      globalBlockList: true,
    },
  },
  customFields: {
    select: {
      id: true,
      type: true,
      identifier: true,
      label: true,
      placeholder: true,
      required: true,
      disabled: true,
      orderIndex: true,
    },
    orderBy: {
      orderIndex: "asc" as const,
    },
  },
} satisfies Prisma.LinkSelect;

// Type for the link record returned by the common select query
type LinkRecord = Prisma.LinkGetPayload<{ select: typeof linkSelect }>;

// ============================================================================
// Internal Helpers
// ============================================================================

// Helper function to get all parent folder IDs for given folder IDs
async function getAllParentFolderIds(
  folderIds: string[],
  dataroomId: string,
): Promise<string[]> {
  if (folderIds.length === 0) return [];

  const allRequiredFolderIds = new Set(folderIds);

  // Get all folders in the dataroom to build the hierarchy
  const allFolders = await prisma.dataroomFolder.findMany({
    where: { dataroomId },
    select: { id: true, parentId: true },
  });

  // Use Map for O(1) parent lookup: folderId -> parentId
  // This is more efficient than Set because we need key-value relationship for traversal
  const folderMap = new Map(
    allFolders.map((folder) => [folder.id, folder.parentId]),
  );

  // For each accessible folder, traverse up to find all parent folders
  for (const folderId of folderIds) {
    let currentId: string | null = folderId;
    while (currentId) {
      allRequiredFolderIds.add(currentId);
      currentId = folderMap.get(currentId) || null;
    }
  }

  return Array.from(allRequiredFolderIds);
}

// ============================================================================
// Data Fetchers (used by both API routes and getStaticProps)
// ============================================================================

export async function fetchDataroomLinkData({
  linkId,
  dataroomId,
  teamId,
  groupId,
  permissionGroupId,
}: {
  linkId: string;
  dataroomId: string | null;
  teamId: string;
  groupId?: string;
  permissionGroupId?: string;
}) {
  let groupPermissions:
    | ViewerGroupAccessControls[]
    | PermissionGroupAccessControls[] = [];
  let documentIds: string[] = [];
  let folderIds: string[] = [];
  let allRequiredFolderIds: string[] = [];

  const effectiveGroupId = groupId || permissionGroupId;

  if (effectiveGroupId) {
    // Check if this is a ViewerGroup (legacy) or PermissionGroup
    // First try to find ViewerGroup permissions (for backwards compatibility)
    if (groupId) {
      // This is a ViewerGroup (legacy behavior)
      groupPermissions = await prisma.viewerGroupAccessControls.findMany({
        where: {
          groupId: groupId,
          OR: [{ canView: true }, { canDownload: true }],
        },
      });
    } else if (permissionGroupId) {
      // This is a PermissionGroup (new behavior)
      groupPermissions = await prisma.permissionGroupAccessControls.findMany({
        where: {
          groupId: permissionGroupId,
          OR: [{ canView: true }, { canDownload: true }],
        },
      });
    }

    documentIds = groupPermissions
      .filter(
        (permission) => permission.itemType === ItemType.DATAROOM_DOCUMENT,
      )
      .map((permission) => permission.itemId);
    folderIds = groupPermissions
      .filter((permission) => permission.itemType === ItemType.DATAROOM_FOLDER)
      .map((permission) => permission.itemId);

    // Include parent folders if we have group permissions and they're actually being applied
    // This ensures that if a group has access to a subfolder, all parent folders
    // are also included to maintain proper hierarchy (even without explicit permissions)
    allRequiredFolderIds = folderIds;
    if (dataroomId && folderIds.length > 0) {
      allRequiredFolderIds = await getAllParentFolderIds(folderIds, dataroomId);
    }
  }

  const linkData = await prisma.link.findUnique({
    where: { id: linkId, teamId },
    select: {
      brandId: true,
      dataroom: {
        select: {
          id: true,
          name: true,
          description: true,
          teamId: true,
          brandId: true,
          isFrozen: true,
          allowBulkDownload: true,
          showLastUpdated: true,
          introductionEnabled: true,
          introductionContent: true,
          createdAt: true,
          documents: {
            where:
              groupPermissions.length > 0 || effectiveGroupId
                ? { id: { in: documentIds } }
                : undefined,
            select: {
              id: true,
              folderId: true,
              updatedAt: true,
              orderIndex: true,
              hierarchicalIndex: true,
              document: {
                select: {
                  id: true,
                  name: true,
                  advancedExcelEnabled: true,
                  downloadOnly: true,
                  versions: {
                    where: { isPrimary: true },
                    select: {
                      id: true,
                      versionNumber: true,
                      type: true,
                      hasPages: true,
                      file: true,
                      isVertical: true,
                      updatedAt: true,
                    },
                    take: 1,
                  },
                },
              },
            },
            orderBy: [
              { orderIndex: "asc" },
              {
                document: { name: "asc" },
              },
            ],
          },
          folders: {
            where:
              groupPermissions.length > 0 || effectiveGroupId
                ? { id: { in: allRequiredFolderIds } }
                : undefined,
            select: {
              id: true,
              name: true,
              path: true,
              parentId: true,
              dataroomId: true,
              orderIndex: true,
              hierarchicalIndex: true,
              icon: true,
              color: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
          },
        },
      },
      group: {
        select: {
          accessControls: true,
        },
      },
      permissionGroup: {
        select: {
          accessControls: true,
        },
      },
    },
  });

  if (!linkData?.dataroom || linkData.dataroom.teamId !== teamId) {
    throw new Error("Dataroom not found");
  }

  // Sort documents by index or name
  linkData.dataroom.documents = sortItemsByIndexAndName(
    linkData.dataroom.documents,
  );

  const dataroomBrand = await prisma.dataroomBrand.findFirst({
    where: { dataroomId: linkData.dataroom.id },
    select: {
      logo: true,
      hideLogo: true,
      banner: true,
      brandColor: true,
      accentColor: true,
      accentButtonColor: true,
      applyAccentColorToDataroomView: true,
      welcomeMessage: true,
      cardLayout: true,
      showFolderTree: true,
      viewerLayoutPreset: true,
      viewerHeaderStyle: true,
      hideFolderIconsInMain: true,
      ctaLabel: true,
      ctaUrl: true,
      defaultLanguage: true,
    },
  });

  const inheritTeamBrand = inheritsTeamBrand({
    linkBrandId: linkData.brandId,
    dataroomBrandId: linkData.dataroom.brandId,
    hasDataroomBrand: Boolean(dataroomBrand),
  });
  const teamBrand = await resolveBaseBrand({
    teamId: linkData.dataroom.teamId,
    linkBrandId: linkData.brandId,
    dataroomBrandId: linkData.dataroom.brandId,
    select: teamBrandViewerSelect,
  });

  const brand = resolveDisplayedDataroomBrand({
    dataroomBrand,
    teamBrand,
    inheritTeamBrand,
  });

  // Extract access controls from either ViewerGroup or PermissionGroup
  const accessControls =
    linkData.group?.accessControls ||
    linkData.permissionGroup?.accessControls ||
    [];

  return { linkData, brand, accessControls };
}

export async function fetchDataroomDocumentLinkData({
  linkId,
  teamId,
  dataroomDocumentId,
  groupId,
  permissionGroupId,
}: {
  linkId: string;
  teamId: string;
  dataroomDocumentId: string;
  groupId?: string;
  permissionGroupId?: string;
}) {
  let groupPermissions:
    | ViewerGroupAccessControls[]
    | PermissionGroupAccessControls[] = [];

  const effectiveGroupId = groupId || permissionGroupId;

  if (effectiveGroupId) {
    let hasAccess = false;

    if (groupId) {
      // This is a ViewerGroup (legacy behavior)
      groupPermissions = await prisma.viewerGroupAccessControls.findMany({
        where: {
          groupId: groupId,
          itemId: dataroomDocumentId,
          itemType: ItemType.DATAROOM_DOCUMENT,
          OR: [{ canView: true }, { canDownload: true }],
        },
      });
      hasAccess = groupPermissions.length > 0;
    } else if (permissionGroupId) {
      // This is a PermissionGroup (new behavior)
      groupPermissions = await prisma.permissionGroupAccessControls.findMany({
        where: {
          groupId: permissionGroupId,
          itemId: dataroomDocumentId,
          itemType: ItemType.DATAROOM_DOCUMENT,
          OR: [{ canView: true }, { canDownload: true }],
        },
      });
      hasAccess = groupPermissions.length > 0;
    }

    // Fallback: viewer-uploaded docs aren't tied to the link's permission
    // group, so let getStaticProps render the page. The runtime view
    // endpoint enforces per-viewer ownership and OTP re-auth.
    if (!hasAccess) {
      const viewerUpload = await prisma.documentUpload.findFirst({
        where: { linkId, dataroomDocumentId },
        select: { id: true },
      });
      if (viewerUpload) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      throw new Error("Document not found in group");
    }
  }

  const linkData = await prisma.link.findUnique({
    where: { id: linkId, teamId, linkType: "DATAROOM_LINK", deletedAt: null },
    select: {
      brandId: true,
      dataroom: {
        select: {
          id: true,
          name: true,
          description: true,
          teamId: true,
          brandId: true,
          isFrozen: true,
          allowBulkDownload: true,
          showLastUpdated: true,
          documents: {
            where: { id: dataroomDocumentId },
            select: {
              id: true,
              updatedAt: true,
              orderIndex: true,
              hierarchicalIndex: true,
              document: {
                select: {
                  id: true,
                  name: true,
                  advancedExcelEnabled: true,
                  downloadOnly: true,
                  versions: {
                    where: { isPrimary: true },
                    select: {
                      id: true,
                      versionNumber: true,
                      type: true,
                      hasPages: true,
                      file: true,
                      isVertical: true,
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!linkData?.dataroom || linkData.dataroom.teamId !== teamId) {
    throw new Error("Dataroom not found");
  }

  const dataroomBrand = await prisma.dataroomBrand.findFirst({
    where: { dataroomId: linkData.dataroom.id },
    select: {
      logo: true,
      hideLogo: true,
      banner: true,
      brandColor: true,
      accentColor: true,
      accentButtonColor: true,
      applyAccentColorToDataroomView: true,
      welcomeMessage: true,
      cardLayout: true,
      showFolderTree: true,
      viewerLayoutPreset: true,
      viewerHeaderStyle: true,
      hideFolderIconsInMain: true,
      ctaLabel: true,
      ctaUrl: true,
      defaultLanguage: true,
    },
  });

  const inheritTeamBrand = inheritsTeamBrand({
    linkBrandId: linkData.brandId,
    dataroomBrandId: linkData.dataroom.brandId,
    hasDataroomBrand: Boolean(dataroomBrand),
  });
  const teamBrand = await resolveBaseBrand({
    teamId: linkData.dataroom.teamId,
    linkBrandId: linkData.brandId,
    dataroomBrandId: linkData.dataroom.brandId,
    select: teamBrandViewerSelect,
  });

  const brand = resolveDisplayedDataroomBrand({
    dataroomBrand,
    teamBrand,
    inheritTeamBrand,
  });

  return { linkData, brand };
}

export async function fetchDocumentLinkData({
  linkId,
  teamId,
}: {
  linkId: string;
  teamId: string;
}) {
  const linkData = await prisma.link.findUnique({
    where: { id: linkId, teamId, deletedAt: null },
    select: {
      brandId: true,
      document: {
        select: {
          id: true,
          name: true,
          advancedExcelEnabled: true,
          downloadOnly: true,
          teamId: true,
          ownerId: true,
          team: {
            select: { plan: true },
          },
          versions: {
            where: { isPrimary: true },
            select: {
              id: true,
              versionNumber: true,
              type: true,
              hasPages: true,
              file: true,
              isVertical: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  if (!linkData?.document || linkData.document.teamId !== teamId) {
    throw new Error("Document not found");
  }

  const brand = await resolveBaseBrand({
    teamId: linkData.document.teamId,
    linkBrandId: linkData.brandId,
    select: teamBrandViewerSelect,
  });

  return { linkData, brand };
}

// ============================================================================
// Unified Link Data Fetcher for getStaticProps
// Avoids internal HTTP fetch which can be blocked by Vercel edge (403 errors)
// ============================================================================

// Strip the URL unless the override applies, so the viewer can treat a present
// value as "use it".
async function applyPrivacyPolicyUrlVisibility<
  T extends Record<string, any> | null,
>(
  brand: T,
  {
    teamId,
    isCustomDomain,
  }: { teamId?: string | null; isCustomDomain?: boolean },
): Promise<T> {
  if (!brand || !brand.privacyPolicyUrl) return brand;

  if (isCustomDomain && teamId) {
    const featureFlags = await getFeatureFlags({ teamId });
    if (featureFlags.customPrivacyUrl) return brand;
  }

  return { ...brand, privacyPolicyUrl: null };
}

/**
 * Core function to process link data after fetching the link record.
 * Handles all link types: DOCUMENT_LINK, DATAROOM_LINK, WORKFLOW_LINK
 */
async function processLinkData(
  link: LinkRecord,
  options: {
    dataroomDocumentId?: string;
    isCustomDomain?: boolean;
  } = {},
): Promise<LinkFetchResult> {
  const { dataroomDocumentId, isCustomDomain } = options;
  const teamPlan = link.team?.plan || "free";
  const linkType = link.linkType;

  // For custom domains, free plan is not allowed
  if (isCustomDomain && teamPlan.includes("free")) {
    return { status: "free" };
  }

  // Handle WORKFLOW_LINK
  if (linkType === "WORKFLOW_LINK") {
    let brand: Partial<Brand> | null = null;
    if (link.teamId) {
      const teamBrand = await resolveBaseBrand({
        teamId: link.teamId,
        linkBrandId: link.brandId,
        select: teamBrandWorkflowSelect,
      });
      brand = await applyPrivacyPolicyUrlVisibility(teamBrand, {
        teamId: link.teamId,
        isCustomDomain,
      });
    }

    // For workflow links, return the link with minimal processing
    // Remove team object (contains plan, globalBlockList) but keep teamId for feature flags
    const sanitizedLink = {
      ...link,
      team: undefined,
      deletedAt: undefined,
    };

    // Serialize to convert Date objects to strings (required for Next.js getStaticProps)
    const serializedLink = JSON.parse(JSON.stringify(sanitizedLink));
    const serializedBrand = brand ? JSON.parse(JSON.stringify(brand)) : null;

    return {
      status: "ok",
      linkType,
      brand: serializedBrand,
      linkId: link.id,
      link: serializedLink,
      publicMeta: {
        enableCustomMetatag: false,
        metaTitle: null,
        metaDescription: null,
        metaImage: null,
        metaFavicon: "/favicon.ico",
      },
    };
  }

  let brand: Partial<Brand> | Partial<DataroomBrand> | null = null;
  let linkData: any;

  // Handle DOCUMENT_LINK
  if (linkType === "DOCUMENT_LINK") {
    // Guard: teamId is required for document links
    if (!link.teamId) {
      return { status: "not_found" };
    }

    try {
      const data = await fetchDocumentLinkData({
        linkId: link.id,
        teamId: link.teamId,
      });
      linkData = data.linkData;
      brand = data.brand;
    } catch {
      return { status: "not_found" };
    }
  }
  // Handle DATAROOM_LINK
  else if (linkType === "DATAROOM_LINK") {
    // Guard: teamId is required for dataroom links
    if (!link.teamId) {
      return { status: "not_found" };
    }

    if (dataroomDocumentId) {
      // Fetching specific document within dataroom
      try {
        const data = await fetchDataroomDocumentLinkData({
          linkId: link.id,
          teamId: link.teamId,
          dataroomDocumentId: dataroomDocumentId,
          permissionGroupId: link.permissionGroupId || undefined,
          ...(link.audienceType === LinkAudienceType.GROUP &&
            link.groupId && {
              groupId: link.groupId,
            }),
        });
        linkData = data.linkData;
        brand = data.brand;
      } catch {
        return { status: "not_found" };
      }
    } else {
      // Fetching full dataroom
      try {
        const data = await fetchDataroomLinkData({
          linkId: link.id,
          dataroomId: link.dataroomId,
          teamId: link.teamId,
          permissionGroupId: link.permissionGroupId || undefined,
          ...(link.audienceType === LinkAudienceType.GROUP &&
            link.groupId && {
              groupId: link.groupId,
            }),
        });
        linkData = data.linkData;
        brand = data.brand;
        linkData.accessControls = data.accessControls;
      } catch {
        return { status: "not_found" };
      }
    }

    if (linkData?.dataroom?.isFrozen) {
      return { status: "frozen" };
    }
  }

  const sanitizedAgreement =
    link.enableAgreement && link.agreement
      ? {
          id: link.agreement.id,
          name: link.agreement.name,
          content: link.agreement.content,
          contentType: link.agreement.contentType,
          signingProvider: link.agreement.signingProvider,
          requireName: link.agreement.requireName,
        }
      : null;

  // Sanitize document - keep fields needed by getStaticProps
  // Note: team/teamId are used server-side for feature flags and are stripped before client props
  const sanitizedDocument = linkData?.document
    ? {
        id: linkData.document.id,
        name: linkData.document.name,
        teamId: linkData.document.teamId,
        team: linkData.document.team, // Used server-side for plan check, stripped before client
        downloadOnly: linkData.document.downloadOnly,
        advancedExcelEnabled: linkData.document.advancedExcelEnabled,
        versions: linkData.document.versions,
      }
    : undefined;

  // Sanitize link for return - remove sensitive/internal data
  const sanitizedLink = {
    ...link,
    // Remove team object (contains plan, globalBlockList) but keep teamId for feature flags
    team: undefined,
    // Remove internal fields
    deletedAt: undefined,
    document: undefined,
    dataroom: undefined,
    password: link.password ? "protected" : null,
    // Use sanitized agreement
    agreement: sanitizedAgreement,
    ...(teamPlan === "free" && {
      customFields: [],
      enableAgreement: false,
      enableWatermark: false,
      permissionGroupId: null,
    }),
  };

  const returnLink = {
    ...sanitizedLink,
    ...linkData,
    // Override with sanitized document
    document: sanitizedDocument,
    // Keep dataroomId for DATAROOM_LINK types (needed for session verification and API calls)
    // For DOCUMENT_LINK types, set to undefined
    dataroomId:
      linkType === "DATAROOM_LINK"
        ? link.dataroomId || linkData?.dataroom?.id
        : undefined,
    dataroomDocument: linkData?.dataroom?.documents?.[0] || undefined,
  };

  let publicMeta: ResolvedPublicLinkMeta = {
    enableCustomMetatag: false,
    metaTitle: null,
    metaDescription: null,
    metaImage: null,
    metaFavicon: "/favicon.ico",
  };

  if (
    link.teamId &&
    (linkType === "DOCUMENT_LINK" || linkType === "DATAROOM_LINK")
  ) {
    const [teamBrandLp, dataroomBrandLp] = await Promise.all([
      resolveBaseBrand({
        teamId: link.teamId,
        linkBrandId: link.brandId,
        dataroomBrandId: link.dataroom?.brandId,
        select: teamBrandOgSelect,
      }),
      linkType === "DATAROOM_LINK" && link.dataroomId
        ? prisma.dataroomBrand.findFirst({
            where: { dataroomId: link.dataroomId },
            select: {
              customLinkPreviewEnabled: true,
              linkPreviewTitle: true,
              linkPreviewDescription: true,
              linkPreviewImage: true,
              linkPreviewFavicon: true,
            },
          })
        : Promise.resolve(null),
    ]);

    let defaultTitle = "Shared link | Powered by Papermark";
    if (linkType === "DOCUMENT_LINK" && linkData?.document?.name) {
      defaultTitle = `${linkData.document.name} | Powered by Papermark`;
    } else if (linkType === "DATAROOM_LINK") {
      const docName =
        linkData?.dataroom?.documents?.[0]?.document?.name ?? null;
      if (docName) {
        defaultTitle = `${docName} | Powered by Papermark`;
      } else if (linkData?.dataroom?.name) {
        defaultTitle = `${linkData.dataroom.name} | Powered by Papermark`;
      }
    }

    const inheritTeamBrand = inheritsTeamBrand({
      linkBrandId: link.brandId,
      dataroomBrandId: link.dataroom?.brandId,
      hasDataroomBrand: Boolean(dataroomBrandLp),
    });
    publicMeta = resolvePublicLinkMeta({
      link: {
        enableCustomMetatag: !!link.enableCustomMetatag,
        metaTitle: link.metaTitle,
        metaDescription: link.metaDescription,
        metaImage: link.metaImage,
        metaFavicon: link.metaFavicon,
      },
      teamBrand: inheritTeamBrand ? teamBrandLp : null,
      dataroomBrand: inheritTeamBrand ? null : dataroomBrandLp,
      defaultTitle,
    });
  }

  const [dataroomIndexEnabledForViewer, visibleBrand] = await Promise.all([
    linkType === "DATAROOM_LINK" && link.teamId
      ? resolveDataroomIndexEnabledForViewer({ teamId: link.teamId, teamPlan })
      : Promise.resolve(undefined),
    applyPrivacyPolicyUrlVisibility(brand, {
      teamId: link.teamId,
      isCustomDomain,
    }),
  ]);

  // Serialize to convert Date objects to strings (required for Next.js getStaticProps)
  const serializedLink = JSON.parse(JSON.stringify(returnLink));
  const serializedBrand = visibleBrand
    ? JSON.parse(JSON.stringify(visibleBrand))
    : null;

  return {
    status: "ok",
    linkType,
    link: serializedLink,
    brand: serializedBrand,
    publicMeta: JSON.parse(JSON.stringify(publicMeta)),
    ...(dataroomIndexEnabledForViewer !== undefined && {
      dataroomIndexEnabledForViewer,
    }),
  };
}

/**
 * Fetch link data by linkId (for /view/[linkId] routes)
 */
export async function fetchLinkDataById({
  linkId,
  dataroomDocumentId,
}: {
  linkId: string;
  dataroomDocumentId?: string;
}): Promise<LinkFetchResult> {
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    select: linkSelect,
  });

  if (!link) {
    return { status: "not_found" };
  }

  if (link.deletedAt) {
    return { status: "deleted" };
  }

  if (link.isArchived) {
    return { status: "archived" };
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return { status: "expired" };
  }

  return processLinkData(link, { dataroomDocumentId, isCustomDomain: false });
}

/**
 * Fetch link data by domain and slug (for /view/domains/[domain]/[slug] routes)
 * Includes free plan check since custom domains require paid plan
 */
export async function fetchLinkDataByDomainSlug({
  domain,
  slug,
  dataroomDocumentId,
}: {
  domain: string;
  slug: string;
  dataroomDocumentId?: string;
}): Promise<LinkFetchResult> {
  const link = await prisma.link.findUnique({
    where: {
      domainSlug_slug: {
        slug: slug,
        domainSlug: domain,
      },
    },
    select: linkSelect,
  });

  if (!link) {
    return { status: "not_found" };
  }

  if (link.deletedAt) {
    return { status: "deleted" };
  }

  if (link.isArchived) {
    return { status: "archived" };
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return { status: "expired" };
  }

  return processLinkData(link, { dataroomDocumentId, isCustomDomain: true });
}

// Legacy export aliases for backward compatibility
export const fetchCustomDomainLinkData = fetchLinkDataByDomainSlug;
export type CustomDomainLinkResult = LinkFetchResult;
