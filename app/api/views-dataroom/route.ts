import { NextRequest, NextResponse } from "next/server";

import { reportDeniedAccessAttempt } from "@/ee/features/access-notifications";
import { ItemType, LinkAudienceType, LinkType } from "@prisma/client";
import { ipAddress, waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth";

import { hashToken } from "@/lib/api/auth/token";
import { authOptions } from "@/lib/auth/auth-options";
import {
  DataroomSession,
  collectFingerprintHeaders,
  createDataroomSession,
  generateSessionFingerprint,
} from "@/lib/auth/dataroom-auth";
import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import { PreviewSession, verifyPreviewSession } from "@/lib/auth/preview-auth";
import { isEmbeddableUrl } from "@/lib/edge-config/embeddable-domains";
import { sendOtpVerificationEmail } from "@/lib/emails/send-email-otp-verification";
import { getFeatureFlags } from "@/lib/featureFlags";
import { getAdvancedExcelFileUrl } from "@/lib/files/advanced-excel-url";
import { getFile } from "@/lib/files/get-file";
import { signPageLinks } from "@/lib/files/sign-page-links";
import { newId } from "@/lib/id-helper";
import {
  notifyDataroomAccess,
  notifyDocumentView,
} from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { parseSheet } from "@/lib/sheet";
import {
  getSignedAgreementAccessCookieName,
  parseSignedAgreementAccessToken,
} from "@/lib/signing/access-token";
import {
  ensureAgreementResponseForAccess,
  normalizeSignerEmail,
  normalizeSignerName,
} from "@/lib/signing/agreements";
import { recordLinkView } from "@/lib/tracking/record-link-view";
import { CustomUser, WatermarkConfigSchema } from "@/lib/types";
import {
  checkPassword,
  decryptEncrpytedPassword,
  log,
  stripTrailingPasswordWhitespace,
} from "@/lib/utils";
import {
  extractEmailDomain,
  normalizeGroupDomain,
} from "@/lib/utils/email-domain";
import { generateOTP } from "@/lib/utils/generate-otp";
import { LOCALHOST_IP } from "@/lib/utils/geo";
import { checkViewerEmailAccess } from "@/lib/utils/global-block-list";
import { resolveHtmlContentForRender } from "@/lib/utils/html-document";
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

    const {
      email,
      password,
      name,
      agreementResponseId,
      hasConfirmedAgreement,
    } = data as {
      email: string;
      password: string;
      name?: string;
      agreementResponseId?: string;
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
        expiresAt: true,
        slug: true,
        domainId: true,
        linkType: true,
        allowList: true,
        denyList: true,
        enableAgreement: true,
        agreementId: true,
        agreement: {
          select: {
            id: true,
            signingProvider: true,
            contentType: true,
            requireName: true,
          },
        },
        enableWatermark: true,
        watermarkConfig: true,
        groupId: true,
        group: {
          select: {
            members: { include: { viewer: { select: { email: true } } } },
            domains: true,
            allowAll: true,
          },
        },
        permissionGroupId: true,
        audienceType: true,
        allowDownload: true,
        enableConversation: true,
        teamId: true,
        brandId: true,
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
        uploadFolderIds: true,
        dataroom: {
          select: {
            agentsEnabled: true,
            isFrozen: true,
            name: true,
            brandId: true,
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

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return NextResponse.json(
        { message: "Link has expired." },
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

    let effectiveEmail = normalizeSignerEmail(email);
    let effectiveName = normalizeSignerName(name);

    const signedAccessCookieValue =
      link.enableAgreement && link.agreement
        ? request.cookies.get(getSignedAgreementAccessCookieName(linkId))?.value
        : undefined;
    const signedAccessPayload = parseSignedAgreementAccessToken(
      signedAccessCookieValue,
    );
    const cookieAgreementResponseId =
      link.enableAgreement &&
      link.agreement &&
      signedAccessPayload &&
      signedAccessPayload.linkId === linkId &&
      signedAccessPayload.agreementId === link.agreement.id
        ? signedAccessPayload.agreementResponseId
        : null;

    let verifiedAgreementResponse: Awaited<
      ReturnType<typeof ensureAgreementResponseForAccess>
    > | null = null;

    // If there is no session, then we need to check if the link is protected and enforce the checks
    if (!dataroomSession && !isPreview) {
      if (cookieAgreementResponseId && link.enableAgreement && link.agreement) {
        try {
          verifiedAgreementResponse = await ensureAgreementResponseForAccess({
            agreement: link.agreement,
            linkId,
            agreementResponseId: cookieAgreementResponseId,
            skipSignerIdentityCheck: true,
          });
          effectiveEmail =
            normalizeSignerEmail(verifiedAgreementResponse.signerEmail) ??
            effectiveEmail;
          effectiveName =
            normalizeSignerName(verifiedAgreementResponse.signerName) ??
            effectiveName;
        } catch {
          // Continue with the submitted identity; the agreement gate below will fail closed if needed.
        }
      }

      // Check if email is required for visiting the link
      if (link.emailProtected) {
        if (!effectiveEmail || effectiveEmail.trim() === "") {
          return NextResponse.json(
            { message: "Email is required." },
            { status: 400 },
          );
        }

        // validate email
        if (!validateEmail(effectiveEmail)) {
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
        const submittedPassword = stripTrailingPasswordWhitespace(password);
        const textParts: string[] = link.password.split(":");
        if (!textParts || textParts.length !== 2) {
          isPasswordValid = await checkPassword(
            submittedPassword,
            link.password,
          );
          // A legacy bcrypt hash may cover trailing spaces, so the raw input
          // still has to match or those links lock their owners out.
          if (!isPasswordValid && password !== submittedPassword) {
            isPasswordValid = await checkPassword(password, link.password);
          }
        } else {
          const decryptedPassword = decryptEncrpytedPassword(link.password);
          isPasswordValid = decryptedPassword === submittedPassword;
        }

        if (!isPasswordValid) {
          return NextResponse.json(
            { message: "Invalid password." },
            { status: 403 },
          );
        }
      }

      // Fail closed when an agreement is required but not configured, to avoid silently granting access.
      if (link.enableAgreement && !link.agreement) {
        return NextResponse.json(
          { message: "Agreement is required but not configured." },
          { status: 500 },
        );
      }

      if (
        link.enableAgreement &&
        link.agreement &&
        !verifiedAgreementResponse
      ) {
        const resolvedAgreementResponseId =
          agreementResponseId ?? cookieAgreementResponseId ?? undefined;

        const hasCookieIdentityProof =
          !!cookieAgreementResponseId &&
          (!agreementResponseId ||
            agreementResponseId === cookieAgreementResponseId);

        try {
          verifiedAgreementResponse = await ensureAgreementResponseForAccess({
            agreement: link.agreement,
            linkId,
            agreementResponseId: resolvedAgreementResponseId,
            hasConfirmedAgreement,
            signerEmail: effectiveEmail,
            signerName: effectiveName,
            requireSignerEmail: link.emailProtected,
            skipSignerIdentityCheck: hasCookieIdentityProof,
          });
          effectiveEmail =
            normalizeSignerEmail(verifiedAgreementResponse.signerEmail) ??
            effectiveEmail;
          effectiveName =
            normalizeSignerName(verifiedAgreementResponse.signerName) ??
            effectiveName;
        } catch (error) {
          return NextResponse.json(
            {
              message:
                error instanceof Error
                  ? error.message
                  : "Agreement signing is required.",
            },
            { status: 400 },
          );
        }
      }

      // Allow list and viewer-group audience override the team-wide global
      // block list. Per-link deny list still applies after.
      const isGroupAudience =
        link.audienceType === LinkAudienceType.GROUP && !!link.groupId;
      if (isGroupAudience && !link.group) {
        return NextResponse.json(
          { message: "Group not found." },
          { status: 404 },
        );
      }

      const viewerGroup = isGroupAudience ? link.group : null;
      const visitorGroupEmails =
        link.visitorGroups?.flatMap((vg) => vg.visitorGroup.emails) || [];
      const viewerGroupAllowEntries =
        viewerGroup && !viewerGroup.allowAll
          ? [
              ...viewerGroup.members.map((member) => member.viewer.email),
              ...viewerGroup.domains,
            ]
          : [];
      const emailAccess = checkViewerEmailAccess({
        email: effectiveEmail ?? undefined,
        allowList: [
          ...(link.allowList || []),
          ...visitorGroupEmails,
          ...viewerGroupAllowEntries,
        ],
        denyList: link.denyList,
        globalBlockList: link.team?.globalBlockList,
      });
      if (emailAccess.denied) {
        if (emailAccess.error) {
          return NextResponse.json(
            { message: emailAccess.error },
            { status: 400 },
          );
        }

        waitUntil(
          reportDeniedAccessAttempt(
            link,
            effectiveEmail ?? "",
            emailAccess.reason,
          ),
        );

        return NextResponse.json(
          {
            message:
              emailAccess.reason === "global"
                ? "Access denied"
                : "Unauthorized access",
          },
          { status: 403 },
        );
      }

      if (viewerGroup && !viewerGroup.allowAll) {
        const isMember = viewerGroup.members.some(
          (member) => member.viewer.email === effectiveEmail,
        );

        const emailDomain = extractEmailDomain(effectiveEmail ?? "");
        const hasDomainAccess = emailDomain
          ? viewerGroup.domains.some(
              (domain) => normalizeGroupDomain(domain) === emailDomain,
            )
          : false;

        if (!isMember && !hasDomainAccess) {
          waitUntil(
            reportDeniedAccessAttempt(link, effectiveEmail ?? "", "allow"),
          );
          return NextResponse.json(
            { message: "Unauthorized access" },
            { status: 403 },
          );
        }
      }

      // Request OTP Code for email verification if
      // 1) email verification is required and
      // 2) code is not provided or token not provided
      if (link.emailAuthenticated && !code && !token) {
        const ipAddressValue = ipAddress(request);

        // Rate limit per email/link combination (1 per 30 seconds) to prevent OTP flooding
        const { success: emailLimitSuccess } = await ratelimit(1, "30 s").limit(
          `send-otp:${linkId}:${effectiveEmail}`,
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
            identifier: `otp:${linkId}:${effectiveEmail}`,
          },
        });

        const otpCode = generateOTP();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10); // token expires at 10 minutes

        await prisma.verificationToken.create({
          data: {
            token: otpCode,
            identifier: `otp:${linkId}:${effectiveEmail}`,
            expires: expiresAt,
          },
        });

        waitUntil(
          sendOtpVerificationEmail(
            effectiveEmail ?? "",
            otpCode,
            true,
            link.teamId!,
            {
              linkBrandId: link.brandId,
              dataroomBrandId: link.dataroom?.brandId,
            },
          ),
        );
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
            identifier: `otp:${linkId}:${effectiveEmail}`,
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
            identifier: `link-verification:${linkId}:${link.teamId}:${effectiveEmail}`,
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
            identifier: `link-verification:${linkId}:${link.teamId}:${effectiveEmail}`,
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

    if (
      !verifiedAgreementResponse &&
      cookieAgreementResponseId &&
      link.enableAgreement &&
      link.agreement
    ) {
      try {
        verifiedAgreementResponse = await ensureAgreementResponseForAccess({
          agreement: link.agreement,
          linkId,
          agreementResponseId: cookieAgreementResponseId,
          skipSignerIdentityCheck: true,
        });
        effectiveEmail =
          normalizeSignerEmail(verifiedAgreementResponse.signerEmail) ??
          effectiveEmail;
        effectiveName =
          normalizeSignerName(verifiedAgreementResponse.signerName) ??
          effectiveName;
      } catch {
        // Existing dataroom sessions still grant access; ignore stale signed identity cookies.
      }
    }

    const hasSignedAgreementIdentity = !!normalizeSignerEmail(
      verifiedAgreementResponse?.signerEmail,
    );

    let viewer: { id: string; email: string; verified: boolean } | null = null;
    if (!isPreview) {
      if (!dataroomSession) {
        if (effectiveEmail) {
          // find or create a viewer
          console.time("find-viewer");
          viewer = await prisma.viewer.findUnique({
            where: {
              teamId_email: {
                teamId: link.teamId!,
                email: effectiveEmail,
              },
            },
            select: { id: true, email: true, verified: true },
          });
          console.timeEnd("find-viewer");

          if (!viewer) {
            console.time("create-viewer");
            viewer = await prisma.viewer.create({
              data: {
                email: effectiveEmail,
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

        if (
          hasSignedAgreementIdentity &&
          effectiveEmail &&
          (!viewer || viewer.email.toLowerCase() !== effectiveEmail)
        ) {
          viewer = await prisma.viewer.findUnique({
            where: {
              teamId_email: {
                teamId: link.teamId!,
                email: effectiveEmail,
              },
            },
            select: { id: true, email: true, verified: true },
          });

          if (!viewer) {
            viewer = await prisma.viewer.create({
              data: {
                email: effectiveEmail,
                verified: isEmailVerified,
                teamId: link.teamId!,
              },
              select: { id: true, email: true, verified: true },
            });
          }
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

      if (dataroomSession?.viewId && hasSignedAgreementIdentity && viewer) {
        await prisma.view.updateMany({
          where: {
            id: dataroomSession.viewId,
            linkId,
            dataroomId: link.dataroomId,
            viewType: "DATAROOM_VIEW",
          },
          data: {
            viewerEmail: viewer.email,
            viewerName: effectiveName ?? undefined,
            viewerId: viewer.id,
            verified: viewer.verified || isEmailVerified,
          },
        });
      }
    }

    const shouldRefreshDataroomSession = Boolean(
      dataroomSession &&
      hasSignedAgreementIdentity &&
      viewer &&
      dataroomSession.viewerId !== viewer.id,
    );

    // Common fields for the view object shared between DATAROOM_VIEW and DOCUMENT_VIEW
    const viewFields = {
      linkId: linkId,
      viewerEmail: viewer?.email ?? effectiveEmail,
      viewerName: effectiveName,
      verified: isEmailVerified,
      dataroomId: link.dataroomId,
      viewerId: viewer?.id ?? undefined,
      teamId: link.teamId,
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

            if (verifiedAgreementResponse) {
              await prisma.agreementResponse.update({
                where: {
                  id: verifiedAgreementResponse.id,
                },
                data: {
                  viewId: newDataroomView.id,
                },
              });
            }
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
                    viewerEmail: effectiveEmail ?? verifiedEmail ?? undefined,
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

        // Resolve the upload-destination allow-list so the visitor UI can
        // surface exactly which folders they may target. Null/empty = no
        // restriction (visitor may upload into any folder they're in).
        let uploadFolderAllowList:
          | { id: string; name: string; path: string }[]
          | null = null;
        if (link.enableUpload) {
          const allowedIds = Array.isArray(link.uploadFolderIds)
            ? link.uploadFolderIds.filter(
                (id): id is string => typeof id === "string" && !!id,
              )
            : [];
          if (allowedIds.length > 0) {
            const folders = await prisma.dataroomFolder.findMany({
              where: {
                id: { in: allowedIds },
                dataroomId: link.dataroomId!,
              },
              select: { id: true, name: true, path: true },
            });
            const byId = new Map(folders.map((f) => [f.id, f]));
            uploadFolderAllowList = allowedIds
              .map((id) => byId.get(id))
              .filter(
                (f): f is { id: string; name: string; path: string } => !!f,
              );
          }
        }

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
          uploadFolderAllowList,
          agentsEnabled: link.dataroom?.agentsEnabled ?? false,
          dataroomName: link.dataroom?.name,
          ...(isTeamMember && { isTeamMember: true }),
        };

        const response = NextResponse.json(returnObject, { status: 200 });

        // Create or refresh the dataroom session token when the signed identity is canonical.
        if ((!dataroomSession || shouldRefreshDataroomSession) && !isPreview) {
          const sessionViewId = newDataroomView?.id ?? dataroomSession?.viewId;

          if (!sessionViewId) {
            return response;
          }

          const fingerprint = generateSessionFingerprint(
            collectFingerprintHeaders(request.headers),
          );
          const newDataroomSession = await createDataroomSession(
            link.dataroomId!,
            linkId,
            sessionViewId,
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
      if (!documentVersionId) {
        return NextResponse.json(
          { message: "Document version ID is required." },
          { status: 400 },
        );
      }

      const documentVersionAccess = await prisma.documentVersion.findUnique({
        where: { id: documentVersionId },
        select: { documentId: true },
      });

      if (!documentVersionAccess) {
        return NextResponse.json(
          { message: "Document version not found." },
          { status: 404 },
        );
      }

      const effectiveGroupId = link.groupId || link.permissionGroupId;
      let dataroomDocument: { id: string } | null = null;
      let dataroomDocumentPermission: {
        canView: boolean;
        canDownload: boolean;
      } | null = null;

      if (link.linkType !== LinkType.DATAROOM_LINK || !link.dataroomId) {
        return NextResponse.json(
          { message: "Unauthorized access." },
          { status: 403 },
        );
      }

      dataroomDocument = await prisma.dataroomDocument.findUnique({
        where: {
          dataroomId_documentId: {
            dataroomId: link.dataroomId,
            documentId: documentVersionAccess.documentId,
          },
        },
        select: { id: true },
      });

      if (!dataroomDocument) {
        return NextResponse.json(
          { message: "Unauthorized access." },
          { status: 403 },
        );
      }

      if (effectiveGroupId) {
        if (link.groupId) {
          dataroomDocumentPermission =
            await prisma.viewerGroupAccessControls.findUnique({
              where: {
                groupId_itemId: {
                  groupId: link.groupId,
                  itemId: dataroomDocument.id,
                },
                itemType: ItemType.DATAROOM_DOCUMENT,
              },
              select: { canView: true, canDownload: true },
            });
        } else if (link.permissionGroupId) {
          dataroomDocumentPermission =
            await prisma.permissionGroupAccessControls.findUnique({
              where: {
                groupId_itemId: {
                  groupId: link.permissionGroupId,
                  itemId: dataroomDocument.id,
                },
                itemType: ItemType.DATAROOM_DOCUMENT,
              },
              select: { canView: true, canDownload: true },
            });
        }

        if (
          !dataroomDocumentPermission?.canView &&
          !dataroomDocumentPermission?.canDownload
        ) {
          // Fallback: viewer-uploaded docs aren't tied to the link's
          // permission group, so allow the original uploader through. Gated
          // on a verified session (or NextAuth team-member preview) to
          // prevent unverified callers from claiming an upload's viewerId.
          const allowUploadFallback = isEmailVerified || isTeamMember;
          const ownerViewerId = viewer?.id ?? dataroomSession?.viewerId;
          const viewerUpload =
            ownerViewerId || isTeamMember
              ? await prisma.documentUpload.findFirst({
                  where: {
                    linkId,
                    dataroomDocumentId: dataroomDocument.id,
                    ...(ownerViewerId && !isTeamMember
                      ? { viewerId: ownerViewerId }
                      : {}),
                  },
                  select: { id: true },
                })
              : null;

          if (!viewerUpload) {
            return NextResponse.json(
              { message: "Unauthorized access." },
              { status: 403 },
            );
          }

          if (!allowUploadFallback) {
            // Trigger inline OTP re-auth. Echoing the email back is safe
            // here — the caller supplied it on the access form.
            return NextResponse.json(
              {
                message: "Email verification required to access your upload.",
                requiresVerification: "viewer-upload",
                email: viewer?.email ?? null,
              },
              { status: 401 },
            );
          }

          // Per-link `allowDownload` still gates the download UI downstream.
          dataroomDocumentPermission = { canView: true, canDownload: true };
        }
      }

      const resolvedDocumentId = documentVersionAccess.documentId;
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

          if (verifiedAgreementResponse) {
            await prisma.agreementResponse.update({
              where: {
                id: verifiedAgreementResponse.id,
              },
              data: {
                viewId: dataroomView.id,
              },
            });
          }

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
            documentId: resolvedDocumentId,
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
                  documentId: resolvedDocumentId,
                  dataroomId: link.dataroomId!,
                  linkId,
                  viewerEmail: effectiveEmail ?? verifiedEmail ?? undefined,
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
      let htmlContent: string | undefined;
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
        const centerIndex = Math.min(
          Math.max(0, (startPage ?? 1) - 1),
          Math.max(0, documentPages.length - 1),
        );
        const halfWindow = Math.floor(INITIAL_PAGES_TO_LOAD / 2);
        const signStart = Math.max(0, centerIndex - halfWindow);
        const signEnd = Math.min(
          documentPages.length,
          signStart + INITIAL_PAGES_TO_LOAD,
        );

        documentPages = await Promise.all(
          documentPages.map(async (page, index) => {
            const { storageType, ...otherPage } = page;
            const inWindow = index >= signStart && index < signEnd;
            return {
              ...otherPage,
              file: inWindow
                ? await getFile({ data: page.file, type: storageType })
                : null,
              pageLinks: inWindow
                ? ((await signPageLinks(otherPage.pageLinks)) ??
                  otherPage.pageLinks)
                : otherPage.pageLinks,
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
            where: { id: resolvedDocumentId },
            select: { advancedExcelEnabled: true },
          });
          useAdvancedExcelViewer = document?.advancedExcelEnabled ?? false;

          if (useAdvancedExcelViewer) {
            documentVersion.file = await getAdvancedExcelFileUrl({
              file: documentVersion.file,
              storageType: documentVersion.storageType,
            });
          } else {
            const fileUrl = await getFile({
              data: documentVersion.file,
              type: documentVersion.storageType,
            });

            const data = await parseSheet({ fileUrl });
            sheetData = data;
          }
        }

        if (documentVersion.type === "html") {
          const featureFlags = await getFeatureFlags({ teamId: link.teamId! });
          if (!featureFlags.htmlDocuments) {
            return NextResponse.json(
              { message: "This document is not available for viewing." },
              { status: 400 },
            );
          }

          try {
            const fileUrl = await getFile({
              data: documentVersion.file,
              type: documentVersion.storageType,
            });
            htmlContent = await resolveHtmlContentForRender({
              documentId: resolvedDocumentId,
              url: fileUrl,
            });
          } catch (error) {
            console.error("Failed to load HTML document for rendering:", error);
            return NextResponse.json(
              { message: "This document could not be loaded." },
              { status: 400 },
            );
          }
        }
        console.timeEnd("get-file");
      }

      // check if viewer can download the document based on group permissions
      let canDownload: boolean = link.allowDownload ?? false;

      if (
        link.allowDownload &&
        (link.audienceType === LinkAudienceType.GROUP ||
          link.permissionGroupId) &&
        effectiveGroupId &&
        dataroomDocument
      ) {
        canDownload = dataroomDocumentPermission?.canDownload ?? false;
      }

      const isLinkType = documentVersion?.type === "link";
      const isEmbeddable = isLinkType
        ? await isEmbeddableUrl(documentVersion?.file)
        : false;

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
        htmlContent:
          documentVersion && documentVersion.type === "html"
            ? htmlContent
            : undefined,
        fileType: documentVersion
          ? documentVersion.type
          : documentPages
            ? "pdf"
            : undefined,
        watermarkConfig: link.enableWatermark
          ? link.watermarkConfig
          : undefined,
        viewerEmail: viewer?.email ?? effectiveEmail ?? verifiedEmail ?? null,
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
        ...(isEmbeddable && { isEmbeddable: true }),
      };

      const response = NextResponse.json(returnObject, { status: 200 });

      // Create or refresh the dataroom session token when the signed identity is canonical.
      if ((!dataroomSession || shouldRefreshDataroomSession) && !isPreview) {
        const sessionViewId = dataroomView?.id ?? dataroomSession?.viewId;

        if (!sessionViewId) {
          return response;
        }

        const fingerprint = generateSessionFingerprint(
          collectFingerprintHeaders(request.headers),
        );
        const newDataroomSession = await createDataroomSession(
          link.dataroomId!,
          linkId,
          sessionViewId,
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
