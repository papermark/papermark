import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { checkRateLimit, rateLimiters } from "@/ee/features/security";
import { getLimits } from "@/ee/limits/server";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { LinkPreset } from "@prisma/client";
import { put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import {
  convertDataUrlToBuffer,
  generateEncrpytedPassword,
  isDataUrl,
} from "@/lib/utils";
import { sendLinkCreatedWebhook } from "@/lib/webhook/triggers/link-created";

// Reused from `pages/api/webhooks/services/[...path]/index.ts` so the CSV
// importer accepts the same option set users already configure through the
// incoming-webhooks API.
const LinkSchema = z
  .object({
    name: z.string().optional(),
    domain: z.string().optional(),
    slug: z.string().optional(),
    password: z.string().optional(),
    expiresAt: z.string().optional(), // ISO-8601 date string
    emailProtected: z.boolean().optional(),
    emailAuthenticated: z.boolean().optional(),
    allowDownload: z.boolean().optional(),
    enableNotification: z.boolean().optional(),
    enableScreenshotProtection: z.boolean().optional(),
    enableConfidentialView: z.boolean().optional(),
    showBanner: z.boolean().optional(),
    allowList: z.array(z.string()).optional(),
    denyList: z.array(z.string()).optional(),
    presetId: z.string().optional(),
  })
  .strict();

const RequestBodySchema = z
  .object({
    links: z.array(LinkSchema).min(1).max(500),
  })
  .strict();

type LinkInput = z.infer<typeof LinkSchema>;

interface BulkResult {
  row: number; // 1-based row number in the CSV (header excluded)
  name?: string;
  status: "success" | "error";
  linkId?: string;
  linkUrl?: string;
  error?: string;
}

interface CachedPreset {
  preset: LinkPreset | null;
  metaImage: string | null;
  metaFavicon: string | null;
}

interface BulkImportContext {
  teamId: string;
  targetId: string;
  linkType: "DOCUMENT_LINK" | "DATAROOM_LINK";
}

export async function handleBulkLinkImport(
  req: NextApiRequest,
  res: NextApiResponse,
  { teamId, targetId, linkType }: BulkImportContext,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = (session.user as CustomUser).id;

  const teamAccess = await prisma.userTeam.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamId: true },
  });
  if (!teamAccess) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Rate limit bulk imports per team to prevent abuse. Keyed by teamId so
  // multiple users on the same team share the budget and a single user
  // cannot bypass it by switching IPs.
  const rateLimitResult = await checkRateLimit(
    rateLimiters.bulkLinkImport,
    `team:${teamId}`,
  );
  if (!rateLimitResult.success) {
    return res.status(429).json({
      error:
        "Too many bulk link imports. Please wait before importing again.",
      remaining: rateLimitResult.remaining,
    });
  }

  const teamIsPaused = await isTeamPausedById(teamId);
  if (teamIsPaused) {
    return res.status(403).json({
      error: "Team is currently paused. New link creation is not available.",
    });
  }

  const validation = RequestBodySchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: validation.error.format(),
    });
  }

  const { links } = validation.data;

  // Lock the import to the resource encoded in the route. This prevents callers
  // from re-targeting rows to other documents or datarooms by bypassing the UI.
  if (linkType === "DOCUMENT_LINK") {
    const document = await prisma.document.findUnique({
      where: { id: targetId, teamId },
      select: { id: true },
    });
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
  } else {
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: targetId, teamId },
      select: { id: true, isFrozen: true },
    });
    if (!dataroom) {
      return res.status(404).json({ error: "Dataroom not found" });
    }
    if (dataroom.isFrozen) {
      return res.status(403).json({
        error: "This data room is frozen. Cannot create new links.",
      });
    }
  }

  // Enforce the team's plan link limit. We compute remaining capacity once
  // up front, then track creations locally so a single CSV cannot exceed
  // the cap (rows beyond the cap are returned as per-row errors).
  const limits = await getLimits({ teamId, userId });
  const linkLimit = limits?.links;
  const currentLinkCount = limits?.usage?.links ?? 0;
  const isUnlimited =
    linkLimit === undefined || linkLimit === null || !Number.isFinite(linkLimit);
  const remainingCapacity = isUnlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, (linkLimit as number) - currentLinkCount);

  if (remainingCapacity === 0) {
    return res.status(403).json({
      error: `You have reached your plan's link limit of ${linkLimit}. Upgrade your plan to create more links.`,
    });
  }

  // Pre-resolve presets and domains once per request to avoid duplicate
  // lookups across rows.
  const presetCache = new Map<string, CachedPreset>();
  const domainCache = new Map<string, { id: string } | null>();

  const results: BulkResult[] = [];
  let createdCount = 0;

  for (let i = 0; i < links.length; i++) {
    const row = links[i];
    const rowNumber = i + 1;

    if (createdCount >= remainingCapacity) {
      results.push({
        row: rowNumber,
        name: row.name,
        status: "error",
        error: `Link limit reached. Your plan allows ${linkLimit} link${
          linkLimit === 1 ? "" : "s"
        }. Upgrade your plan to create more links.`,
      });
      continue;
    }

    try {
      // Validate domain + slug pairing when provided.
      let domainId: string | null = null;
      if (row.domain && row.slug) {
        const domainCacheKey = `${teamId}:${row.domain}`;
        let domain = domainCache.get(domainCacheKey);
        if (domain === undefined) {
          domain = await prisma.domain.findUnique({
            where: { slug: row.domain, teamId },
            select: { id: true },
          });
          domainCache.set(domainCacheKey, domain);
        }
        if (!domain) {
          results.push({
            row: rowNumber,
            name: row.name,
            status: "error",
            error: "Domain not found or not associated with this team",
          });
          continue;
        }
        domainId = domain.id;

        const existingLink = await prisma.link.findUnique({
          where: {
            domainSlug_slug: { slug: row.slug, domainSlug: row.domain },
          },
          select: { id: true },
        });
        if (existingLink) {
          results.push({
            row: rowNumber,
            name: row.name,
            status: "error",
            error: "The link with this domain and slug already exists",
          });
          continue;
        }
      } else if (row.domain || row.slug) {
        results.push({
          row: rowNumber,
          name: row.name,
          status: "error",
          error: "Both 'domain' and 'slug' must be provided together",
        });
        continue;
      }

      // Resolve preset (cached).
      let preset: LinkPreset | null = null;
      let metaImage: string | null = null;
      let metaFavicon: string | null = null;
      if (row.presetId) {
        const cachedPreset = presetCache.get(row.presetId);
        if (cachedPreset) {
          preset = cachedPreset.preset;
          metaImage = cachedPreset.metaImage;
          metaFavicon = cachedPreset.metaFavicon;
        } else {
          preset = await prisma.linkPreset.findUnique({
            where: { pId: row.presetId, teamId },
          });

          if (preset?.enableCustomMetaTag) {
            if (preset.metaImage && isDataUrl(preset.metaImage)) {
              const { buffer, filename } = convertDataUrlToBuffer(
                preset.metaImage,
              );
              const blob = await put(filename, buffer, {
                access: "public",
                addRandomSuffix: true,
              });
              metaImage = blob.url;
            }
            if (preset.metaFavicon && isDataUrl(preset.metaFavicon)) {
              const { buffer, filename } = convertDataUrlToBuffer(
                preset.metaFavicon,
              );
              const blob = await put(filename, buffer, {
                access: "public",
                addRandomSuffix: true,
              });
              metaFavicon = blob.url;
            }
          }

          presetCache.set(row.presetId, {
            preset,
            metaImage,
            metaFavicon,
          });
        }

        if (!preset) {
          results.push({
            row: rowNumber,
            name: row.name,
            status: "error",
            error: "Link preset not found or not associated with this team",
          });
          continue;
        }
      }

      const newLink = await createLinkFromRow({
        row,
        teamId,
        userId,
        targetId,
        linkType,
        domainId,
        preset,
        metaImage,
        metaFavicon,
      });

      createdCount++;

      results.push({
        row: rowNumber,
        name: row.name ?? newLink.name ?? undefined,
        status: "success",
        linkId: newLink.id,
        linkUrl:
          newLink.domainSlug && newLink.slug
            ? `https://${newLink.domainSlug}/${newLink.slug}`
            : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${newLink.id}`,
      });

      waitUntil(
        sendLinkCreatedWebhook({
          teamId,
          data: {
            link_id: newLink.id,
            document_id: linkType === "DOCUMENT_LINK" ? targetId : null,
            dataroom_id: linkType === "DATAROOM_LINK" ? targetId : null,
          },
        }),
      );
    } catch (error) {
      console.error(`Bulk link import row ${rowNumber} failed:`, error);
      results.push({
        row: rowNumber,
        name: row.name,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while creating link",
      });
    }
  }

  const summary = {
    total: results.length,
    success: results.filter((result) => result.status === "success").length,
    failed: results.filter((result) => result.status === "error").length,
  };

  return res.status(200).json({ summary, results });
}

async function createLinkFromRow({
  row,
  teamId,
  userId,
  targetId,
  linkType,
  domainId,
  preset,
  metaImage,
  metaFavicon,
}: {
  row: LinkInput;
  teamId: string;
  userId: string;
  targetId: string;
  linkType: "DOCUMENT_LINK" | "DATAROOM_LINK";
  domainId: string | null;
  preset: LinkPreset | null;
  metaImage: string | null;
  metaFavicon: string | null;
}) {
  const hashedPassword = row.password
    ? await generateEncrpytedPassword(row.password)
    : preset?.password
      ? await generateEncrpytedPassword(preset.password)
      : null;

  const expiresAtDate = row.expiresAt
    ? new Date(row.expiresAt)
    : preset?.expiresAt
      ? new Date(preset.expiresAt)
      : null;

  if (expiresAtDate && Number.isNaN(expiresAtDate.getTime())) {
    throw new Error(
      `Invalid expiresAt date: '${row.expiresAt}'. Use ISO-8601 (e.g. 2025-12-31T23:59:00Z).`,
    );
  }

  return prisma.link.create({
    data: {
      documentId: linkType === "DOCUMENT_LINK" ? targetId : null,
      dataroomId: linkType === "DATAROOM_LINK" ? targetId : null,
      linkType,
      teamId,
      ownerId: userId,
      name: row.name ?? null,
      password: hashedPassword,
      domainId,
      domainSlug: row.domain || null,
      slug: row.slug || null,
      expiresAt: expiresAtDate,
      emailProtected: row.emailProtected ?? preset?.emailProtected ?? false,
      emailAuthenticated:
        row.emailAuthenticated ?? preset?.emailAuthenticated ?? false,
      allowDownload: row.allowDownload ?? preset?.allowDownload,
      enableNotification:
        row.enableNotification ?? preset?.enableNotification ?? false,
      enableScreenshotProtection: row.enableScreenshotProtection,
      enableConfidentialView:
        row.enableConfidentialView ?? preset?.enableConfidentialView,
      showBanner: row.showBanner ?? preset?.showBanner ?? false,
      allowList: row.allowList ?? preset?.allowList,
      denyList: row.denyList ?? preset?.denyList,
      ...(preset?.enableCustomMetaTag && {
        enableCustomMetatag: preset.enableCustomMetaTag,
        metaTitle: preset.metaTitle,
        metaDescription: preset.metaDescription,
        metaImage,
        metaFavicon,
      }),
    },
  });
}
