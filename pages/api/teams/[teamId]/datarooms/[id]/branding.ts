import { NextApiRequest, NextApiResponse } from "next";

import {
  type DataroomCardLayout,
  DataroomCardLayoutSchema,
  type DataroomViewerHeaderStyle,
  DataroomViewerHeaderStyleSchema,
  type DataroomViewerLayoutPreset,
  DataroomViewerLayoutPresetSchema,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { upsertDataroomBrandAndClearInherited } from "@/ee/features/branding/lib/upsert-dataroom-brand";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { del } from "@vercel/blob";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { validateRedirectUrl } from "@/lib/api/domains/validate-redirect-url";
import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import {
  teamPlanAllowsCustomWelcomeAndCta,
  teamPlanAllowsLayoutCustomization,
  teamPlanAllowsVisitorLanguage,
} from "@/lib/billing/team-plan-custom-messaging";
import { errorhandler } from "@/lib/errorHandler";
import { DEFAULT_LOCALE, SUPPORTED_LOCALE_CODES } from "@/lib/i18n/locales";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

const updateDataroomBrandingSchema = z.object({
  logo: z.string().nullable().optional(),
  // Nullable on purpose: null clears the override so the team setting applies.
  hideLogo: z.boolean().nullable().optional(),
  banner: z.string().nullable().optional(),
  brandColor: z.string().nullable().optional(),
  accentColor: z.string().nullable().optional(),
  accentButtonColor: z.string().nullable().optional(),
  applyAccentColorToDataroomView: z.boolean().optional(),
  welcomeMessage: z.string().nullable().optional(),
  ctaLabel: z.string().nullable().optional(),
  ctaUrl: z.string().nullable().optional(),
  customLinkPreviewEnabled: z.boolean().optional(),
  linkPreviewTitle: z.string().nullable().optional(),
  linkPreviewDescription: z.string().nullable().optional(),
  linkPreviewImage: z.string().nullable().optional(),
  linkPreviewFavicon: z.string().nullable().optional(),
  cardLayout: DataroomCardLayoutSchema.optional(),
  showFolderTree: z.boolean().optional(),
  viewerLayoutPreset: DataroomViewerLayoutPresetSchema.optional(),
  viewerHeaderStyle: DataroomViewerHeaderStyleSchema.optional(),
  hideFolderIconsInMain: z.boolean().optional(),
  // Admin-chosen viewer language. Constrained to the server's supported list
  // so a hand-crafted request can't poison the DB with a code the viewer
  // can't load translations for.
  defaultLanguage: z
    .enum(SUPPORTED_LOCALE_CODES as unknown as [string, ...string[]])
    .optional(),
});

type LayoutFields = {
  cardLayout?: DataroomCardLayout;
  showFolderTree?: boolean;
  viewerLayoutPreset?: DataroomViewerLayoutPreset;
  viewerHeaderStyle?: DataroomViewerHeaderStyle;
  hideFolderIconsInMain?: boolean;
};

/**
 * Strip any layout fields whose value is missing or not in the allow-list.
 * Mirrors the team-level branding API so dataroom branding cannot be used to
 * bypass plan gating from the UI by hand-crafting an API request. Allowed
 * values are sourced from `ee/features/branding/lib/dataroom-viewer-layout`.
 */
function sanitizeLayoutPayload(input: LayoutFields): LayoutFields {
  const out: LayoutFields = {};
  if (
    input.cardLayout &&
    DataroomCardLayoutSchema.safeParse(input.cardLayout).success
  ) {
    out.cardLayout = input.cardLayout;
  }
  if (typeof input.showFolderTree === "boolean") {
    out.showFolderTree = input.showFolderTree;
  }
  if (
    input.viewerLayoutPreset &&
    DataroomViewerLayoutPresetSchema.safeParse(input.viewerLayoutPreset).success
  ) {
    out.viewerLayoutPreset = input.viewerLayoutPreset;
  }
  if (
    input.viewerHeaderStyle &&
    DataroomViewerHeaderStyleSchema.safeParse(input.viewerHeaderStyle).success
  ) {
    out.viewerHeaderStyle = input.viewerHeaderStyle;
  }
  if (typeof input.hideFolderIconsInMain === "boolean") {
    out.hideFolderIconsInMain = input.hideFolderIconsInMain;
  }
  return out;
}

/** Vercel Blob `del` only accepts URLs we uploaded there; skip sentinels & local paths */
function maybeDeleteBlobAsset(url: string | null | undefined): Promise<void> {
  if (!url || url === "no-banner") return Promise.resolve();
  if (url.startsWith("/") || url.startsWith("data:")) return Promise.resolve();
  return del(url).catch(() => {});
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };

  // Scoped members may only manage branding for their assigned rooms.
  if (
    await enforceDataroomMemberScope({
      userId: (session.user as CustomUser).id,
      teamId,
      dataroomId,
      res,
    })
  ) {
    return;
  }

  let roomBrandId: string | null = null;
  try {
    const dataroom = await prisma.dataroom.findUnique({
      where: {
        id: dataroomId,
        teamId: teamId,
      },
      select: {
        id: true,
        brandId: true,
      },
    });

    if (!dataroom) {
      return res.status(404).end("Dataroom not found");
    }
    roomBrandId = dataroom.brandId;
  } catch (error) {
    errorhandler(error, res);
    return;
  }

  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/branding
    const brand = await prisma.dataroomBrand.findUnique({
      where: {
        dataroomId,
      },
    });
    return res.status(200).json({
      brand,
      dataroomBrandId: roomBrandId,
    });
  } else if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/:id/branding
    const teamAuth = await prisma.team.findFirst({
      where: {
        id: teamId,
        users: { some: { userId: (session.user as CustomUser).id } },
      },
      select: { plan: true },
    });
    if (!teamAuth) {
      return res.status(403).end("Unauthorized to access this team");
    }
    const messagingAllowed = teamPlanAllowsCustomWelcomeAndCta(teamAuth.plan);
    const layoutAllowed = teamPlanAllowsLayoutCustomization(teamAuth.plan);
    const languageAllowed = teamPlanAllowsVisitorLanguage(teamAuth.plan);

    const parsed = updateDataroomBrandingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const body = parsed.data;

    const layoutData = layoutAllowed
      ? sanitizeLayoutPayload({
          cardLayout: body.cardLayout,
          showFolderTree: body.showFolderTree,
          viewerLayoutPreset: body.viewerLayoutPreset,
          viewerHeaderStyle: body.viewerHeaderStyle,
          hideFolderIconsInMain: body.hideFolderIconsInMain,
        })
      : {};

    // English is free on every plan; non-English requires a Data Rooms tier.
    // A hand-crafted request from a lower plan is silently dropped instead of
    // erroring so the rest of the branding save still succeeds.
    const languageData =
      body.defaultLanguage &&
      (languageAllowed || body.defaultLanguage === DEFAULT_LOCALE)
        ? { defaultLanguage: body.defaultLanguage }
        : {};

    let validatedCtaUrl: string | null | undefined = body.ctaUrl;
    if (messagingAllowed && typeof body.ctaUrl === "string") {
      const ctaValidation = await validateRedirectUrl(body.ctaUrl, teamId);
      if (!ctaValidation.valid) {
        return res.status(400).json({ message: ctaValidation.message });
      }
      validatedCtaUrl = ctaValidation.url;
    }

    const brand = await upsertDataroomBrandAndClearInherited({
      dataroomId,
      teamId,
      data: {
        logo: body.logo ?? undefined,
        hideLogo: body.hideLogo,
        banner: body.banner ?? undefined,
        brandColor: body.brandColor ?? undefined,
        accentColor: body.accentColor ?? undefined,
        accentButtonColor: body.accentButtonColor ?? undefined,
        applyAccentColorToDataroomView:
          typeof body.applyAccentColorToDataroomView === "boolean"
            ? body.applyAccentColorToDataroomView
            : undefined,
        welcomeMessage: messagingAllowed ? body.welcomeMessage : null,
        ctaLabel: messagingAllowed ? (body.ctaLabel ?? undefined) : undefined,
        ctaUrl: messagingAllowed ? (validatedCtaUrl ?? undefined) : undefined,
        customLinkPreviewEnabled:
          messagingAllowed && typeof body.customLinkPreviewEnabled === "boolean"
            ? body.customLinkPreviewEnabled
            : false,
        linkPreviewTitle: messagingAllowed
          ? (body.linkPreviewTitle ?? undefined)
          : undefined,
        linkPreviewDescription: messagingAllowed
          ? (body.linkPreviewDescription ?? undefined)
          : undefined,
        linkPreviewImage: messagingAllowed
          ? (body.linkPreviewImage ?? undefined)
          : undefined,
        linkPreviewFavicon: messagingAllowed
          ? (body.linkPreviewFavicon ?? undefined)
          : undefined,
        ...layoutData,
        ...languageData,
      },
    });

    return res.status(200).json(brand);
  } else if (req.method === "PUT") {
    // PUT /api/teams/:teamId/datarooms/:id/branding
    const teamAuth = await prisma.team.findFirst({
      where: {
        id: teamId,
        users: { some: { userId: (session.user as CustomUser).id } },
      },
      select: { plan: true },
    });
    if (!teamAuth) {
      return res.status(403).end("Unauthorized to access this team");
    }
    const messagingAllowed = teamPlanAllowsCustomWelcomeAndCta(teamAuth.plan);
    const layoutAllowed = teamPlanAllowsLayoutCustomization(teamAuth.plan);
    const languageAllowed = teamPlanAllowsVisitorLanguage(teamAuth.plan);

    const parsed = updateDataroomBrandingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const body = parsed.data;

    const existingBrand = await prisma.dataroomBrand.findUnique({
      where: { dataroomId },
    });

    let validatedCtaUrl: string | null | undefined = body.ctaUrl;
    if (messagingAllowed && typeof body.ctaUrl === "string") {
      const ctaValidation = await validateRedirectUrl(body.ctaUrl, teamId);
      if (!ctaValidation.valid) {
        return res.status(400).json({ message: ctaValidation.message });
      }
      validatedCtaUrl = ctaValidation.url;
    }

    const resolvedWelcome = messagingAllowed
      ? body.welcomeMessage
      : (existingBrand?.welcomeMessage ?? null);
    const resolvedCtaLabel = messagingAllowed
      ? body.ctaLabel
      : (existingBrand?.ctaLabel ?? null);
    const resolvedCtaUrl = messagingAllowed
      ? validatedCtaUrl
      : (existingBrand?.ctaUrl ?? null);

    const layoutData = layoutAllowed
      ? sanitizeLayoutPayload({
          cardLayout: body.cardLayout,
          showFolderTree: body.showFolderTree,
          viewerLayoutPreset: body.viewerLayoutPreset,
          viewerHeaderStyle: body.viewerHeaderStyle,
          hideFolderIconsInMain: body.hideFolderIconsInMain,
        })
      : {};

    // English is free on every plan; non-English requires a Data Rooms tier.
    // When a lower-plan request supplies a paid locale we omit the field so
    // any existing saved value is preserved.
    const languageData =
      body.defaultLanguage &&
      (languageAllowed || body.defaultLanguage === DEFAULT_LOCALE)
        ? { defaultLanguage: body.defaultLanguage }
        : {};

    const brand = await upsertDataroomBrandAndClearInherited({
      dataroomId,
      teamId,
      data: {
        logo: body.logo,
        hideLogo: body.hideLogo,
        banner: body.banner,
        brandColor: body.brandColor,
        accentColor: body.accentColor,
        accentButtonColor: body.accentButtonColor,
        applyAccentColorToDataroomView:
          typeof body.applyAccentColorToDataroomView === "boolean"
            ? body.applyAccentColorToDataroomView
            : undefined,
        welcomeMessage: resolvedWelcome,
        ctaLabel: resolvedCtaLabel,
        ctaUrl: resolvedCtaUrl,
        // Plans without messaging access cannot mutate any link-preview
        // fields, so the stored value is preserved as-is. Prisma skips
        // updates for `undefined` values.
        customLinkPreviewEnabled:
          messagingAllowed && typeof body.customLinkPreviewEnabled === "boolean"
            ? body.customLinkPreviewEnabled
            : undefined,
        linkPreviewTitle: messagingAllowed ? body.linkPreviewTitle : undefined,
        linkPreviewDescription: messagingAllowed
          ? body.linkPreviewDescription
          : undefined,
        linkPreviewImage: messagingAllowed ? body.linkPreviewImage : undefined,
        linkPreviewFavicon: messagingAllowed
          ? body.linkPreviewFavicon
          : undefined,
        ...layoutData,
        ...languageData,
      },
    });

    return res.status(200).json(brand);
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/datarooms/:id/branding
    const brand = await prisma.dataroomBrand.findFirst({
      where: {
        dataroomId,
      },
      select: {
        id: true,
        logo: true,
        banner: true,
        linkPreviewImage: true,
        linkPreviewFavicon: true,
      },
    });

    if (brand) {
      await Promise.all([
        maybeDeleteBlobAsset(brand.logo),
        maybeDeleteBlobAsset(brand.banner),
        maybeDeleteBlobAsset(brand.linkPreviewImage),
        maybeDeleteBlobAsset(brand.linkPreviewFavicon),
      ]);
    }

    await prisma.dataroomBrand.deleteMany({
      where: { dataroomId },
    });

    return res.status(204).end();
  } else {
    // We only allow GET, POST, PUT, DELETE requests
    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
