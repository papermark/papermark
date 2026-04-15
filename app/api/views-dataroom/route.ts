import { NextRequest, NextResponse } from "next/server";

import { reportDeniedAccessAttempt } from "@/ee/features/access-notifications";
import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { ItemType, LinkAudienceType } from "@prisma/client";
import { ipAddress, waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth";

import { hashToken } from "@/lib/api/auth/token";
import {
  DataroomSession,
  collectFingerprintHeaders,
  createDataroomSession,
  generateSessionFingerprint,
} from "@/lib/auth/dataroom-auth";
import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import { PreviewSession, verifyPreviewSession } from "@/lib/auth/preview-auth";
import { sendOtpVerificationEmail } from "@/lib/emails/send-email-otp-verification";
import { getFile } from "@/lib/files/get-file";
import { newId } from "@/lib/id-helper";
import {
  notifyDataroomAccess,
  notifyDocumentView,
} from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { parseSheet } from "@/lib/sheet";
import { recordLinkView } from "@/lib/tracking/record-link-view";
import { CustomUser, WatermarkConfigSchema } from "@/lib/types";
import { checkPassword, decryptEncrpytedPassword, log } from "@/lib/utils";
import { extractEmailDomain, isEmailMatched } from "@/lib/utils/email-domain";
import { generateOTP } from "@/lib/utils/generate-otp";
import { LOCALHOST_IP } from "@/lib/utils/geo";
import { checkGlobalBlockList } from "@/lib/utils/global-block-list";
import { validateEmail } from "@/lib/utils/validate-email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      linkId,
      documentId,
      dataroomId,
      userId,
      documentVersionId,
      documentName,
      hasPages,
      ownerId,
      linkType,
      dataroomViewId,
      viewType,
      groupId,
      startPage,
      ...data
    } = body as {
      linkId: string;
      documentId: string | undefined;
      dataroomId: string;
      userId: string | null;
      documentVersionId: string | undefined;
      documentName: string | undefined;
      hasPages: boolean | undefined;
      ownerId: string | null;
      linkType: string;
      dataroomViewId?: string;
      viewType: "DATAROOM_VIEW" | "DOCUMENT_VIEW";
      groupId?: string;
      startPage?: number;
    };

    const { email, password, name, hasConfirmedAgreement } = data as {
      email: string;
      password: string;
      name?: string;
      hasConfirmedAgreement?: boolean;
    };

    // Add customFields to the data extraction
    const { customFields } = data as {
      customFields?: { [key: string]: string };
    };

    // INFO: for using the advanced excel viewer
    let { useAdvancedExcelViewer } = data as {
      useAdvancedExcelViewer: boolean;
    };

    // previewToken is used to determine if the view is a preview and therefore should not be recorded
    const { previewToken } = data as {
      previewToken?: string;
    };

    // Email Verification Data
    const { code, token, verifiedEmail } = data as {
      code?: string;
      token?: string;
      verifiedEmail?: string;
    };

    // Fetch the link to verify the settings
    const link = await prisma.link.findUnique({
      where: {
        id: linkId,
      },
      select: {
        id: true,
        name: true,
        documentId: true,
        dataroomId: true,
        emailProtected: true,
        enableNotification: true,
        emailAuthenticated: true,
        password: true,
        domainSlug: true,
        isArchived: true,
        deletedAt: true,
        slug: true,
        domainId: true,
        allowList: true,
        denyList: true,
        enableAgreement: true,
        agreementId: true,
        enableWatermark: true,
        watermarkConfig: true,
        groupId: true,
        permissionGroupId: true,
        audienceType: true,
        allowDownload: true,
        enableConversation: true,
        teamId: true,
        team: {
          select: {
            plan: true,
            globalBlockList: true,
            agentsEnabled: true,
            pauseStartsAt: true,
          },
        },
        customFields: {
          select: {
            identifier: true,
            label: true,
          },
        },
        enableUpload: true,
        dataroom: {
          select: {
            agentsEnabled: true,
            isFrozen: true,
            name: true,
          },
        },
        visitorGroups: {
          select: {
            visitorGroup: {
              select: {
                emails: true,
              },
            },
          },
        },
      },
    });

    if (!link) {
      return NextResponse.json({ message: "Link not found." }, { status: 404 });
    }

    if (link.isArchived) {
      return NextResponse.json(
        { message: "Link is no longer available." },
        { status: 404 },
      );
    }

    if (link.deletedAt) {
      return NextResponse.json(
        { message: "Link has been deleted." },
        { status: 404 },
      );
    }

    if (link.dataroom?.isFrozen) {
      return NextResponse.json(
        { message: "This data room has been closed." },
        { status: 403 },
      );
    }

    let isEmailVerified: boolean = false;
    let hashedVerificationToken: string | null = null;
    // Check if the user is part of the team and therefore skip verification steps
    let isTeamMember: boolean = false;
    let isPreview: boolean = false;
    if (userId && previewToken) {
      const session = await getServerSession(authOptions);
      if (!session) {
        return NextResponse.json(
          { message: "You need to be logged in to preview the link." },
          { status: 401 },
        );
      }

      const sessionUserId = (session.user as CustomUser).id;
      const teamMembership = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: sessionUserId,
            teamId: link.teamId!,
          },
        },
      });
      if (teamMembership) {
        isTeamMember = true;
        isPreview = true;
        isEmailVerified = true;
      }
    }

    // Check if there's a valid preview session
    let previewSession: PreviewSession | null = null;
    if (!isPreview && previewToken) {
      const session = await getServerSession(authOptions);
      if (!session) {
        return NextResponse.json(
          { message: "You need to be logged in to preview the link." },
          { status: 401 },
        );
      }
      previewSession = await verifyPreviewSession(
        previewToken,
        (session.user as CustomUser).id,
        linkId,
      );

      if (!previewSession) {
        return NextResponse.json(
          {
            message: "Preview session expired or invalid. Request a new one.",
            resetPreview: true,
          },
          { status: 401 },
        );
      }
      isPreview = true;
    }

    let dataroomSession: DataroomSession | null = null;
    if (!isPreview) {
      dataroomSession = await verifyDataroomSession(
        request,
        linkId,
        link.dataroomId!,
      );


      // If we have a dataroom session, use its verified status
      if (dataroomSession) {
        isEmailVerified = dataroomSession.verified;
      }
    }

    // If there is no session, then we need to check if the link is protected and enforce the checks
    if (!dataroomSession && !isPreview) {
      // Check if email is required for visiting the link
      if (link.emailProtected) {
        if (!email || email.trim() === "") {
          return NextResponse.json(
            { message: "Email is required." },
            { status: 400 },
          );
        }

        // validate email
        if (!validateEmail(email)) {
          return NextResponse.json(
            { message: "Invalid email address." },
            { status: 400 },
          );
        }
      }

      // Check if password is required for visiting the link
      if (link.password) {
        if (!password || password.trim() === "") {
          return NextResponse.json(
            { message: "Password is required." },
            { status: 400 },
          );
        }

        let isPasswordValid: boolean = false;
        const textParts: string[] = link.password.split(":");
        if (!textParts || textParts.length !== 2) {
          isPasswordValid = await checkPassword(password, link.password);
        } else {
          const decryptedPassword = decryptEncrpytedPassword(link.password);
          isPasswordValid = decryptedPassword === password;
        }

        if (!isPasswordValid) {
          return NextResponse.json(
            { message: "Invalid password." },
            { status: 403 },
          );
        }
      }

      // Check if agreement is required for visiting the link
      if (link.enableAgreement && !hasConfirmedAgreement) {
        return NextResponse.json(
          { message: "Agreement to NDA is required." },
          { status: 400 },
        );
      }

      // Check global block list first - this overrides all other access controls
      const globalBlockCheck = checkGlobalBlockList(
        email,
        link.team?.globalBlockList,
      );
      if (globalBlockCheck.error) {
        return NextResponse.json(
          { message: globalBlockCheck.error },
          { status: 400 },
        );
      }
      if (globalBlockCheck.isBlocked) {
        waitUntil(reportDeniedAccessAttempt(link, email, "global"));

        return NextResponse.json({ message: "Access denied" }, { status: 403 });
      }

      // Build combined allow list from individual emails + visitor groups
      const visitorGroupEmails =
        link.visitorGroups?.flatMap((vg) => vg.visitorGroup.emails) || [];
      const combinedAllowList = [
        ...(link.allowList || []),
        ...visitorGroupEmails,
      ];

      // Check if email is allowed to visit the link
      if (combinedAllowList.length > 0) {
        // Determine if the email or its domain is allowed
        const isAllowed = combinedAllowList.some((allowed) =>
          isEmailMatched(email, allowed),
        );

        // Deny access if the email is not allowed
        if (!isAllowed) {
          waitUntil(reportDeniedAccessAttempt(link, email, "allow"));

          return NextResponse.json(
            { message: "Unauthorized access" },
            { status: 403 },
          );
        }
      }

      // Check if email is denied to visit the link
      if (link.denyList && link.denyList.length > 0) {
        // Determine if the email or its domain is denied
        const isDenied = link.denyList.some((denied) =>
          isEmailMatched(email, denied),
        );

        // Deny access if the email is denied
        if (isDenied) {
          waitUntil(reportDeniedAccessAttempt(link, email, "deny"));

          return NextResponse.json(
            { message: "Unauthorized access" },
            { status: 403 },
          );
        }
      }

      // Check if group is allowed to visit the link
      if (link.audienceType === LinkAudienceType.GROUP && link.groupId) {
        const group = await prisma.viewerGroup.findUnique({
          where: { id: link.groupId },
          select: {
            members: { include: { viewer: { select: { email: true } } } },
            domains: true,
            allowAll: true,
          },
        });

        if (!group) {
          return NextResponse.json(
            { message: "Group not found." },
            { status: 404 },
          );
        }

        // Check if all emails are allowed
        if (group.allowAll) {
          // Allow access
        } else {
          // Check individual membership
          const isMember = group.members.some(
            (member) => member.viewer.email === email,
          );

          // Extract domain from email
          const emailDomain = extractEmailDomain(email);
          // Check domain access
          const hasDomainAccess = emailDomain
            ? group.domains.some((domain) => domain === emailDomain)
            : false;

          if (!isMember && !hasDomainAccess) {
            waitUntil(reportDeniedAccessAttempt(link, email, "allow"));
            return NextResponse.json(
              { message: "Unauthorized access" },
              { status: 403 },
            );
          }
        }
      }

      // Request OTP Code for email verification if
      // 1) email verification is required and
      // 2) code is not provided or token not provided
      if (link.emailAuthenticated && !code && !token) {
        const ipAddressValue = ipAddress(request);

        // Rate limit per email/link combination (1 per 30 seconds) to prevent OTP flooding
        const { success: emailLimitSuccess } = await ratelimit(1, "30 s").limit(
          `send-otp:${linkId}:${email}`,
        );
        if (!emailLimitSuccess) {
          return NextResponse.json(
            {
              message:
                "Please wait before requesting another code. Try again in 30 seconds.",
            },
            { status: 429 },
          );
        }

        // Additional IP-based rate limit (10 per minute) to prevent abuse across different emails
        const { success } = await ratelimit(10, "1 m").limit(
          `send-otp:${ipAddressValue}`,
        );
        if (!success) {
          return NextResponse.json(
            { message: "Too many requests. Please try again later." },
            { status: 429 },
          );
        }

        await prisma.verificationToken.deleteMany({
          where: {
            identifier: `otp:${linkId}:${email}`,
          },
        });

        const otpCode = generateOTP();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10); // token expires at 10 minutes

        await prisma.verificationToken.create({
          data: {
            token: otpCode,
            identifier: `otp:${linkId}:${email}`,
            expires: expiresAt,
          },
        });

        waitUntil(sendOtpVerificationEmail(email, otpCode, true, link.teamId!));
        return NextResponse.json(
          {
            type: "email-verification",
            message: "Verification email sent.",
          },
          { status: 200 },
        );
      }

      if (link.emailAuthenticated && code) {
        const ipAddressValue = ipAddress(request);
        const { success } = await ratelimit(10, "1 m").limit(
          `verify-otp:${ipAddressValue}`,
        );
        if (!success) {
          return NextResponse.json(
            { message: "Too many requests. Please try again later." },
            { status: 429 },
          );
        }

        // Check if the OTP code is valid
        const verification = await prisma.verificationToken.findUnique({
          where: {
            token: code,
            identifier: `otp:${linkId}:${email}`,
          },
        });

        if (!verification) {
          return NextResponse.json(
            {
              message: "Unauthorized access. Request new access.",
              resetVerification: true,
            },
            { status: 401 },
          );
        }

        // Check the OTP code's expiration date
        if (Date.now() > verification.expires.getTime()) {
          await prisma.verificationToken.delete({
            where: {
              token: code,
            },
          });
          return NextResponse.json(
            {
              message: "Access expired. Request new access.",
              resetVerification: true,
            },
            { status: 401 },
          );
        }

        // delete the OTP code after verification
        await prisma.verificationToken.delete({
          where: {
            token: code,
          },
        });

        // Create a email verification token for repeat access
        const token = newId("email");
        hashedVerificationToken = hashToken(token);
        const tokenExpiresAt = new Date();
        tokenExpiresAt.setHours(tokenExpiresAt.getHours() + 23); // token expires at 23 hours
        await prisma.verificationToken.create({
          data: {
            token: hashedVerificationToken,
            identifier: `link-verification:${linkId}:${link.teamId}:${email}`,
            expires: tokenExpiresAt,
          },
        });

        isEmailVerified = true;
      }

      if (link.emailAuthenticated && token) {
        const ipAddressValue = ipAddress(request);
        const { success } = await ratelimit(10, "1 m").limit(
          `verify-email:${ipAddressValue}`,
        );
        if (!success) {
          return NextResponse.json(
            { message: "Too many requests. Please try again later." },
            { status: 429 },
          );
        }

        // Check if the long-term verification token is valid
        const verification = await prisma.verificationToken.findUnique({
          where: {
            token: token,
            identifier: `link-verification:${linkId}:${link.teamId}:${email}`,
          },
        });

        if (!verification) {
          return NextResponse.json(
            {
              message: "Unauthorized access. Request new access.",
              resetVerification: true,
            },
            { status: 401 },
          );
        }

        // Check the long-term verification token's expiration date
        if (Date.now() > verification.expires.getTime()) {
          // delete the long-term verification token after verification
          await prisma.verificationToken.delete({
            where: {
              token: token,
            },
          });
          return NextResponse.json(
            {
              message: "Access expired. Request new access.",
              resetVerification: true,
            },
            { status: 401 },
          );
        }

        isEmailVerified = true;
      }

    }

    let viewer: { id: string; email: string; verified: boolean } | null = null;
    if (!isPreview) {
      if (!dataroomSession) {
        if (email) {
          // find or create a viewer
          console.time("find-viewer");
          viewer = await prisma.viewer.findUnique({
            where: {
              teamId_email: {
                teamId: link.teamId!,
                email: email,
              },
            },
            select: { id: true, email: true, verified: true },
          });
          console.timeEnd("find-viewer");

          if (!viewer) {
            console.time("create-viewer");
            viewer = await prisma.viewer.create({
              data: {
                email: email,
                verified: isEmailVerified,
                teamId: link.teamId!,
              },
              select: { id: true, email: true, verified: true },
            });
            console.timeEnd("create-viewer");
          }
        }
      } else {
        if (dataroomSession.viewerId) {
          viewer = await prisma.viewer.findUnique({
            where: { id: dataroomSession.viewerId, teamId: link.teamId! },
            select: { id: true, email: true, verified: true },
          });
        }
      }

      if (viewer && !viewer.verified && isEmailVerified) {
        await prisma.viewer.update({
          where: { id: viewer.id },
          data: { verified: isEmailVerified },
        });
        // Update the viewer object to reflect the new verified status
        viewer.verified = isEmailVerified;
      }
    }

    // Common fields for the view object shared between DATAROOM_VIEW and DOCUMENT_VIEW
    const viewFields = {
      linkId: linkId,
      viewerEmail: viewer?.email ?? email,
      viewerName: name,
      verified: isEmailVerified,
      dataroomId: link.dataroomId,
      viewerId: viewer?.id ?? undefined,
      teamId: link.teamId,
      ...(link.enableAgreement &&
        link.agreementId &&
        hasConfirmedAgreement && {
          agreementResponse: {
            create: {
              agreementId: link.agreementId,
            },
          },
        }),
      ...(link.audienceType === LinkAudienceType.GROUP &&
        link.groupId && {
          groupId: link.groupId,
        }),
      ...(customFields &&
        link.customFields.length > 0 && {
          customFieldResponse: {
            create: {
              data: link.customFields.map((field) => ({
                identifier: field.identifier,
                label: field.label,
                response: customFields[field.identifier] || "",
              })),
            },
          },
        }),
    };

    const isPaused =
      link.team?.pauseStartsAt && link.team?.pauseStartsAt <= new Date()
        ? true
        : false;

    // ** DATAROOM_VIEW **
    if (viewType === "DATAROOM_VIEW") {
      try {
        let newDataroomView: { id: string } | null = null;
        if (!isPreview) {
          if (!dataroomSession) {
            console.time("create-view");
            newDataroomView = await prisma.view.create({
              data: { ...viewFields, viewType: "DATAROOM_VIEW" },
              select: { id: true },
            });
            console.timeEnd("create-view");
          }
        }

        // Send events in the background to avoid blocking the response
        if (newDataroomView) {
          waitUntil(
            // Record link view in Tinybird
            recordLinkView({
              req: request,
              clickId: newId("linkView"),
              viewId: newDataroomView.id,
              linkId,
              dataroomId: link.dataroomId!,
              teamId: link.teamId!,
              enableNotification: link.enableNotification,
              isPaused,
            }),
          );

          if (link.teamId && !isPreview) {
            waitUntil(
              (async () => {
                try {
                  await notifyDataroomAccess({
                    teamId: link.teamId!,
                    dataroomId: link.dataroomId!,
                    linkId,
                    viewerEmail: verifiedEmail ?? email,
                    viewerId: viewer?.id,
                    teamIsPaused: isPaused,
                  });
                } catch (error) {
                  console.error("Error sending Slack notification:", error);
                }
              })(),
            );
          }
        }

        const dataroomViewId =
          newDataroomView?.id ?? dataroomSession?.viewId ?? undefined;

        const returnObject = {
          message: "Dataroom View recorded",
          viewId: dataroomViewId,
          isPreview: isPreview ? true : undefined,
          file: undefined,
          pages: undefined,
          notionData: undefined,
          verificationToken: hashedVerificationToken,
          viewerId: viewer?.id,
          conversationsEnabled: link.enableConversation,
          enableVisitorUpload: link.enableUpload,
          agentsEnabled: link.dataroom?.agentsEnabled ?? false,
          dataroomName: link.dataroom?.name,
          ...(isTeamMember && { isTeamMember: true }),
        };

        const response = NextResponse.json(returnObject, { status: 200 });

        // Create a dataroom session token if a dataroom session doesn't exist yet
        if (!dataroomSession && !isPreview) {
          const fingerprint = generateSessionFingerprint(
            collectFingerprintHeaders(request.headers),
          );
          const newDataroomSession = await createDataroomSession(
            link.dataroomId!,
            linkId,
            newDataroomView?.id!,
            ipAddress(request) ?? LOCALHOST_IP,
            isEmailVerified,
            viewer?.id,
            fingerprint,
          );

          let basePath = `/view/${linkId}`;
          const cookieId = `pm_drs_${linkId}`;
          let flagCookieId = `pm_drs_flag_${linkId}`;

          if (link.domainId) {
            basePath = `/${link.slug}`;
            flagCookieId = `pm_drs_flag_${link.slug}`;
          }

          response.cookies.set(cookieId, newDataroomSession?.token, {
            path: "/",
            expires: new Date(newDataroomSession?.expiresAt),
            httpOnly: true,
            sameSite: "strict",
          });
          response.cookies.set(flagCookieId, "true", {
            path: basePath,
            expires: new Date(newDataroomSession?.expiresAt),
            sameSite: "strict",
          });
        }

        return response;
      } catch (error) {
        log({
          message: `Failed to record view for dataroom link: ${linkId}. \n\n ${error}`,
          type: "error",
          mention: true,
        });
        return NextResponse.json(
          { message: (error as Error).message },
          { status: 500 },
        );
      }
    }

    // ** DOCUMENT_VIEW **
    try {
      let newView: { id: string } | null = null;
      let dataroomView: { id: string } | null = null;
      if (!isPreview) {
        console.time("create-view");

        // if dataroomSession is not present, create a dataroom view first
        if (!dataroomSession) {
          dataroomView = await prisma.view.create({
            data: { ...viewFields, viewType: "DATAROOM_VIEW" },
            select: { id: true },
          });

          waitUntil(
            // Record link view in Tinybird
            recordLinkView({
              req: request,
              clickId: newId("linkView"),
              viewId: dataroomView.id,
              linkId,
              dataroomId: link.dataroomId!,
              teamId: link.teamId!,
              enableNotification: link.enableNotification,
              isPaused,
            }),
          );
        }

        // create the document view
        newView = await prisma.view.create({
          data: {
            ...viewFields,
            documentId: documentId,
            dataroomViewId:
              dataroomSession?.viewId ?? dataroomView?.id ?? dataroomViewId,
            viewType: "DOCUMENT_VIEW",
          },
          select: { id: true },
        });
        console.timeEnd("create-view");
        // Only send Slack notifications for non-preview views
        if (link.teamId && !isPreview) {
          waitUntil(
            (async () => {
              try {
                await notifyDocumentView({
                  teamId: link.teamId!,
                  documentId,
                  dataroomId: link.dataroomId!,
                  linkId,
                  viewerEmail: verifiedEmail ?? email,
                  viewerId: viewer?.id,
                  teamIsPaused: isPaused,
                });
              } catch (error) {
                console.error("Error sending Slack notification:", error);
              }
            })(),
          );
        }
      }

      // if document version has pages, then return pages
      // otherwise, return file from document version
      let documentPages, documentVersion;
      let sheetData;
      const INITIAL_PAGES_TO_LOAD = 10;

      if (hasPages) {
        // get pages from document version
        console.time("get-pages");
        documentPages = await prisma.documentPage.findMany({
          where: { versionId: documentVersionId },
          orderBy: { pageNumber: "asc" },
          select: {
            file: true,
            storageType: true,
            pageNumber: true,
            embeddedLinks: !link.team?.plan.includes("free"),
            pageLinks: !link.team?.plan.includes("free"),
            metadata: true,
          },
        });

        // Sign URLs for pages around the requested start page (or page 1 by default).
        // Remaining page URLs are fetched on-demand by the client via /api/views/pages.
        const centerIndex = Math.max(0, (startPage ?? 1) - 1);
        const halfWindow = Math.floor(INITIAL_PAGES_TO_LOAD / 2);
        const signStart = Math.max(0, centerIndex - halfWindow);
        const signEnd = Math.min(documentPages.length, signStart + INITIAL_PAGES_TO_LOAD);

        documentPages = await Promise.all(
          documentPages.map(async (page, index) => {
            const { storageType, ...otherPage } = page;
            return {
              ...otherPage,
              file:
                index >= signStart && index < signEnd
                  ? await getFile({ data: page.file, type: storageType })
                  : null,
            };
          }),
        );

        console.timeEnd("get-pages");
      } else {
        // get file from document version
        console.time("get-file");
        documentVersion = await prisma.documentVersion.findUnique({
          where: { id: documentVersionId },
          select: {
            file: true,
            storageType: true,
            type: true,
          },
        });

        if (!documentVersion) {
          return NextResponse.json(
            { message: "Document version not found." },
            { status: 404 },
          );
        }

        if (
          documentVersion.type === "pdf" ||
          documentVersion.type === "image" ||
          documentVersion.type === "video"
        ) {
          documentVersion.file = await getFile({
            data: documentVersion.file,
            type: documentVersion.storageType,
          });
        }
        // For link documents, the file is already a URL, no processing needed
        if (documentVersion.type === "sheet") {
          const document = await prisma.document.findUnique({
            where: { id: documentId },
            select: { advancedExcelEnabled: true },
          });
          useAdvancedExcelViewer = document?.advancedExcelEnabled ?? false;

          if (useAdvancedExcelViewer) {
            if (documentVersion.file.includes("https://")) {
              documentVersion.file = documentVersion.file;
            } else {
              // Get team-specific storage config for advanced distribution host
              const storageConfig = await getTeamStorageConfigById(
                link.teamId!,
              );
              documentVersion.file = `https://${storageConfig.advancedDistributionHost}/${documentVersion.file}`;
            }
          } else {
            const fileUrl = await getFile({
              data: documentVersion.file,
              type: documentVersion.storageType,
            });

            const data = await parseSheet({ fileUrl });
            sheetData = data;
          }
        }
        console.timeEnd("get-file");
      }

      // check if viewer can download the document based on group permissions
      let canDownload: boolean = link.allowDownload ?? false;
      const effectiveGroupId = link.groupId || link.permissionGroupId;

      if (
        link.allowDownload &&
        (link.audienceType === LinkAudienceType.GROUP ||
          link.permissionGroupId) &&
        effectiveGroupId &&
        documentId &&
        link.dataroomId
      ) {
        const dataroomDocument = await prisma.dataroomDocument.findUnique({
          where: {
            dataroomId_documentId: {
              dataroomId: link.dataroomId,
              documentId: documentId,
            },
          },
          select: { id: true },
        });
        if (!dataroomDocument) {
          canDownload = false;
        } else {
          if (link.groupId) {
            // This is a ViewerGroup (legacy behavior)
            const groupDocumentPermission =
              await prisma.viewerGroupAccessControls.findUnique({
                where: {
                  groupId_itemId: {
                    groupId: link.groupId,
                    itemId: dataroomDocument.id,
                  },
                  itemType: ItemType.DATAROOM_DOCUMENT,
                },
                select: { canDownload: true },
              });
            canDownload = groupDocumentPermission?.canDownload ?? false;
          } else if (link.permissionGroupId) {
            // This is a PermissionGroup (new behavior)
            const permissionGroupDocumentPermission =
              await prisma.permissionGroupAccessControls.findUnique({
                where: {
                  groupId_itemId: {
                    groupId: link.permissionGroupId,
                    itemId: dataroomDocument.id,
                  },
                  itemType: ItemType.DATAROOM_DOCUMENT,
                },
                select: { canDownload: true },
              });
            canDownload =
              permissionGroupDocumentPermission?.canDownload ?? false;
          }
        }
      }

      const returnObject = {
        message: "View recorded",
        viewId: !isPreview && newView ? newView.id : undefined,
        isPreview: isPreview ? true : undefined,
        file:
          (documentVersion &&
            (documentVersion.type === "pdf" ||
              documentVersion.type === "image" ||
              documentVersion.type === "zip" ||
              documentVersion.type === "video" ||
              documentVersion.type === "link")) ||
          (documentVersion && useAdvancedExcelViewer)
            ? documentVersion.file
            : undefined,
        pages: documentPages ? documentPages : undefined,
        notionData: undefined,
        sheetData:
          documentVersion &&
          documentVersion.type === "sheet" &&
          !useAdvancedExcelViewer
            ? sheetData
            : undefined,
        fileType: documentVersion
          ? documentVersion.type
          : documentPages
            ? "pdf"
            : undefined,
        watermarkConfig: link.enableWatermark
          ? link.watermarkConfig
          : undefined,
        viewerEmail: viewer?.email ?? email ?? verifiedEmail ?? null,
        ipAddress:
          link.enableWatermark &&
          link.watermarkConfig &&
          WatermarkConfigSchema.parse(link.watermarkConfig).text.includes(
            "{{ipAddress}}",
          )
            ? (ipAddress(request) ?? LOCALHOST_IP)
            : undefined,
        useAdvancedExcelViewer:
          documentVersion &&
          documentVersion.type === "sheet" &&
          useAdvancedExcelViewer
            ? useAdvancedExcelViewer
            : undefined,
        canDownload: canDownload,
        viewerId: viewer?.id,
        conversationsEnabled: link.enableConversation,
        agentsEnabled: link.dataroom?.agentsEnabled ?? false,
        dataroomName: link.dataroom?.name,
        ...(isTeamMember && { isTeamMember: true }),
      };

      const response = NextResponse.json(returnObject, { status: 200 });

      // Create a dataroom session token if a dataroom session doesn't exist yet
      if (!dataroomSession && !isPreview) {
        const fingerprint = generateSessionFingerprint(
          collectFingerprintHeaders(request.headers),
        );
        const newDataroomSession = await createDataroomSession(
          link.dataroomId!,
          linkId,
          dataroomView?.id!,
          ipAddress(request) ?? LOCALHOST_IP,
          isEmailVerified,
          viewer?.id,
          fingerprint,
        );

        let basePath = `/view/${linkId}`;
        const cookieId = `pm_drs_${linkId}`;
        let flagCookieId = `pm_drs_flag_${linkId}`;
        if (link.domainId) {
          basePath = `/${link.slug}`;
          flagCookieId = `pm_drs_flag_${link.slug}`;
        }

        response.cookies.set(cookieId, newDataroomSession?.token, {
          path: "/",
          expires: new Date(newDataroomSession?.expiresAt),
          httpOnly: true,
          sameSite: "strict",
        });
        response.cookies.set(flagCookieId, "true", {
          path: basePath,
          expires: new Date(newDataroomSession?.expiresAt),
          sameSite: "strict",
        });
      }

      return response;
    } catch (error) {
      log({
        message: `Failed to record view for dataroom document ${linkId}. \n\n ${error}`,
        type: "error",
        mention: true,
      });
      return NextResponse.json(
        { message: (error as Error).message },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
