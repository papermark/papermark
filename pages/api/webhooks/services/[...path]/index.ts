import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { resolveDefaultBrandId } from "@/ee/features/branding/lib/resolve-base-brand";
import { LinkPreset } from "@prisma/client";
import { put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import { hashToken } from "@/lib/api/auth/token";
import { onDataroomDocumentsAttached } from "@/lib/dataroom/apply-default-permissions";
import {
  createDocument,
  createNewDocumentVersion,
} from "@/lib/documents/create-document";
import { putFileServer } from "@/lib/files/put-file-server";
import { newId } from "@/lib/id-helper";
import { extractTeamId, isValidWebhookId } from "@/lib/incoming-webhooks";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import {
  convertDataUrlToBuffer,
  generateEncrpytedPassword,
  isDataUrl,
  safeSlugify,
  uploadImage,
} from "@/lib/utils";
import {
  getExtensionFromContentType,
  getSupportedContentType,
} from "@/lib/utils/get-content-type";
import {
  type PublicHttpsDownload,
  fetchPublicHttpsUrlToBuffer,
} from "@/lib/utils/ssrf-protection";
import { sendLinkCreatedWebhook } from "@/lib/webhook/triggers/link-created";
import { webhookFileUrlSchema } from "@/lib/zod/url-validation";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
  maxDuration: 120,
};

const MAX_WEBHOOK_FILE_BYTES = 100 * 1024 * 1024;
const API_DOCS_URL = "https://www.papermark.com/docs/api";
const LEGACY_API_NOTICE =
  `This endpoint is deprecated; use the v1 API: ${API_DOCS_URL}`;

// Define a common link schema to reuse
const LinkSchema = z.object({
  name: z.string().optional(),
  domain: z.string().optional(),
  slug: z.string().optional(),
  password: z.string().optional(),
  expiresAt: z.string().optional(), // ISO string date
  emailProtected: z.boolean().optional(),
  emailAuthenticated: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  enableNotification: z.boolean().optional(),
  enableFeedback: z.boolean().optional(),
  enableScreenshotProtection: z.boolean().optional(),
  enableConfidentialView: z.boolean().optional(),
  showBanner: z.boolean().optional(),
  audienceType: z.enum(["GENERAL", "GROUP", "TEAM"]).optional(),
  groupId: z.string().optional(),
  allowList: z.array(z.string()).optional(),
  denyList: z.array(z.string()).optional(),
  presetId: z.string().optional(),
});

// Define validation schemas for different resource types
const BaseSchema = z.object({
  resourceType: z.enum([
    "document.create",
    "document.update",
    "link.create",
    "link.update",
    "links.get",
    "dataroom.create",
  ]),
});

const DocumentCreateSchema = BaseSchema.extend({
  resourceType: z.literal("document.create"),
  fileUrl: webhookFileUrlSchema,
  name: z.string(),
  contentType: z.string(),
  dataroomId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  dataroomFolderId: z.string().nullable().optional(),
  createLink: z.boolean().optional().default(false),
  link: LinkSchema.optional(),
});

const DocumentUpdateSchema = BaseSchema.extend({
  resourceType: z.literal("document.update"),
  documentId: z.string(),
  fileUrl: webhookFileUrlSchema,
  contentType: z.string(),
});

const LinkCreateSchema = BaseSchema.extend({
  resourceType: z.literal("link.create"),
  targetId: z.string(),
  linkType: z.enum(["DOCUMENT_LINK", "DATAROOM_LINK"]),
  link: LinkSchema,
});

const LinkUpdateSchema = BaseSchema.extend({
  resourceType: z.literal("link.update"),
  linkId: z.string(),
  link: LinkSchema,
});

const LinksGetSchema = BaseSchema.extend({
  resourceType: z.literal("links.get"),
});

// Schema for dataroom folder structure
const DataroomFolderSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    name: z.string(),
    subfolders: z.array(DataroomFolderSchema).optional(),
  }),
);

const DataroomCreateSchema = BaseSchema.extend({
  resourceType: z.literal("dataroom.create"),
  name: z.string(),
  description: z.string().optional(),
  folders: z.array(DataroomFolderSchema).optional(), // Create folders with hierarchy
  createLink: z.boolean().optional().default(false),
  link: LinkSchema.optional(),
});

const RequestBodySchema = z.discriminatedUnion("resourceType", [
  DocumentCreateSchema,
  DocumentUpdateSchema,
  LinkCreateSchema,
  LinkUpdateSchema,
  LinksGetSchema,
  DataroomCreateSchema,
]);

export default async function incomingWebhookHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", `<${API_DOCS_URL}>; rel="successor-version"`);
  res.setHeader("X-Papermark-API-Notice", LEGACY_API_NOTICE);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Get the full webhook ID from the path
  const { path } = req.query;
  const webhookId = Array.isArray(path) ? path.join("/") : path;

  if (!webhookId || !isValidWebhookId(webhookId)) {
    return res.status(400).json({ error: "Invalid webhook format" });
  }

  // Check for API token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.replace("Bearer ", "");
  const hashedToken = hashToken(token);

  // Look up token in database
  const restrictedToken = await prisma.restrictedToken.findUnique({
    where: { hashedKey: hashedToken },
    select: { teamId: true, rateLimit: true },
  });

  if (!restrictedToken) {
    return res.status(401).json({ error: "Invalid token" });
  }

  // Rate limit checks for API tokens
  const rateLimit = restrictedToken.rateLimit || 60; // Default rate limit of 60 requests per minute

  const { success, limit, reset, remaining } = await ratelimit(
    rateLimit,
    "1 m",
  ).limit(hashedToken);

  // Set rate limit headers
  res.setHeader("Retry-After", reset.toString());
  res.setHeader("X-RateLimit-Limit", limit.toString());
  res.setHeader("X-RateLimit-Remaining", remaining.toString());
  res.setHeader("X-RateLimit-Reset", reset.toString());

  if (!success) {
    return res.status(429).json({ error: "Too many requests" });
  }

  // Update last used timestamp for the token
  waitUntil(
    prisma.restrictedToken.update({
      where: {
        hashedKey: hashedToken,
      },
      data: {
        lastUsed: new Date(),
      },
    }),
  );

  const teamId = extractTeamId(webhookId);
  if (!teamId) {
    return res.status(400).json({ error: "Invalid team ID in webhook" });
  }

  if (restrictedToken.teamId !== teamId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Find the webhook integration
    const incomingWebhook = await prisma.incomingWebhook.findUnique({
      where: {
        externalId: webhookId,
        teamId: teamId,
      },
      include: { team: true },
    });

    if (!incomingWebhook) {
      return res.status(404).json({ error: "Webhook not found" });
    }

    // Validate request body against the schema
    const validationResult = RequestBodySchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: validationResult.error.format(),
      });
    }

    const validatedData = validationResult.data;

    // Handle different resource types
    if (validatedData.resourceType === "document.create") {
      return await handleDocumentCreate(
        validatedData,
        incomingWebhook.teamId,
        token,
        res,
      );
    } else if (validatedData.resourceType === "document.update") {
      return await handleDocumentUpdate(
        validatedData,
        incomingWebhook.teamId,
        token,
        res,
      );
    } else if (validatedData.resourceType === "link.create") {
      return await handleLinkCreate(
        validatedData,
        incomingWebhook.teamId,
        token,
        res,
      );
    } else if (validatedData.resourceType === "link.update") {
      return await handleLinkUpdate(
        validatedData,
        incomingWebhook.teamId,
        token,
        res,
      );
    } else if (validatedData.resourceType === "links.get") {
      return await handleLinksGet(incomingWebhook.teamId, res);
    } else if (validatedData.resourceType === "dataroom.create") {
      return await handleDataroomCreate(
        validatedData,
        incomingWebhook.teamId,
        token,
        res,
      );
    }

    // This shouldn't be reached due to the validation schema, but just in case
    return res.status(400).json({ error: "Invalid resource type" });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Handle links.get resource type – return all links for the team
 */
async function handleLinksGet(teamId: string, res: NextApiResponse) {
  try {
    const links = await prisma.link.findMany({
      where: {
        teamId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        linkType: true,
        documentId: true,
        dataroomId: true,
        slug: true,
        domainSlug: true,
        expiresAt: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const transformedLinks = links.map((link) => ({
      linkId: link.id,
      name: link.name,
      linkType: link.linkType,
      documentId: link.documentId ?? null,
      dataroomId: link.dataroomId ?? null,
      slug: link.slug,
      domainSlug: link.domainSlug,
      expiresAt: link.expiresAt,
      isArchived: link.isArchived,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      linkUrl:
        link.domainSlug && link.slug
          ? `https://${link.domainSlug}/${link.slug}`
          : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${link.id}`,
    }));

    return res.status(200).json(transformedLinks);
  } catch (error) {
    console.error("Error fetching team links:", error);
    return res.status(500).json({ error: "Failed to fetch team links" });
  }
}

/**
 * Handle document.create resource type
 */
async function handleDocumentCreate(
  data: z.infer<typeof DocumentCreateSchema>,
  teamId: string,
  token: string,
  res: NextApiResponse,
) {
  const {
    fileUrl,
    name,
    contentType,
    dataroomId,
    createLink,
    link,
    folderId,
    dataroomFolderId,
  } = data;

  // Check if team is paused
  const teamIsPaused = await isTeamPausedById(teamId);
  if (teamIsPaused) {
    return res.status(403).json({
      error:
        "Team is currently paused. New document uploads are not available.",
    });
  }

  // Check if the content type is supported
  const supportedContentType = getSupportedContentType(contentType);
  if (!supportedContentType) {
    return res.status(400).json({ error: "Unsupported content type" });
  }

  if (dataroomId) {
    // Verify dataroom exists and belongs to team
    const dataroom = await prisma.dataroom.findUnique({
      where: {
        id: dataroomId,
        teamId: teamId,
      },
    });

    if (!dataroom) {
      return res.status(400).json({ error: "Invalid dataroom ID" });
    }
  }

  // If custom domain and slug are provided, validate them
  if (createLink && link?.domain && link?.slug) {
    // Check if domain exists
    const domain = await prisma.domain.findUnique({
      where: {
        slug: link.domain,
        teamId: teamId,
      },
    });

    if (!domain) {
      return res
        .status(400)
        .json({ error: "Domain not found or not associated with this team" });
    }

    // Check if the slug is already in use with this domain
    const existingLink = await prisma.link.findUnique({
      where: {
        domainSlug_slug: {
          slug: link.slug,
          domainSlug: link.domain,
        },
      },
    });

    if (existingLink) {
      return res
        .status(400)
        .json({ error: "The link with this domain and slug already exists" });
    }
  }

  // 4. Fetch file from URL
  let remoteFile: PublicHttpsDownload;
  try {
    remoteFile = await fetchPublicHttpsUrlToBuffer(fileUrl, {
      maxBytes: MAX_WEBHOOK_FILE_BYTES,
    });
  } catch (error) {
    console.warn("Failed to fetch webhook file", error);
    return res.status(400).json({ error: "Failed to fetch file from URL" });
  }

  // 5. Validate response content type matches expected
  const responseContentType = remoteFile.contentType;
  if (!responseContentType || responseContentType.startsWith("text/html")) {
    return res
      .status(400)
      .json({ error: "Remote resource is not a supported file type" });
  }
  if (!responseContentType.startsWith(contentType)) {
    console.warn(
      `Content type mismatch: expected ${contentType}, got ${responseContentType}`,
    );
    // Log but don't fail - some services return generic types
  }

  // 6. Convert to buffer
  const fileBuffer = remoteFile.buffer;

  // Ensure filename has proper extension, based on the actual response content-type when available
  let fileName = name?.trim();
  const actualContentType = (
    responseContentType?.split(";")[0] ?? contentType
  ).trim();
  const expectedExtension = getExtensionFromContentType(actualContentType);
  if (expectedExtension) {
    const lower = fileName.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    const currentExt = dotIdx !== -1 ? lower.slice(dotIdx + 1) : null;
    // Minimal alias map to avoid double extensions (e.g., jpg vs jpeg)
    const alias: Record<string, string[]> = {
      jpeg: ["jpeg", "jpg"],
      jpg: ["jpg", "jpeg"],
      tiff: ["tiff", "tif"],
    };
    const matches =
      !!currentExt &&
      (currentExt === expectedExtension ||
        (alias[expectedExtension]?.includes(currentExt) ?? false));
    if (!matches) {
      fileName = `${fileName}.${expectedExtension}`;
    }
  }

  console.log("Uploading file to storage", teamId, fileName, contentType);

  // 7. Upload the file to storage
  const { type: storageType, data: fileData } = await putFileServer({
    file: {
      name: fileName,
      type: contentType,
      buffer: fileBuffer,
    },
    teamId: teamId,
    restricted: false, // allows all supported file types
  });

  if (!fileData || !storageType) {
    return res.status(500).json({ error: "Failed to save file to storage" });
  }

  // 8. Create document using our service
  // Note: The createDocument function doesn't accept linkData in its parameters
  // so we will just pass createLink flag
  const documentCreationResponse = await createDocument({
    documentData: {
      name: fileName,
      key: fileData,
      storageType: storageType,
      contentType: contentType,
      supportedFileType: supportedContentType,
      fileSize: fileBuffer.byteLength,
    },
    teamId: teamId,
    numPages: 1,
    token: token,
    createLink: createLink, // INFO: creatLink=true will not trigger a link.created webhook
  });

  if (!documentCreationResponse.ok) {
    return res.status(500).json({ error: "Failed to create document" });
  }

  const document = await documentCreationResponse.json();
  let newLink: any;

  // If the document is added to a folder, update the folderId
  if (folderId) {
    const folder = await prisma.folder.findUnique({
      where: { id: folderId, teamId: teamId },
      select: {
        id: true,
      },
    });

    if (!folder) {
      return res.status(400).json({ error: "Invalid folder ID" });
    }

    await prisma.document.update({
      where: { id: document.id, teamId: teamId },
      data: {
        folderId: folder.id,
      },
    });
  }

  // If we need to customize the link, update it after creation
  if (createLink && document.links && document.links.length > 0 && link) {
    const linkId = document.links[0].id;

    // If preset is provided, validate it
    let preset: LinkPreset | null = null;
    let metaImage: string | null = null;
    let metaFavicon: string | null = null;
    if (link?.presetId) {
      preset = await prisma.linkPreset.findUnique({
        where: { pId: link.presetId, teamId: teamId },
      });

      if (!preset) {
        return res.status(400).json({
          error: "Link preset not found or not associated with this team",
        });
      }

      // Handle image files for custom meta tag (if enabled)
      if (preset.enableCustomMetaTag) {
        // Process meta image if present
        if (preset.metaImage && isDataUrl(preset.metaImage)) {
          const { buffer, mimeType, filename } = convertDataUrlToBuffer(
            preset.metaImage,
          );
          const blob = await put(filename, buffer, {
            access: "public",
            addRandomSuffix: true,
          });
          metaImage = blob.url;
        }

        // Process favicon if present
        if (preset.metaFavicon && isDataUrl(preset.metaFavicon)) {
          const { buffer, mimeType, filename } = convertDataUrlToBuffer(
            preset.metaFavicon,
          );
          const blob = await put(filename, buffer, {
            access: "public",
            addRandomSuffix: true,
          });
          metaFavicon = blob.url;
        }
      }
    }

    // Process fields for link update
    const hashedPassword = link.password
      ? await generateEncrpytedPassword(link.password)
      : preset?.password
        ? await generateEncrpytedPassword(preset.password)
        : null;

    const expiresAtDate = link.expiresAt
      ? new Date(link.expiresAt)
      : preset?.expiresAt
        ? new Date(preset.expiresAt)
        : null;

    const isGroupAudience = link.audienceType === "GROUP";

    let domainId = null;
    if (link.domain) {
      const domain = await prisma.domain.findUnique({
        where: {
          slug: link.domain,
          teamId: teamId,
        },
        select: { id: true },
      });
      domainId = domain?.id || null;
    }

    // Update the link with custom settings
    newLink = await prisma.link.update({
      where: { id: linkId, teamId: teamId },
      data: {
        name: link.name,
        password: hashedPassword,
        expiresAt: expiresAtDate,
        domainId: domainId,
        domainSlug: link.domain || null,
        slug: link.slug || null,
        emailProtected: link.emailProtected ?? preset?.emailProtected ?? false,
        emailAuthenticated:
          link.emailAuthenticated ?? preset?.emailAuthenticated ?? false,
        allowDownload: link.allowDownload ?? preset?.allowDownload,
        enableNotification:
          link.enableNotification ?? preset?.enableNotification ?? false,
        enableFeedback: link.enableFeedback,
        enableScreenshotProtection: link.enableScreenshotProtection,
        enableConfidentialView:
          link.enableConfidentialView ??
          preset?.enableConfidentialView ??
          false,
        showBanner: link.showBanner ?? preset?.showBanner ?? false,
        audienceType: link.audienceType,
        groupId: isGroupAudience ? link.groupId : null,
        // For group links, ignore allow/deny lists from presets as access is controlled by group membership
        allowList: isGroupAudience
          ? link.allowList
          : (link.allowList ?? preset?.allowList),
        denyList: isGroupAudience
          ? link.denyList
          : (link.denyList ?? preset?.denyList),
        ...(preset?.enableCustomMetaTag && {
          enableCustomMetatag: preset?.enableCustomMetaTag,
          metaTitle: preset?.metaTitle,
          metaDescription: preset?.metaDescription,
          metaImage: metaImage,
          metaFavicon: metaFavicon,
        }),
      },
    });

    waitUntil(
      sendLinkCreatedWebhook({
        teamId,
        data: {
          document_id: document.id,
          link_id: newLink.id,
        },
      }),
    );
  }

  // If dataroomId was provided, create the relationship
  if (dataroomId) {
    // If dataroomFolderId is provided, validate it belongs to the dataroom
    if (dataroomFolderId) {
      const dataroomFolder = await prisma.dataroomFolder.findUnique({
        where: {
          id: dataroomFolderId,
          dataroomId: dataroomId,
        },
      });

      if (!dataroomFolder) {
        return res.status(400).json({
          error:
            "Invalid dataroom folder ID or folder does not belong to the specified dataroom",
        });
      }
    }

    const newDataroomDocument = await prisma.dataroomDocument.create({
      data: {
        dataroomId,
        documentId: document.id,
        folderId: dataroomFolderId || null,
      },
    });

    await onDataroomDocumentsAttached({
      dataroomId,
      dataroomDocuments: [
        {
          id: newDataroomDocument.id,
          folderId: newDataroomDocument.folderId,
        },
      ],
      schedule: waitUntil,
    });
  }

  return res.status(200).json({
    message: `Document created successfully${
      dataroomId ? ` and added to dataroom` : ""
    }`,
    documentId: document.id,
    dataroomId: dataroomId ?? undefined,
    linkId: newLink?.id ?? undefined,
    linkUrl: createLink
      ? newLink?.domainSlug && newLink?.slug
        ? `https://${newLink.domainSlug}/${newLink.slug}`
        : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${newLink?.id}`
      : undefined,
  });
}

/**
 * Handle document.update resource type – creates a new version for an existing document.
 * Delegates version creation and document processing to the versions API endpoint
 * via createNewDocumentVersion.
 */
async function handleDocumentUpdate(
  data: z.infer<typeof DocumentUpdateSchema>,
  teamId: string,
  token: string,
  res: NextApiResponse,
) {
  const { documentId, fileUrl, contentType } = data;

  // Check if the content type is supported
  const supportedContentType = getSupportedContentType(contentType);
  if (!supportedContentType) {
    return res.status(400).json({ error: "Unsupported content type" });
  }

  // Verify document exists and belongs to team
  const document = await prisma.document.findUnique({
    where: {
      id: documentId,
      teamId: teamId,
    },
    select: { id: true, name: true },
  });

  if (!document) {
    return res
      .status(404)
      .json({ error: "Document not found or not associated with this team" });
  }

  // Fetch file from URL
  let remoteFile: PublicHttpsDownload;
  try {
    remoteFile = await fetchPublicHttpsUrlToBuffer(fileUrl, {
      maxBytes: MAX_WEBHOOK_FILE_BYTES,
    });
  } catch (error) {
    console.warn("Failed to fetch webhook file", error);
    return res.status(400).json({ error: "Failed to fetch file from URL" });
  }

  // Validate response content type
  const responseContentType = remoteFile.contentType;
  if (!responseContentType || responseContentType.startsWith("text/html")) {
    return res
      .status(400)
      .json({ error: "Remote resource is not a supported file type" });
  }
  if (!responseContentType.startsWith(contentType)) {
    console.warn(
      `Content type mismatch: expected ${contentType}, got ${responseContentType}`,
    );
  }

  // Convert to buffer
  const fileBuffer = remoteFile.buffer;

  // Ensure filename has proper extension
  let fileName = document.name?.trim() ?? "document";
  const actualContentType = (
    responseContentType?.split(";")[0] ?? contentType
  ).trim();
  const expectedExtension = getExtensionFromContentType(actualContentType);
  if (expectedExtension) {
    const lower = fileName.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    const currentExt = dotIdx !== -1 ? lower.slice(dotIdx + 1) : null;
    const alias: Record<string, string[]> = {
      jpeg: ["jpeg", "jpg"],
      jpg: ["jpg", "jpeg"],
      tiff: ["tiff", "tif"],
    };
    const matches =
      !!currentExt &&
      (currentExt === expectedExtension ||
        (alias[expectedExtension]?.includes(currentExt) ?? false));
    if (!matches) {
      fileName = `${fileName}.${expectedExtension}`;
    }
  }

  // Upload the file to storage
  const { type: storageType, data: fileData } = await putFileServer({
    file: {
      name: fileName,
      type: contentType,
      buffer: fileBuffer,
    },
    teamId: teamId,
    restricted: false,
  });

  if (!fileData || !storageType) {
    return res.status(500).json({ error: "Failed to save file to storage" });
  }

  // Create a new document version via the shared helper.
  // This handles version creation, primary flag management, and triggers
  // all document processing (pdf-to-image, docs/slides conversion, video, etc.)
  try {
    const versionResponse = await createNewDocumentVersion({
      documentData: {
        name: fileName,
        key: fileData,
        storageType: storageType,
        contentType: contentType,
        supportedFileType: supportedContentType,
        fileSize: fileBuffer.byteLength,
      },
      documentId: documentId,
      teamId: teamId,
      numPages: 1,
      token: token,
    });

    if (!versionResponse.ok) {
      const errorBody = await versionResponse.json().catch(() => ({}));
      return res.status(versionResponse.status).json({
        error: "Failed to create document version",
        details: errorBody,
      });
    }

    return res.status(200).json({
      message: "Document version created successfully",
      documentId: document.id,
    });
  } catch (error) {
    console.error("Document update error:", error);
    return res.status(500).json({ error: "Failed to create document version" });
  }
}

/**
 * Handle link.create resource type
 */
async function handleLinkCreate(
  data: z.infer<typeof LinkCreateSchema>,
  teamId: string,
  token: string,
  res: NextApiResponse,
) {
  const { targetId, linkType, link } = data;

  // Check if team is paused
  const teamIsPaused = await isTeamPausedById(teamId);
  if (teamIsPaused) {
    return res.status(403).json({
      error: "Team is currently paused. New link creation is not available.",
    });
  }

  // Validate target exists and belongs to the team
  if (linkType === "DOCUMENT_LINK") {
    const document = await prisma.document.findUnique({
      where: {
        id: targetId,
        teamId: teamId,
      },
    });

    if (!document) {
      return res
        .status(400)
        .json({ error: "Document not found or not associated with this team" });
    }
  } else if (linkType === "DATAROOM_LINK") {
    const dataroom = await prisma.dataroom.findUnique({
      where: {
        id: targetId,
        teamId: teamId,
      },
    });

    if (!dataroom) {
      return res
        .status(400)
        .json({ error: "Dataroom not found or not associated with this team" });
    }
  }

  // If domain and slug are provided, validate them
  let domainId = null;
  if (link.domain && link.slug) {
    // Check if domain exists
    const domain = await prisma.domain.findUnique({
      where: {
        slug: link.domain,
        teamId: teamId,
      },
      select: { id: true },
    });

    if (!domain) {
      return res
        .status(400)
        .json({ error: "Domain not found or not associated with this team" });
    }

    domainId = domain.id;

    // Check if the slug is already in use with this domain
    const existingLink = await prisma.link.findUnique({
      where: {
        domainSlug_slug: {
          slug: link.slug,
          domainSlug: link.domain,
        },
      },
    });

    if (existingLink) {
      return res
        .status(400)
        .json({ error: "The link with this domain and slug already exists" });
    }
  }

  // If preset is provided, validate it
  let preset: LinkPreset | null = null;
  let metaImage: string | null = null;
  let metaFavicon: string | null = null;
  if (link.presetId) {
    preset = await prisma.linkPreset.findUnique({
      where: { pId: link.presetId, teamId: teamId },
    });

    if (!preset) {
      return res.status(400).json({
        error: "Link preset not found or not associated with this team",
      });
    }

    // 4. Handle image files for custom meta tag (if enabled)
    if (preset.enableCustomMetaTag) {
      // Process meta image if present
      if (preset.metaImage && isDataUrl(preset.metaImage)) {
        const { buffer, mimeType, filename } = convertDataUrlToBuffer(
          preset.metaImage,
        );
        const blob = await put(filename, buffer, {
          access: "public",
          addRandomSuffix: true,
        });
        metaImage = blob.url;
      }

      // Process favicon if present
      if (preset.metaFavicon && isDataUrl(preset.metaFavicon)) {
        const { buffer, mimeType, filename } = convertDataUrlToBuffer(
          preset.metaFavicon,
        );
        const blob = await put(filename, buffer, {
          access: "public",
          addRandomSuffix: true,
        });
        metaFavicon = blob.url;
      }
    }
  }

  // Create the link
  try {
    // Hash password if provided
    const hashedPassword = link.password
      ? await generateEncrpytedPassword(link.password)
      : preset?.password
        ? await generateEncrpytedPassword(preset.password)
        : null;

    const expiresAtDate = link.expiresAt
      ? new Date(link.expiresAt)
      : preset?.expiresAt
        ? new Date(preset.expiresAt)
        : null;

    const isGroupAudience = link.audienceType === "GROUP";

    const newLink = await prisma.link.create({
      data: {
        documentId: linkType === "DOCUMENT_LINK" ? targetId : null,
        dataroomId: linkType === "DATAROOM_LINK" ? targetId : null,
        linkType,
        teamId,
        name: link.name,
        password: hashedPassword,
        domainId: domainId,
        domainSlug: link.domain || null,
        slug: link.slug || null,
        expiresAt: expiresAtDate,
        emailProtected: link.emailProtected ?? preset?.emailProtected ?? false,
        emailAuthenticated:
          link.emailAuthenticated ?? preset?.emailAuthenticated ?? false,
        allowDownload: link.allowDownload ?? preset?.allowDownload,
        enableNotification:
          link.enableNotification ?? preset?.enableNotification ?? false,
        enableFeedback: link.enableFeedback,
        enableScreenshotProtection: link.enableScreenshotProtection,
        enableConfidentialView:
          link.enableConfidentialView ??
          preset?.enableConfidentialView ??
          false,
        showBanner: link.showBanner ?? preset?.showBanner ?? false,
        audienceType: link.audienceType,
        groupId: isGroupAudience ? link.groupId : null,
        // For group links, ignore allow/deny lists from presets as access is controlled by group membership
        allowList: isGroupAudience
          ? link.allowList
          : link.allowList || preset?.allowList,
        denyList: isGroupAudience
          ? link.denyList
          : link.denyList || preset?.denyList,
        ...(preset?.enableCustomMetaTag && {
          enableCustomMetatag: preset?.enableCustomMetaTag,
          metaTitle: preset?.metaTitle,
          metaDescription: preset?.metaDescription,
          metaImage: metaImage,
          metaFavicon: metaFavicon,
        }),
      },
    });

    waitUntil(
      sendLinkCreatedWebhook({
        teamId,
        data: {
          document_id: linkType === "DOCUMENT_LINK" ? targetId : null,
          dataroom_id: linkType === "DATAROOM_LINK" ? targetId : null,
          link_id: newLink.id,
        },
      }),
    );

    return res.status(200).json({
      message: "Link created successfully",
      linkId: newLink.id,
      targetId,
      linkType,
      linkUrl:
        domainId && link.domain && link.slug
          ? `https://${newLink.domainSlug}/${newLink.slug}`
          : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${newLink.id}`,
    });
  } catch (error) {
    console.error("Link creation error:", error);
    return res.status(500).json({ error: "Failed to create link" });
  }
}

/**
 * Handle link.update resource type
 */
async function handleLinkUpdate(
  data: z.infer<typeof LinkUpdateSchema>,
  teamId: string,
  token: string,
  res: NextApiResponse,
) {
  const { linkId, link } = data;

  // Check if team is paused
  const teamIsPaused = await isTeamPausedById(teamId);
  if (teamIsPaused) {
    return res.status(403).json({
      error: "Team is currently paused. Link updates are not available.",
    });
  }

  // Validate link exists and belongs to the team
  const existingLink = await prisma.link.findUnique({
    where: {
      id: linkId,
      teamId: teamId,
    },
    select: {
      id: true,
      domainSlug: true,
      slug: true,
      documentId: true,
      dataroomId: true,
      linkType: true,
    },
  });

  if (!existingLink) {
    return res
      .status(404)
      .json({ error: "Link not found or not associated with this team" });
  }

  // If domain and slug are provided, validate them
  let domainId = null;

  // Reject requests where exactly one of domain/slug is present
  if (link.domain && !link.slug) {
    return res.status(400).json({
      error:
        "Both 'domain' and 'slug' must be provided together. 'slug' is missing.",
    });
  }
  if (link.slug && !link.domain) {
    return res.status(400).json({
      error:
        "Both 'domain' and 'slug' must be provided together. 'domain' is missing.",
    });
  }

  if (link.domain && link.slug) {
    // Check if domain exists
    const domain = await prisma.domain.findUnique({
      where: {
        slug: link.domain,
        teamId: teamId,
      },
      select: { id: true },
    });

    if (!domain) {
      return res
        .status(400)
        .json({ error: "Domain not found or not associated with this team" });
    }

    domainId = domain.id;

    // Check if the slug is already in use with this domain (excluding the current link)
    const conflictingLink = await prisma.link.findUnique({
      where: {
        domainSlug_slug: {
          slug: link.slug,
          domainSlug: link.domain,
        },
      },
    });

    if (conflictingLink && conflictingLink.id !== linkId) {
      return res
        .status(400)
        .json({ error: "The link with this domain and slug already exists" });
    }
  }

  // If preset is provided, validate it
  let preset: LinkPreset | null = null;
  let metaImage: string | null = null;
  let metaFavicon: string | null = null;
  if (link.presetId) {
    preset = await prisma.linkPreset.findUnique({
      where: { pId: link.presetId, teamId: teamId },
    });

    if (!preset) {
      return res.status(400).json({
        error: "Link preset not found or not associated with this team",
      });
    }

    // Handle image files for custom meta tag (if enabled)
    if (preset.enableCustomMetaTag) {
      // Process meta image if present
      if (preset.metaImage && isDataUrl(preset.metaImage)) {
        const { buffer, mimeType, filename } = convertDataUrlToBuffer(
          preset.metaImage,
        );
        const blob = await put(filename, buffer, {
          access: "public",
          addRandomSuffix: true,
        });
        metaImage = blob.url;
      }

      // Process favicon if present
      if (preset.metaFavicon && isDataUrl(preset.metaFavicon)) {
        const { buffer, mimeType, filename } = convertDataUrlToBuffer(
          preset.metaFavicon,
        );
        const blob = await put(filename, buffer, {
          access: "public",
          addRandomSuffix: true,
        });
        metaFavicon = blob.url;
      }
    }
  }

  // Update the link
  try {
    // Build update payload conditionally – only fields explicitly provided in
    // the incoming link payload (or supplied by a preset) are included.
    // Prisma treats missing / undefined keys as "do not update".
    const data: Record<string, unknown> = {};

    /** Returns true when the property was explicitly sent in the link payload */
    const has = (key: string): boolean => key in link;

    // name
    if (has("name")) {
      data.name = link.name;
    }

    // password – hash when provided via link or preset
    if (has("password")) {
      data.password = link.password
        ? await generateEncrpytedPassword(link.password)
        : null;
    } else if (preset?.password) {
      data.password = await generateEncrpytedPassword(preset.password);
    }

    // domain + slug (validated to always be paired earlier)
    if (has("domain") && has("slug")) {
      data.domainId = domainId;
      data.domainSlug = link.domain || null;
      data.slug = link.slug || null;
    }

    // expiresAt
    if (has("expiresAt")) {
      data.expiresAt = link.expiresAt ? new Date(link.expiresAt) : null;
    } else if (preset?.expiresAt) {
      data.expiresAt = new Date(preset.expiresAt);
    }

    // boolean flags – include when explicitly provided or when preset supplies a value
    if (has("emailProtected")) {
      data.emailProtected = link.emailProtected;
    } else if (preset?.emailProtected != null) {
      data.emailProtected = preset.emailProtected;
    }

    if (has("emailAuthenticated")) {
      data.emailAuthenticated = link.emailAuthenticated;
    } else if (preset?.emailAuthenticated != null) {
      data.emailAuthenticated = preset.emailAuthenticated;
    }

    if (has("allowDownload")) {
      data.allowDownload = link.allowDownload;
    } else if (preset?.allowDownload != null) {
      data.allowDownload = preset.allowDownload;
    }

    if (has("enableNotification")) {
      data.enableNotification = link.enableNotification;
    } else if (preset?.enableNotification != null) {
      data.enableNotification = preset.enableNotification;
    }

    if (has("enableFeedback")) {
      data.enableFeedback = link.enableFeedback;
    }

    if (has("enableScreenshotProtection")) {
      data.enableScreenshotProtection = link.enableScreenshotProtection;
    }

    if (has("enableConfidentialView")) {
      data.enableConfidentialView = link.enableConfidentialView;
    }

    if (has("showBanner")) {
      data.showBanner = link.showBanner;
    } else if (preset?.showBanner != null) {
      data.showBanner = preset.showBanner;
    }

    // audienceType & groupId
    if (has("audienceType")) {
      data.audienceType = link.audienceType;
      // When switching away from GROUP, clear groupId
      if (link.audienceType !== "GROUP") {
        data.groupId = null;
      } else if (has("groupId")) {
        data.groupId = link.groupId;
      }
    } else if (has("groupId")) {
      data.groupId = link.groupId;
    }

    // allow / deny lists
    // For group links, ignore preset lists as access is controlled by group membership
    const isGroupAudience =
      has("audienceType") && link.audienceType === "GROUP";

    if (has("allowList")) {
      data.allowList = link.allowList;
    } else if (!isGroupAudience && preset?.allowList) {
      data.allowList = preset.allowList;
    }

    if (has("denyList")) {
      data.denyList = link.denyList;
    } else if (!isGroupAudience && preset?.denyList) {
      data.denyList = preset.denyList;
    }

    // Preset custom meta tag fields – only applied when the preset flag is set
    if (preset?.enableCustomMetaTag) {
      data.enableCustomMetatag = preset.enableCustomMetaTag;
      data.metaTitle = preset.metaTitle;
      data.metaDescription = preset.metaDescription;
      data.metaImage = metaImage;
      data.metaFavicon = metaFavicon;
    }

    const updatedLink = await prisma.link.update({
      where: { id: linkId, teamId: teamId },
      data,
    });

    return res.status(200).json({
      message: "Link updated successfully",
      linkId: updatedLink.id,
      linkUrl:
        updatedLink.domainSlug && updatedLink.slug
          ? `https://${updatedLink.domainSlug}/${updatedLink.slug}`
          : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${updatedLink.id}`,
    });
  } catch (error) {
    console.error("Link update error:", error);
    return res.status(500).json({ error: "Failed to update link" });
  }
}

/**
 * Helper function to create dataroom folders recursively
 */
async function createDataroomFoldersRecursive(
  dataroomId: string,
  folders: Array<{ name: string; subfolders?: any[] }>,
  parentPath: string = "",
  parentId: string | null = null,
): Promise<void> {
  for (const folder of folders) {
    const folderPath = parentPath + "/" + safeSlugify(folder.name);

    // Create the folder
    const createdFolder = await prisma.dataroomFolder.create({
      data: {
        name: folder.name,
        path: folderPath,
        parentId: parentId,
        dataroomId: dataroomId,
      },
    });

    // If the folder has subfolders, create them recursively
    if (folder.subfolders && folder.subfolders.length > 0) {
      await createDataroomFoldersRecursive(
        dataroomId,
        folder.subfolders,
        folderPath,
        createdFolder.id,
      );
    }
  }
}

/**
 * Handle dataroom.create resource type
 */
async function handleDataroomCreate(
  data: z.infer<typeof DataroomCreateSchema>,
  teamId: string,
  token: string,
  res: NextApiResponse,
) {
  const { name, description, createLink, link, folders } = data;

  // Check if team is paused
  const teamIsPaused = await isTeamPausedById(teamId);
  if (teamIsPaused) {
    return res.status(403).json({
      error:
        "Team is currently paused. New dataroom creation is not available.",
    });
  }

  // If custom domain and slug are provided for link, validate them
  let domainId = null;
  if (createLink && link?.domain && link?.slug) {
    // Check if domain exists
    const domain = await prisma.domain.findUnique({
      where: {
        slug: link.domain,
        teamId: teamId,
      },
    });

    if (!domain) {
      return res
        .status(400)
        .json({ error: "Domain not found or not associated with this team" });
    }

    domainId = domain.id;

    // Check if the slug is already in use with this domain
    const existingLink = await prisma.link.findUnique({
      where: {
        domainSlug_slug: {
          slug: link.slug,
          domainSlug: link.domain,
        },
      },
    });

    if (existingLink) {
      return res
        .status(400)
        .json({ error: "The link with this domain and slug already exists" });
    }
  }

  // If preset is provided, validate it
  let preset: LinkPreset | null = null;
  let metaImage: string | null = null;
  let metaFavicon: string | null = null;
  if (createLink && link?.presetId) {
    preset = await prisma.linkPreset.findUnique({
      where: { pId: link.presetId, teamId: teamId },
    });

    if (!preset) {
      return res.status(400).json({
        error: "Link preset not found or not associated with this team",
      });
    }

    // Handle image files for custom meta tag (if enabled)
    if (preset.enableCustomMetaTag) {
      // Process meta image if present
      if (preset.metaImage && isDataUrl(preset.metaImage)) {
        const { buffer, mimeType, filename } = convertDataUrlToBuffer(
          preset.metaImage,
        );
        const blob = await put(filename, buffer, {
          access: "public",
          addRandomSuffix: true,
        });
        metaImage = blob.url;
      }

      // Process favicon if present
      if (preset.metaFavicon && isDataUrl(preset.metaFavicon)) {
        const { buffer, mimeType, filename } = convertDataUrlToBuffer(
          preset.metaFavicon,
        );
        const blob = await put(filename, buffer, {
          access: "public",
          addRandomSuffix: true,
        });
        metaFavicon = blob.url;
      }
    }
  }

  // Create the dataroom
  try {
    // Generate unique public ID for the dataroom
    const pId = newId("dataroom");

    const defaultBrandId = await resolveDefaultBrandId(teamId);

    let createData: any = {
      name,
      description,
      teamId,
      pId,
      brandId: defaultBrandId,
    };

    if (createLink && link) {
      const isGroupAudience = link.audienceType === "GROUP";
      const hashedPassword = link.password
        ? await generateEncrpytedPassword(link.password)
        : preset?.password
          ? await generateEncrpytedPassword(preset.password)
          : null;
      const expiresAtDate = link.expiresAt
        ? new Date(link.expiresAt)
        : preset?.expiresAt
          ? new Date(preset?.expiresAt)
          : null;

      createData.links = {
        create: {
          name: link.name,
          teamId,
          linkType: "DATAROOM_LINK",
          domainId: domainId,
          domainSlug: link.domain || null,
          slug: link.slug || null,
          password: hashedPassword,
          expiresAt: expiresAtDate,
          emailProtected:
            link.emailProtected ?? preset?.emailProtected ?? false,
          emailAuthenticated:
            link.emailAuthenticated ?? preset?.emailAuthenticated ?? false,
          allowDownload: link.allowDownload ?? preset?.allowDownload,
          enableNotification:
            link.enableNotification ?? preset?.enableNotification ?? false,
          enableFeedback: link.enableFeedback,
          enableScreenshotProtection: link.enableScreenshotProtection,
          enableConfidentialView:
            link.enableConfidentialView ??
            preset?.enableConfidentialView ??
            false,
          showBanner: link.showBanner ?? preset?.showBanner ?? false,
          audienceType: link.audienceType,
          groupId: isGroupAudience ? link.groupId : null,
          allowList: link.allowList || preset?.allowList,
          denyList: link.denyList || preset?.denyList,
          ...(preset?.enableCustomMetaTag && {
            enableCustomMetatag: preset?.enableCustomMetaTag,
            metaTitle: preset?.metaTitle,
            metaDescription: preset?.metaDescription,
            metaImage: metaImage,
            metaFavicon: metaFavicon,
          }),
        },
      };
    }

    const dataroom = await prisma.dataroom.create({
      data: createData,
      include: {
        links: createLink, // Only include links if we're creating one
      },
    });

    // Create folders if provided
    if (folders && folders.length > 0) {
      await createDataroomFoldersRecursive(dataroom.id, folders);
    }

    if (createLink) {
      waitUntil(
        sendLinkCreatedWebhook({
          teamId,
          data: {
            dataroom_id: dataroom.id,
            link_id: dataroom.links?.[0]?.id,
          },
        }),
      );
    }

    return res.status(200).json({
      message: "Dataroom created successfully",
      dataroomId: dataroom.id,
      linkId: createLink ? dataroom.links?.[0]?.id : undefined,
      linkUrl: createLink
        ? dataroom.links?.[0]?.domainSlug && dataroom.links?.[0]?.slug
          ? `https://${dataroom.links?.[0]?.domainSlug}/${dataroom.links?.[0]?.slug}`
          : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${dataroom.links?.[0]?.id}`
        : undefined,
    });
  } catch (error) {
    console.error("Dataroom creation error:", error);
    return res.status(500).json({ error: "Failed to create dataroom" });
  }
}
