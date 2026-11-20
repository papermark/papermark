import { NextApiRequest, NextApiResponse } from "next";

import { resolveOwnedBrandId } from "@/ee/features/branding/lib/resolve-base-brand";
import { LinkAudienceType } from "@prisma/client";
import { customAlphabet } from "nanoid";
import { getServerSession } from "next-auth/next";

import { enforceLinkMemberScope } from "@/lib/api/rbac/guard";
import prisma from "@/lib/prisma";
import { CustomUser, WatermarkConfigSchema } from "@/lib/types";
import {
  decryptEncrpytedPassword,
  generateEncrpytedPassword,
} from "@/lib/utils";

import { DomainObject } from "..";
import { authOptions } from "../../auth/[...nextauth]";

/** See pages/api/links/index.ts — same semantics. */
function normalizeUploadFolderIds(linkData: {
  uploadFolderIds?: unknown;
}): string[] {
  if (
    !Object.prototype.hasOwnProperty.call(linkData, "uploadFolderIds") ||
    linkData.uploadFolderIds === undefined
  ) {
    return [];
  }
  if (!Array.isArray(linkData.uploadFolderIds)) {
    throw new TypeError("uploadFolderIds must be an array.");
  }
  const ids: string[] = [];
  for (const id of linkData.uploadFolderIds) {
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return Array.from(new Set(ids));
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PUT") {
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

    let resolvedLinkType: "DOCUMENT_LINK" | "DATAROOM_LINK" | null = null;
    let resolvedTargetId: string | null = null;

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

      // Dataroom-scoped members may only modify links within their rooms.
      const editDenied = await enforceLinkMemberScope({
        userId,
        teamId,
        linkId: existingLink.id,
        res,
      });
      if (editDenied) return;

      if (existingLink.dataroom?.isFrozen) {
        return res.status(403).json({
          error:
            "This data room is frozen. You cannot modify links for a frozen data room.",
        });
      }

      resolvedLinkType = linkType ?? existingLink.linkType;

      if (
        resolvedLinkType !== "DOCUMENT_LINK" &&
        resolvedLinkType !== "DATAROOM_LINK"
      ) {
        return res.status(400).json({ error: "Invalid link type." });
      }

      resolvedTargetId =
        targetId ??
        (resolvedLinkType === "DATAROOM_LINK"
          ? existingLink.dataroomId
          : existingLink.documentId);

      if (!resolvedTargetId) {
        return res.status(400).json({
          error: "A target document or data room is required.",
        });
      }

      if (resolvedLinkType === "DOCUMENT_LINK") {
        const destinationDocument = await prisma.document.findUnique({
          where: { id: resolvedTargetId, teamId },
          select: { id: true },
        });
        if (!destinationDocument) {
          return res.status(400).json({
            error: "Invalid document.",
          });
        }
      } else {
        const destinationDataroom = await prisma.dataroom.findUnique({
          where: { id: resolvedTargetId, teamId },
          select: { isFrozen: true },
        });
        if (!destinationDataroom) {
          return res.status(400).json({
            error: "Invalid data room.",
          });
        }
        if (destinationDataroom.isFrozen) {
          return res.status(403).json({
            error:
              "This data room is frozen. You cannot modify links for a frozen data room.",
          });
        }
      }

      // ViewerGroup (groupId) and PermissionGroup (permissionGroupId) are
      // both scoped to a specific dataroom. Whenever the request carries
      // either binding, ensure it actually belongs to the resolved target
      // dataroom — this also covers the case where the target changes but
      // the client forgets to clear/replace a stale group reference.
      const incomingGroupId =
        typeof req.body.groupId === "string" && req.body.groupId.length > 0
          ? req.body.groupId
          : null;
      const incomingPermissionGroupId =
        typeof req.body.permissionGroupId === "string" &&
        req.body.permissionGroupId.length > 0
          ? req.body.permissionGroupId
          : null;

      if (incomingGroupId || incomingPermissionGroupId) {
        if (resolvedLinkType !== "DATAROOM_LINK") {
          return res.status(400).json({
            error:
              "Visitor groups and permission groups can only be assigned to dataroom links.",
          });
        }

        if (incomingGroupId) {
          const viewerGroup = await prisma.viewerGroup.findFirst({
            where: {
              id: incomingGroupId,
              teamId,
              dataroomId: resolvedTargetId,
            },
            select: { id: true },
          });
          if (!viewerGroup) {
            return res.status(400).json({
              error:
                "The selected visitor group does not belong to this data room.",
            });
          }
        }

        if (incomingPermissionGroupId) {
          const permissionGroup = await prisma.permissionGroup.findFirst({
            where: {
              id: incomingPermissionGroupId,
              teamId,
              dataroomId: resolvedTargetId,
            },
            select: { id: true },
          });
          if (!permissionGroup) {
            return res.status(400).json({
              error:
                "The selected permission group does not belong to this data room.",
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

    if (!resolvedLinkType || !resolvedTargetId) {
      return res.status(400).json({
        error: "A target document or data room is required.",
      });
    }

    const dataroomLink = resolvedLinkType === "DATAROOM_LINK";
    const documentLink = resolvedLinkType === "DOCUMENT_LINK";

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
          teamId,
        },
      });

      if (!domainObj) {
        return res.status(400).json({
          error: "Domain not found or not associated with this team.",
        });
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

    // Validate upload folder IDs belong to the target dataroom. Without this
    // check, a tampered payload could persist arbitrary folder cuids (including
    // ones from other datarooms/teams) into the link.
    let validatedUploadFolderIds: string[] = [];
    let validatedUploadFolders: { id: string; name: string; path: string }[] =
      [];
    if (linkData.enableUpload) {
      let normalizedIds: string[];
      try {
        normalizedIds = normalizeUploadFolderIds(linkData);
      } catch (err) {
        if (err instanceof TypeError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }

      if (normalizedIds.length > 0) {
        if (!dataroomLink || !resolvedTargetId) {
          return res.status(400).json({
            error: "Upload folders can only be assigned to dataroom links.",
          });
        }

        const validFolders = await prisma.dataroomFolder.findMany({
          where: {
            id: { in: normalizedIds },
            dataroomId: resolvedTargetId,
          },
          select: { id: true, name: true, path: true },
        });
        const byId = new Map(validFolders.map((f) => [f.id, f]));

        if (byId.size !== normalizedIds.length) {
          return res.status(400).json({
            error:
              "One or more upload folders do not belong to this data room.",
          });
        }

        validatedUploadFolderIds = normalizedIds.filter((id) => byId.has(id));
        validatedUploadFolders = validatedUploadFolderIds
          .map((id) => byId.get(id))
          .filter((f): f is { id: string; name: string; path: string } => !!f);
      }
    }

    const nextBrandId =
      linkData.brandId === undefined
        ? undefined
        : await resolveOwnedBrandId(teamId, linkData.brandId);

    const updatedLink = await prisma.$transaction(async (tx) => {
      const link = await tx.link.update({
        where: { id, teamId },
        data: {
          documentId: documentLink ? resolvedTargetId : null,
          dataroomId: dataroomLink ? resolvedTargetId : null,
          linkType: resolvedLinkType,
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
          enableConfidentialView: linkData.enableConfidentialView,
          enableCustomMetatag: linkData.enableCustomMetatag,
          metaTitle: linkData.metaTitle || null,
          metaDescription: linkData.metaDescription || null,
          metaImage: linkData.metaImage || null,
          metaFavicon: linkData.metaFavicon || null,
          welcomeMessage: linkData.welcomeMessage || null,
          ...(nextBrandId !== undefined && { brandId: nextBrandId }),
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
          uploadFolderIds: linkData.enableUpload
            ? validatedUploadFolderIds
            : [],
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
            data: linkData.visitorGroupIds.map((visitorGroupId: string) => ({
              linkId: id,
              visitorGroupId,
            })),
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

    // Echo the resolved folder allow-list so the client can render chips with
    // the correct folder names without an extra round-trip.
    const responseLink = {
      ...updatedLink,
      uploadFolders: validatedUploadFolders,
    };

    return res.status(200).json(responseLink);
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

      // Dataroom-scoped members may only delete links within their rooms.
      if (linkToBeDeleted.teamId) {
        const deleteDenied = await enforceLinkMemberScope({
          userId,
          teamId: linkToBeDeleted.teamId,
          linkId: linkToBeDeleted.id,
          res,
        });
        if (deleteDenied) return;
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

  // We only allow PUT and DELETE requests
  res.setHeader("Allow", ["PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
