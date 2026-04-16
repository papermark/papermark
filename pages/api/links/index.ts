import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { LinkAudienceType, Tag } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser, WatermarkConfigSchema } from "@/lib/types";
import {
  decryptEncrpytedPassword,
  generateEncrpytedPassword,
} from "@/lib/utils";
import { sendLinkCreatedWebhook } from "@/lib/webhook/triggers/link-created";

import { authOptions } from "../auth/[...nextauth]";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

export interface DomainObject {
  id: string;
  slug: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // POST /api/links
  if (req.method === "POST") {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      targetId,
      linkType,
      password,
      expiresAt,
      teamId,
      enableIndexFile,
      ...linkDomainData
    } = req.body;

    const userId = (session.user as CustomUser).id;

    const dataroomLink = linkType === "DATAROOM_LINK";
    const documentLink = linkType === "DOCUMENT_LINK";

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId,
            teamId,
          },
        },
        select: { teamId: true },
      });

      if (!teamAccess) {
        return res.status(401).json({ error: "Unauthorized." });
      }

      // Check if team is paused
      const teamIsPaused = await isTeamPausedById(teamId);
      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. New link creation is not available.",
        });
      }

      if (dataroomLink && targetId) {
        const dataroom = await prisma.dataroom.findUnique({
          where: { id: targetId, teamId },
          select: { isFrozen: true },
        });
        if (dataroom?.isFrozen) {
          return res.status(403).json({
            error:
              "This data room is frozen. You cannot create new links for a frozen data room.",
          });
        }
      }

      const hashedPassword =
        password && password.length > 0
          ? await generateEncrpytedPassword(password)
          : null;
      const exat = expiresAt ? new Date(expiresAt) : null;

      let { domain, slug, ...linkData } = linkDomainData;

      // set domain and slug to null if the domain is papermark.com
      if (domain && domain === "papermark.com") {
        domain = null;
        slug = null;
      }

      let domainObj: DomainObject | null;

      if (domain && slug) {
        domainObj = await prisma.domain.findUnique({
          where: {
            slug: domain,
          },
        });

        if (!domainObj) {
          return res.status(400).json({ error: "Domain not found." });
        }

        const existingLink = await prisma.link.findUnique({
          where: {
            domainSlug_slug: {
              slug: slug,
              domainSlug: domain,
            },
          },
        });

        if (existingLink) {
          return res.status(400).json({
            error: "The link already exists.",
          });
        }
      }

      if (linkData.enableAgreement && !linkData.agreementId) {
        return res.status(400).json({
          error: "No agreement selected.",
        });
      }

      if (
        linkData.audienceType === LinkAudienceType.GROUP &&
        !linkData.groupId
      ) {
        return res.status(400).json({
          error: "No group selected.",
        });
      }

      if (linkData.enableWatermark) {
        if (!linkData.watermarkConfig) {
          return res.status(400).json({
            error:
              "Watermark configuration is required when watermark is enabled.",
          });
        }

        // Validate the watermark config structure
        const validation = WatermarkConfigSchema.safeParse(
          linkData.watermarkConfig,
        );
        if (!validation.success) {
          return res.status(400).json({
            error: "Invalid watermark configuration.",
            details: validation.error.issues
              .map((issue) => issue.message)
              .join(", "),
          });
        }
      }

      // Validate visitor group IDs belong to this team
      if (linkData.visitorGroupIds?.length > 0) {
        const validGroups = await prisma.visitorGroup.findMany({
          where: {
            id: { in: linkData.visitorGroupIds },
            teamId: teamId,
          },
          select: { id: true },
        });

        if (validGroups.length !== linkData.visitorGroupIds.length) {
          return res.status(400).json({
            error:
              "One or more visitor group IDs do not belong to this team.",
          });
        }
      }

      // Fetch the link and its related document from the database
      const updatedLink = await prisma.$transaction(async (tx) => {
        const link = await tx.link.create({
          data: {
            documentId: documentLink ? targetId : null,
            dataroomId: dataroomLink ? targetId : null,
            linkType,
            teamId,
            ownerId: userId,
            password: hashedPassword,
            name: linkData.name || null,
            emailProtected:
              linkData.audienceType === LinkAudienceType.GROUP
                ? true
                : linkData.emailProtected,
            emailAuthenticated: linkData.emailAuthenticated,
            expiresAt: exat,
            allowDownload: linkData.allowDownload,
            domainId: domainObj?.id || null,
            domainSlug: domain || null,
            slug: slug || null,
            enableIndexFile: enableIndexFile,
            enableNotification: linkData.enableNotification,
            enableFeedback: linkData.enableFeedback,
            enableScreenshotProtection: linkData.enableScreenshotProtection,
            enableCustomMetatag: linkData.enableCustomMetatag,
            metaTitle: linkData.metaTitle || null,
            metaDescription: linkData.metaDescription || null,
            metaImage: linkData.metaImage || null,
            metaFavicon: linkData.metaFavicon || null,
            welcomeMessage: linkData.welcomeMessage || null,
            allowList: linkData.allowList,
            denyList: linkData.denyList,
            audienceType: linkData.audienceType,
            groupId:
              linkData.audienceType === LinkAudienceType.GROUP
                ? linkData.groupId
                : null,
            ...(linkData.enableQuestion && {
              enableQuestion: linkData.enableQuestion,
              feedback: {
                create: {
                  data: {
                    question: linkData.questionText,
                    type: linkData.questionType,
                  },
                },
              },
            }),
            ...(linkData.enableAgreement && {
              enableAgreement: linkData.enableAgreement,
              agreementId: linkData.agreementId,
            }),
            ...(linkData.enableWatermark && {
              enableWatermark: linkData.enableWatermark,
              watermarkConfig: linkData.watermarkConfig,
            }),
            ...(linkData.enableUpload && {
              enableUpload: linkData.enableUpload,
              isFileRequestOnly: linkData.isFileRequestOnly,
              uploadFolderId: linkData.uploadFolderId,
            }),
            enableAIAgents: linkData.enableAIAgents || false,
            enableConversation: linkData.enableConversation || false,
            showBanner: linkData.showBanner,
            ...(linkData.customFields && {
              customFields: {
                createMany: {
                  data: linkData.customFields.map(
                    (field: any, index: number) => ({
                      type: field.type,
                      identifier: field.identifier,
                      label: field.label,
                      placeholder: field.placeholder,
                      required: field.required,
                      disabled: field.disabled,
                      orderIndex: index,
                    }),
                  ),
                },
              },
            }),
            // Connect visitor groups for allow-list
            ...(linkData.visitorGroupIds?.length > 0 && {
              visitorGroups: {
                createMany: {
                  data: linkData.visitorGroupIds.map(
                    (visitorGroupId: string) => ({
                      visitorGroupId,
                    }),
                  ),
                },
              },
            }),
          },
          include: {
            customFields: true,
            visitorGroups: {
              select: {
                visitorGroupId: true,
              },
            },
          },
        });

        if (linkData.enableConversation && dataroomLink) {
          await tx.dataroom.updateMany({
            where: { id: targetId, teamId },
            data: { conversationsEnabled: true },
          });
        }

        let tags: Partial<Tag>[] = [];
        if (linkData.tags?.length) {
          // create tag items
          await tx.tagItem.createMany({
            data: linkData.tags.map((tagId: string) => ({
              tagId,
              itemType: "LINK_TAG",
              linkId: link.id,
              taggedBy: userId,
            })),
            skipDuplicates: true,
          });

          // return tags
          tags = await tx.tag.findMany({
            where: { id: { in: linkData.tags } },
            select: { id: true, name: true, color: true, description: true },
          });
        }

        return { ...link, tags };
      });

      const linkWithView = {
        ...updatedLink,
        _count: { views: 0 },
        views: [],
      };

      if (!linkWithView) {
        return res.status(404).json({ error: "Link not found" });
      }

      waitUntil(
        sendLinkCreatedWebhook({
          teamId,
          data: {
            link_id: linkWithView.id,
            document_id: linkWithView.documentId,
            dataroom_id: linkWithView.dataroomId,
          },
        }),
      );

      // Revalidate the view page to pre-generate it
      await fetch(
        `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&linkId=${linkWithView.id}&hasDomain=${linkWithView.domainId ? "true" : "false"}`,
      );

      // Decrypt the password for the new link
      if (linkWithView.password !== null) {
        linkWithView.password = decryptEncrpytedPassword(linkWithView.password);
      }

      return res.status(200).json(linkWithView);
    } catch (error) {
      errorhandler(error, res);
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
