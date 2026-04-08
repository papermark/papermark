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

import prisma from "@/lib/prisma";
import { sortItemsByIndexAndName } from "@/lib/utils/sort-items-by-index-name";

// ============================================================================
// Types
// ============================================================================

type LinkFetchStatus = "ok" | "not_found" | "archived" | "deleted" | "free";

export type LinkFetchResult =
  | {
      status: "ok";
      linkType: LinkType;
      link: any;
      brand: Partial<Brand> | Partial<DataroomBrand> | null;
      linkId?: string;
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
      dataroom: {
        select: {
          id: true,
          name: true,
          description: true,
          teamId: true,
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

  if (!linkData?.dataroom) {
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
      banner: true,
      brandColor: true,
      accentColor: true,
      applyAccentColorToDataroomView: true,
      welcomeMessage: true,
    },
  });

  const teamBrand = await prisma.brand.findFirst({
    where: { teamId: linkData.dataroom.teamId },
    select: {
      logo: true,
      banner: true,
      brandColor: true,
      accentColor: true,
      applyAccentColorToDataroomView: true,
      welcomeMessage: true,
    },
  });

  const brand = {
    logo: dataroomBrand?.logo || teamBrand?.logo,
    banner: dataroomBrand?.banner || teamBrand?.banner || null,
    brandColor: dataroomBrand?.brandColor || teamBrand?.brandColor,
    accentColor: dataroomBrand?.accentColor || teamBrand?.accentColor,
    applyAccentColorToDataroomView:
      dataroomBrand?.applyAccentColorToDataroomView ??
      teamBrand?.applyAccentColorToDataroomView ??
      false,
    welcomeMessage: dataroomBrand?.welcomeMessage || teamBrand?.welcomeMessage,
  };

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

    // if it's a group/permission link, we need to check if the document is accessible
    if (!hasAccess) {
      // Allow externally uploaded documents (visitor uploads) to pass through
      // so the page can render. Runtime checks in views-dataroom will verify
      // the specific viewer is the uploader before serving file content.
      const dataroomDoc = await prisma.dataroomDocument.findUnique({
        where: { id: dataroomDocumentId },
        select: {
          document: {
            select: { isExternalUpload: true },
          },
        },
      });

      if (!dataroomDoc?.document?.isExternalUpload) {
        throw new Error("Document not found in group");
      }
    }
  }

  const linkData = await prisma.link.findUnique({
    where: { id: linkId, teamId, linkType: "DATAROOM_LINK", deletedAt: null },
    select: {
      dataroom: {
        select: {
          id: true,
          name: true,
          description: true,
          teamId: true,
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

  if (!linkData?.dataroom) {
    throw new Error("Dataroom not found");
  }

  const dataroomBrand = await prisma.dataroomBrand.findFirst({
    where: { dataroomId: linkData.dataroom.id },
    select: {
      logo: true,
      banner: true,
      brandColor: true,
      accentColor: true,
      applyAccentColorToDataroomView: true,
      welcomeMessage: true,
    },
  });

  const teamBrand = await prisma.brand.findFirst({
    where: { teamId: linkData.dataroom.teamId },
    select: {
      logo: true,
      banner: true,
      brandColor: true,
      accentColor: true,
      applyAccentColorToDataroomView: true,
      welcomeMessage: true,
    },
  });

  const brand = {
    logo: dataroomBrand?.logo || teamBrand?.logo,
    banner: dataroomBrand?.banner || teamBrand?.banner || null,
    brandColor: dataroomBrand?.brandColor || teamBrand?.brandColor,
    accentColor: dataroomBrand?.accentColor || teamBrand?.accentColor,
    applyAccentColorToDataroomView:
      dataroomBrand?.applyAccentColorToDataroomView ??
      teamBrand?.applyAccentColorToDataroomView ??
      false,
    welcomeMessage: dataroomBrand?.welcomeMessage || teamBrand?.welcomeMessage,
  };

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

  if (!linkData?.document) {
    throw new Error("Document not found");
  }

  const brand = await prisma.brand.findFirst({
    where: { teamId: linkData.document.teamId },
    select: {
      logo: true,
      brandColor: true,
      accentColor: true,
      welcomeMessage: true,
    },
  });

  return { linkData, brand };
}

// ============================================================================
// Unified Link Data Fetcher for getStaticProps
// Avoids internal HTTP fetch which can be blocked by Vercel edge (403 errors)
// ============================================================================

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
      const teamBrand = await prisma.brand.findUnique({
        where: { teamId: link.teamId },
        select: {
          logo: true,
          brandColor: true,
          accentColor: true,
        },
      });
      brand = teamBrand;
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
  }

  // Only include agreement if enabled (no need to expose it otherwise)
  const sanitizedAgreement =
    link.enableAgreement && link.agreement
      ? {
          id: link.agreement.id,
          name: link.agreement.name,
          content: link.agreement.content,
          contentType: link.agreement.contentType,
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

  // Serialize to convert Date objects to strings (required for Next.js getStaticProps)
  const serializedLink = JSON.parse(JSON.stringify(returnLink));
  const serializedBrand = brand ? JSON.parse(JSON.stringify(brand)) : null;

  return {
    status: "ok",
    linkType,
    link: serializedLink,
    brand: serializedBrand,
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

  return processLinkData(link, { dataroomDocumentId, isCustomDomain: true });
}

// Legacy export aliases for backward compatibility
export const fetchCustomDomainLinkData = fetchLinkDataByDomainSlug;
export type CustomDomainLinkResult = LinkFetchResult;
