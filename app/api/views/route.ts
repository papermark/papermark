import { NextRequest, NextResponse } from "next/server";

import { reportDeniedAccessAttempt } from "@/ee/features/access-notifications";
import { ipAddress, waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth";

import { hashToken } from "@/lib/api/auth/token";
import { authOptions } from "@/lib/auth/auth-options";
import {
  collectFingerprintHeaders,
  generateSessionFingerprint,
} from "@/lib/auth/dataroom-auth";
import {
  createLinkSession,
  getLinkSessionCookieName,
} from "@/lib/auth/link-session";
import { verifyPreviewSession } from "@/lib/auth/preview-auth";
import { PreviewSession } from "@/lib/auth/preview-auth";
import { isEmbeddableUrl } from "@/lib/edge-config/embeddable-domains";
import { sendOtpVerificationEmail } from "@/lib/emails/send-email-otp-verification";
import { getFeatureFlags } from "@/lib/featureFlags";
import { getAdvancedExcelFileUrl } from "@/lib/files/advanced-excel-url";
import { getFile } from "@/lib/files/get-file";
import { signPageLinks } from "@/lib/files/sign-page-links";
import { newId } from "@/lib/id-helper";
import { notifyDocumentView } from "@/lib/integrations/slack/events";
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
import { generateOTP } from "@/lib/utils/generate-otp";
import { LOCALHOST_IP } from "@/lib/utils/geo";
import { checkViewerEmailAccess } from "@/lib/utils/global-block-list";
import { resolveHtmlContentForRender } from "@/lib/utils/html-document";
import { validateEmail } from "@/lib/utils/validate-email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // POST /api/views
    const {
      linkId,
      userId,
      documentVersionId,
      documentName,
      hasPages,
      ownerId,
      startPage,
      ...data
    } = body as {
      linkId: string;
      userId: string | null;
      documentVersionId: string;
      documentName: string;
      hasPages: boolean;
      ownerId: string;
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
    const { useAdvancedExcelViewer } = data as {
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
        emailProtected: true,
        enableNotification: true,
        emailAuthenticated: true,
        password: true,
        domainSlug: true,
        isArchived: true,
        deletedAt: true,
        expiresAt: true,
        slug: true,
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
        document: {
          select: {
            agentsEnabled: true,
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

    // Check if link exists
    if (!link) {
      return NextResponse.json({ message: "Link not found." }, { status: 404 });
    }

    // Check if link is archived
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

    if (!link.documentId) {
      return NextResponse.json(
        { message: "Unauthorized access." },
        { status: 403 },
      );
    }

    if (!documentVersionId || typeof documentVersionId !== "string") {
      return NextResponse.json(
        { message: "documentVersionId is required." },
        { status: 400 },
      );
    }

    const requestedVersion = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: { documentId: true },
    });

    if (!requestedVersion) {
      return NextResponse.json(
        { message: "Document version not found." },
        { status: 404 },
      );
    }

    if (requestedVersion.documentId !== link.documentId) {
      return NextResponse.json(
        { message: "Unauthorized access." },
        { status: 403 },
      );
    }

    const documentId = link.documentId;

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

    if (!isTeamMember) {
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

      // Allow list is checked first so a per-link allow can override the
      // team-wide global block list. Per-link deny list still applies after.
      const visitorGroupEmails =
        link.visitorGroups?.flatMap((vg) => vg.visitorGroup.emails) || [];
      const emailAccess = checkViewerEmailAccess({
        email: effectiveEmail ?? undefined,
        allowList: [...(link.allowList || []), ...visitorGroupEmails],
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
            false,
            link.teamId!,
            { linkBrandId: link.brandId },
          ),
        );
        return NextResponse.json({
          type: "email-verification",
          message: "Verification email sent.",
        });
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
        // Existing link sessions still grant access; ignore stale signed identity cookies.
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

      console.log("previewSession", previewSession);
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

    try {
      let viewer: { id: string; verified: boolean } | null = null;
      if (effectiveEmail && !isPreview) {
        // find or create a viewer
        console.time("find-viewer");
        viewer = await prisma.viewer.findUnique({
          where: {
            teamId_email: {
              teamId: link.teamId!,
              email: effectiveEmail,
            },
          },
          select: { id: true, verified: true },
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
            select: { id: true, verified: true },
          });
          console.timeEnd("create-viewer");
        } else if (!viewer.verified && isEmailVerified) {
          await prisma.viewer.update({
            where: { id: viewer.id },
            data: { verified: isEmailVerified },
          });
        }
      }

      let newView: { id: string } | null = null;
      if (!isPreview) {
        console.time("create-view");
        newView = await prisma.view.create({
          data: {
            linkId: linkId,
            viewerEmail: effectiveEmail,
            viewerName: effectiveName,
            documentId: documentId,
            teamId: link.teamId!,
            viewerId: viewer?.id ?? undefined,
            verified: isEmailVerified,
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
          },
          select: { id: true },
        });

        if (verifiedAgreementResponse) {
          await prisma.agreementResponse.update({
            where: {
              id: verifiedAgreementResponse.id,
            },
            data: {
              viewId: newView.id,
            },
          });
        }
        console.timeEnd("create-view");
      }

      // if document version has pages, then return pages
      // otherwise, return file from document version
      let documentPages, documentVersion;
      let sheetData;
      let htmlContent: string | undefined;
      const INITIAL_PAGES_TO_LOAD = 10;
      // let documentPagesPromise, documentVersionPromise;
      if (hasPages) {
        const featureFlags = await getFeatureFlags({
          teamId: link.teamId!,
        });
        const inDocumentLinks =
          !link.team?.plan.includes("free") || featureFlags.inDocumentLinks;

        // get pages from document version
        console.time("get-pages");
        documentPages = await prisma.documentPage.findMany({
          where: { versionId: documentVersionId },
          orderBy: { pageNumber: "asc" },
          select: {
            file: true,
            storageType: true,
            pageNumber: true,
            embeddedLinks: inDocumentLinks,
            pageLinks: inDocumentLinks,
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
              // Always sign overlay URLs alongside whichever pages we sign
              // file URLs for; lazy-loaded pages re-sign via /api/views/pages.
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

        if (documentVersion.type === "sheet") {
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
              documentId,
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

      const isPaused =
        link.team?.pauseStartsAt && link.team?.pauseStartsAt <= new Date()
          ? true
          : false;

      if (newView) {
        // Record view in the background to avoid blocking the response
        waitUntil(
          // Record link view in Tinybird
          recordLinkView({
            req: request,
            clickId: newId("linkView"),
            viewId: newView.id,
            linkId,
            documentId,
            teamId: link.teamId!,
            enableNotification: link.enableNotification,
            isPaused,
          }),
        );
        if (!isPreview) {
          waitUntil(
            notifyDocumentView({
              teamId: link.teamId!,
              documentId,
              linkId,
              viewerEmail: effectiveEmail ?? undefined,
              viewerId: viewer?.id ?? undefined,
              teamIsPaused: isPaused,
            }).catch((error) => {
              console.error("Error sending Slack notification:", error);
            }),
          );
        }
      }

      // Determine if AI agents should be enabled (requires both team and document level)
      const agentsEnabled =
        link.team?.agentsEnabled && link.document?.agentsEnabled;

      const isLinkType = documentVersion?.type === "link";
      const isEmbeddable = isLinkType
        ? await isEmbeddableUrl(documentVersion?.file)
        : false;

      const returnObject = {
        message: "View recorded",
        viewId: !isPreview && newView ? newView.id : undefined,
        viewerId: viewer?.id ?? undefined,
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
        ipAddress:
          link.enableWatermark &&
          link.watermarkConfig &&
          WatermarkConfigSchema.parse(link.watermarkConfig).text.includes(
            "{{ipAddress}}",
          )
            ? process.env.VERCEL === "1"
              ? ipAddress(request)
              : LOCALHOST_IP
            : undefined,
        verificationToken: hashedVerificationToken ?? undefined,
        ...(isTeamMember && { isTeamMember: true }),
        ...(agentsEnabled && { agentsEnabled: true }),
        ...(isEmbeddable && { isEmbeddable: true }),
      };

      const response = NextResponse.json(returnObject);

      if (!isPreview && newView) {
        const ipAddressValue = ipAddress(request) ?? LOCALHOST_IP;
        const userAgent = request.headers.get("user-agent") ?? "unknown";
        const fingerprint = generateSessionFingerprint(
          collectFingerprintHeaders(request.headers),
        );
        const { token: sessionToken, expiresAt } = await createLinkSession(
          linkId,
          "DOCUMENT_LINK",
          newView.id,
          effectiveEmail ?? "",
          ipAddressValue,
          userAgent,
          isEmailVerified,
          viewer?.id ?? undefined,
          documentId,
          undefined,
          fingerprint,
        );

        response.cookies.set(getLinkSessionCookieName(linkId), sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          expires: new Date(expiresAt),
          path: "/",
        });
      }

      return response;
    } catch (error) {
      log({
        message: `Failed to record view for ${linkId}. \n\n ${error}`,
        type: "error",
        mention: true,
      });
      return NextResponse.json(
        { message: (error as Error).message },
        { status: 500 },
      );
    }
  } catch (error) {
    log({
      message: `Failed to process request. \n\n ${error}`,
      type: "error",
      mention: true,
    });
    return NextResponse.json(
      { message: (error as Error).message },
      { status: 500 },
    );
  }
}
