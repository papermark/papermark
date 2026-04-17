import { NextApiRequest, NextApiResponse } from "next";

import { Brand, DataroomBrand, LinkAudienceType } from "@prisma/client";
import { customAlphabet } from "nanoid";
import { getServerSession } from "next-auth/next";

import {
  fetchDataroomLinkData,
  fetchDocumentLinkData,
} from "@/lib/api/links/link-data";
import prisma from "@/lib/prisma";
import { CustomUser, WatermarkConfigSchema } from "@/lib/types";
import {
  decryptEncrpytedPassword,
  generateEncrpytedPassword,
} from "@/lib/utils";
import { checkGlobalBlockList } from "@/lib/utils/global-block-list";

import { DomainObject } from "..";
import { authOptions } from "../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/links/:id
    const { id } = req.query as { id: string };

    try {
      console.time("get-link");
      const link = await prisma.link.findUnique({
        where: {
          id: id,
        },
        select: {
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
              orderIndex: "asc",
            },
          },
        },
      });

      console.timeEnd("get-link");

      if (!link) {
        return res.status(404).json({ error: "Link not found" });
      }

      if (link.deletedAt) {
        return res.status(404).json({ error: "Link has been deleted" });
      }

      if (link.isArchived) {
        return res.status(404).json({ error: "Link is archived" });
      }

      const { email } = req.query as { email?: string };
      const globalBlockCheck = checkGlobalBlockList(
        email,
        link.team?.globalBlockList,
      );
      if (globalBlockCheck.error) {
        return res.status(400).json({ message: globalBlockCheck.error });
      }
      if (globalBlockCheck.isBlocked) {
        return res.status(403).json({ message: "Access denied" });
      }

      const linkType = link.linkType;

      // Handle workflow links separately
      if (linkType === "WORKFLOW_LINK") {
        // For workflow links, fetch brand if available
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

        return res.status(200).json({ linkType, brand });
      }

      let brand: Partial<Brand> | Partial<DataroomBrand> | null = null;
      let linkData: any;

      if (linkType === "DOCUMENT_LINK") {
        console.time("get-document-link-data");
        const data = await fetchDocumentLinkData({
          linkId: id,
          teamId: link.teamId!,
        });
        linkData = data.linkData;
        brand = data.brand;
        console.timeEnd("get-document-link-data");
      } else if (linkType === "DATAROOM_LINK") {
        console.time("get-dataroom-link-data");
        const data = await fetchDataroomLinkData({
          linkId: id,
          dataroomId: link.dataroomId,
          teamId: link.teamId!,
          permissionGroupId: link.permissionGroupId || undefined,
          ...(link.audienceType === LinkAudienceType.GROUP &&
            link.groupId && {
              groupId: link.groupId,
            }),
        });
        linkData = data.linkData;
        brand = data.brand;
        // Include access controls in the link data for the frontend
        linkData.accessControls = data.accessControls;
        console.timeEnd("get-dataroom-link-data");
      }

      const teamPlan = link.team?.plan || "free";

      const returnLink = {
        ...link,
        ...linkData,
        dataroomId: undefined,
        ...(teamPlan === "free" && {
          customFields: [], // reset custom fields for free plan
          enableAgreement: false,
          enableWatermark: false,
          permissionGroupId: null,
        }),
      };

      return res.status(200).json({ linkType, link: returnLink, brand });
    } catch (error) {
      console.error("Error fetching link data:", error);
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
    }
  } else if (req.method === "PUT") {
    // PUT /api/links/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const { id } = req.query as { id: string };
    const {
      targetId,
      linkType,
      password,
      expiresAt,
      teamId,
      ...linkDomainData
    } = req.body;

    const dataroomLink = linkType === "DATAROOM_LINK";
    const documentLink = linkType === "DOCUMENT_LINK";

    try {
      const existingLink = await prisma.link.findUnique({
        where: {
          id: id,
          teamId: teamId,
          team: {
            users: {
              some: { userId },
            },
          },
        },
        select: {
          id: true,
          linkType: true,
          dataroomId: true,
          documentId: true,
          dataroom: { select: { isFrozen: true } },
        },
      });

      if (!existingLink) {
        return res
          .status(404)
          .json({ error: "Link not found or unauthorized" });
      }

      if (existingLink.dataroom?.isFrozen) {
        return res.status(403).json({
          error:
            "This data room is frozen. You cannot modify links for a frozen data room.",
        });
      }

      // If the PUT retargets the link (different targetId or linkType),
      // ensure the destination dataroom is not frozen.
      if (dataroomLink && targetId) {
        const existingTargetId =
          existingLink.linkType === "DATAROOM_LINK"
            ? existingLink.dataroomId
            : existingLink.documentId;
        const isRetargeting =
          existingLink.linkType !== linkType || existingTargetId !== targetId;

        if (isRetargeting) {
          const destinationDataroom = await prisma.dataroom.findUnique({
            where: { id: targetId, teamId },
            select: { isFrozen: true },
          });
          if (destinationDataroom?.isFrozen) {
            return res.status(403).json({
              error:
                "This data room is frozen. You cannot modify links for a frozen data room.",
            });
          }
        }
      }
    } catch (error) {
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
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

      const currentLink = await prisma.link.findUnique({
        where: { id: id },
        select: {
          id: true,
          domainSlug: true,
          slug: true,
        },
      });

      // if the slug or domainSlug has changed, check if the new slug is unique
      if (currentLink?.slug !== slug || currentLink?.domainSlug !== domain) {
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
    }

    if (linkData.enableAgreement && !linkData.agreementId) {
      return res.status(400).json({
        error: "No agreement selected.",
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
          error: "One or more visitor group IDs do not belong to this team.",
        });
      }
    }

    const updatedLink = await prisma.$transaction(async (tx) => {
      const link = await tx.link.update({
        where: { id, teamId },
        data: {
          documentId: documentLink ? targetId : null,
          dataroomId: dataroomLink ? targetId : null,
          password: hashedPassword,
          name: linkData.name || null,
          emailProtected:
            linkData.audienceType === LinkAudienceType.GROUP
              ? true
              : linkData.emailProtected,
          emailAuthenticated: linkData.emailAuthenticated,
          allowDownload: linkData.allowDownload,
          allowList: linkData.allowList,
          denyList: linkData.denyList,
          expiresAt: exat,
          domainId: domainObj?.id || null,
          domainSlug: domain || null,
          slug: slug || null,
          enableIndexFile: linkData.enableIndexFile || false,
          enableNotification: linkData.enableNotification,
          enableFeedback: linkData.enableFeedback,
          enableScreenshotProtection: linkData.enableScreenshotProtection,
          enableCustomMetatag: linkData.enableCustomMetatag,
          metaTitle: linkData.metaTitle || null,
          metaDescription: linkData.metaDescription || null,
          metaImage: linkData.metaImage || null,
          metaFavicon: linkData.metaFavicon || null,
          welcomeMessage: linkData.welcomeMessage || null,
          ...(linkData.customFields && {
            customFields: {
              deleteMany: {}, // Delete all existing custom fields
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
                skipDuplicates: true,
              },
            },
          }),
          enableQuestion: linkData.enableQuestion,
          ...(linkData.enableQuestion && {
            feedback: {
              upsert: {
                create: {
                  data: {
                    question: linkData.questionText,
                    type: linkData.questionType,
                  },
                },
                update: {
                  data: {
                    question: linkData.questionText,
                    type: linkData.questionType,
                  },
                },
              },
            },
          }),
          enableAgreement: linkData.enableAgreement,
          agreementId: linkData.agreementId || null,
          showBanner: linkData.showBanner,
          enableWatermark: linkData.enableWatermark || false,
          watermarkConfig: linkData.watermarkConfig || null,
          groupId: linkData.groupId || null,
          permissionGroupId: linkData.permissionGroupId || null,
          audienceType: linkData.audienceType || LinkAudienceType.GENERAL,
          enableConversation: linkData.enableConversation || false,
          enableAIAgents: linkData.enableAIAgents || false,
          enableUpload: linkData.enableUpload || false,
          isFileRequestOnly: linkData.isFileRequestOnly || false,
          uploadFolderId: linkData.uploadFolderId || null,
        },
        include: {
          customFields: true,
          visitorGroups: {
            select: {
              visitorGroupId: true,
            },
          },
          views: {
            orderBy: {
              viewedAt: "desc",
            },
            take: 1,
          },
          _count: {
            select: { views: true },
          },
        },
      });

      if (linkData.enableConversation && dataroomLink && link.dataroomId) {
        await tx.dataroom.update({
          where: { id: link.dataroomId, teamId: link.teamId! },
          data: { conversationsEnabled: true },
        });
      }

      // Update visitor groups (replace all)
      if (linkData.visitorGroupIds !== undefined) {
        // Delete existing visitor group associations
        await tx.linkVisitorGroup.deleteMany({
          where: { linkId: id },
        });

        // Create new associations
        if (linkData.visitorGroupIds?.length > 0) {
          await tx.linkVisitorGroup.createMany({
            data: linkData.visitorGroupIds.map(
              (visitorGroupId: string) => ({
                linkId: id,
                visitorGroupId,
              }),
            ),
            skipDuplicates: true,
          });
        }
      }
      if (linkData.tags?.length) {
        // Remove only tags that are not in the new list
        await tx.tagItem.deleteMany({
          where: {
            linkId: id,
            itemType: "LINK_TAG",
            tagId: { notIn: linkData.tags },
          },
        });

        // Add new tags while avoiding duplicates
        await tx.tagItem.createMany({
          data: linkData.tags.map((tagId: string) => ({
            tagId,
            itemType: "LINK_TAG",
            linkId: id,
            taggedBy: userId,
          })),
          skipDuplicates: true,
        });
      } else {
        // If all tags are removed, delete all tagged items for this link
        await tx.tagItem.deleteMany({
          where: {
            linkId: id,
            itemType: "LINK_TAG",
          },
        });
      }

      const tags = await tx.tag.findMany({
        where: {
          items: {
            some: { linkId: link.id },
          },
        },
        select: {
          id: true,
          name: true,
          color: true,
          description: true,
        },
      });

      // Re-fetch visitor groups to get post-update associations
      const freshVisitorGroups = await tx.linkVisitorGroup.findMany({
        where: { linkId: id },
        select: { visitorGroupId: true },
      });

      return { ...link, visitorGroups: freshVisitorGroups, tags };
    });

    if (!updatedLink) {
      return res.status(404).json({ error: "Link not found" });
    }

    await fetch(
      `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&linkId=${id}&hasDomain=${updatedLink.domainId ? "true" : "false"}`,
    );

    // Decrypt the password for the updated link
    if (updatedLink.password !== null) {
      updatedLink.password = decryptEncrpytedPassword(updatedLink.password);
    }

    return res.status(200).json(updatedLink);
  } else if (req.method == "DELETE") {
    // DELETE /api/links/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const { id } = req.query as { id: string };

    try {
      const linkToBeDeleted = await prisma.link.findUnique({
        where: {
          id: id,
        },
        include: {
          document: {
            select: {
              ownerId: true,
            },
          },
          dataroom: {
            select: {
              teamId: true,
            },
          },
          team: {
            select: {
              plan: true,
              users: {
                where: {
                  userId: userId,
                },
                select: {
                  userId: true,
                  role: true,
                },
              },
            },
          },
        },
      });

      if (!linkToBeDeleted) {
        return res.status(404).json({ error: "Link not found" });
      }

      // Check if team is on free plan
      if (linkToBeDeleted.team?.plan === "free") {
        return res.status(403).json({
          error:
            "Link deletion is not available on the free plan. Please upgrade to delete links.",
        });
      }

      // Check authorization based on link type
      let isAuthorized = false;

      if (linkToBeDeleted.documentId && linkToBeDeleted.document) {
        // Document link - check if user owns the document
        isAuthorized = linkToBeDeleted.document.ownerId === userId;
      } else if (linkToBeDeleted.dataroomId && linkToBeDeleted.team) {
        // Dataroom link - check if user is a member of the team
        isAuthorized = linkToBeDeleted.team.users.length > 0;
      }

      if (!isAuthorized) {
        return res.status(401).end("Unauthorized to delete this link");
      }

      // Generate a random suffix for the deleted slug to free up the original slug
      const generateDeletedSuffix = customAlphabet(
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        6,
      );

      // Soft delete the link by setting deletedAt and isArchived,
      // and rename the slug so the original can be reused
      await prisma.link.update({
        where: {
          id: id,
        },
        data: {
          deletedAt: new Date(),
          isArchived: true,
          ...(linkToBeDeleted.slug && {
            slug: `${linkToBeDeleted.slug}-DELETED-${generateDeletedSuffix()}`,
          }),
        },
      });

      res.status(204).end(); // 204 No Content response for successful deletes
    } catch (error) {
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
    }
  }

  // We only allow GET and PUT requests
  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
