import { NextApiRequest, NextApiResponse } from "next";

import {
  type DataroomCardLayout,
  DataroomCardLayoutSchema,
  type DataroomViewerHeaderStyle,
  DataroomViewerHeaderStyleSchema,
  type DataroomViewerLayoutPreset,
  DataroomViewerLayoutPresetSchema,
} from "@/ee/features/branding/lib/dataroom-viewer-layout";
import { deleteTeamBrand } from "@/ee/features/branding/lib/delete-team-brand";
import {
  findDefaultBrand,
  persistDefaultBrand,
} from "@/ee/features/branding/lib/resolve-base-brand";
import { z } from "zod";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { validateRedirectUrl } from "@/lib/api/domains/validate-redirect-url";
import {
  teamPlanAllowsCustomWelcomeAndCta,
  teamPlanAllowsLayoutCustomization,
} from "@/lib/billing/team-plan-custom-messaging";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import {
  clearCachedBrandLogo,
  writeCachedBrandLogo,
} from "@/lib/redis/brand-logo-cache";

const updateBrandingSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  logo: z.string().nullable().optional(),
  hideLogo: z.boolean().optional(),
  banner: z.string().nullable().optional(),
  brandColor: z.string().nullable().optional(),
  accentColor: z.string().nullable().optional(),
  accentButtonColor: z.string().nullable().optional(),
  applyAccentColorToDataroomView: z.boolean().optional(),
  welcomeMessage: z.string().nullable().optional(),
  customLinkPreviewEnabled: z.boolean().optional(),
  linkPreviewTitle: z.string().nullable().optional(),
  linkPreviewDescription: z.string().nullable().optional(),
  linkPreviewImage: z.string().nullable().optional(),
  linkPreviewFavicon: z.string().nullable().optional(),
  ctaLabel: z.string().nullable().optional(),
  ctaUrl: z.string().nullable().optional(),
  privacyPolicyUrl: z.string().nullable().optional(),
  cardLayout: DataroomCardLayoutSchema.optional(),
  showFolderTree: z.boolean().optional(),
  viewerLayoutPreset: DataroomViewerLayoutPresetSchema.optional(),
  viewerHeaderStyle: DataroomViewerHeaderStyleSchema.optional(),
  hideFolderIconsInMain: z.boolean().optional(),
});

type LayoutPayload = {
  cardLayout?: DataroomCardLayout;
  showFolderTree?: boolean;
  viewerLayoutPreset?: DataroomViewerLayoutPreset;
  viewerHeaderStyle?: DataroomViewerHeaderStyle;
  hideFolderIconsInMain?: boolean;
};

/**
 * Re-validate the layout payload at the persistence boundary. The route-level
 * Zod parse already rejects unknown values, but we re-narrow here because
 * `sanitizeLayoutPayload` is the single sink that writes layout fields and we
 * want a defense-in-depth guard against future callers that bypass the
 * top-level schema.
 */
function sanitizeLayoutPayload(input: LayoutPayload): LayoutPayload {
  const out: LayoutPayload = {};
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

// Returns `undefined` to leave the stored value untouched (Prisma skips it).
async function resolvePrivacyPolicyUrl(
  teamId: string,
  value: string | null | undefined,
): Promise<
  { ok: true; url: string | null | undefined } | { ok: false; message: string }
> {
  const featureFlags = await getFeatureFlags({ teamId });
  if (!featureFlags.customPrivacyUrl || value === undefined) {
    return { ok: true, url: undefined };
  }

  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { ok: true, url: null };
  }

  const validation = await validateRedirectUrl(trimmed, teamId);
  if (!validation.valid) {
    return {
      ok: false,
      message: validation.message.replace("Redirect URL", "Privacy policy URL"),
    };
  }

  return { ok: true, url: validation.url || null };
}

const getHandler = withTeamApi(
  async ({ res, teamId }) => {
    const brand = await findDefaultBrand(teamId);

    if (!brand) {
      return res.status(200).json(null);
    }

    return res.status(200).json(brand);
  },
  { requiredPermissions: ["branding.read"] },
);

const postHandler = withTeamApi(
  async ({ req, res, teamId, team }) => {
    const messagingAllowed = teamPlanAllowsCustomWelcomeAndCta(team.plan);
    const layoutAllowed = teamPlanAllowsLayoutCustomization(team.plan);

    const parsed = updateBrandingSchema.safeParse(req.body);
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

    // Run the CTA URL through the shared validator (HTTPS, SSRF guard,
    // Edge Config keyword blocklist with trusted-team bypass). Only run
    // when the plan permits messaging, since otherwise the value is
    // ignored at the persistence step anyway.
    let validatedCtaUrl: string | null | undefined = body.ctaUrl;
    if (messagingAllowed && typeof body.ctaUrl === "string") {
      const ctaValidation = await validateRedirectUrl(body.ctaUrl, teamId);
      if (!ctaValidation.valid) {
        return res.status(400).json({ message: ctaValidation.message });
      }
      validatedCtaUrl = ctaValidation.url;
    }

    const privacyPolicy = await resolvePrivacyPolicyUrl(
      teamId,
      body.privacyPolicyUrl,
    );
    if (!privacyPolicy.ok) {
      return res.status(400).json({ message: privacyPolicy.message });
    }

    const brand = await persistDefaultBrand({
      teamId,
      create: {
        name: body.name ?? "Default",
        logo: body.logo,
        hideLogo: body.hideLogo ?? false,
        banner: body.banner,
        brandColor: body.brandColor,
        accentColor: body.accentColor,
        accentButtonColor: body.accentButtonColor ?? undefined,
        applyAccentColorToDataroomView:
          body.applyAccentColorToDataroomView ?? false,
        welcomeMessage: messagingAllowed ? (body.welcomeMessage ?? null) : null,
        customLinkPreviewEnabled: messagingAllowed
          ? (body.customLinkPreviewEnabled ?? false)
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
        ctaLabel: messagingAllowed ? (body.ctaLabel ?? undefined) : undefined,
        ctaUrl: messagingAllowed ? (validatedCtaUrl ?? undefined) : undefined,
        privacyPolicyUrl: privacyPolicy.url ?? undefined,
        ...layoutData,
        teamId: teamId,
      },
      update: {
        name: body.name,
        logo: body.logo,
        hideLogo: body.hideLogo,
        banner: body.banner,
        brandColor: body.brandColor,
        accentColor: body.accentColor,
        accentButtonColor: body.accentButtonColor ?? null,
        applyAccentColorToDataroomView:
          body.applyAccentColorToDataroomView ?? false,
        welcomeMessage: messagingAllowed
          ? (body.welcomeMessage ?? null)
          : undefined,
        privacyPolicyUrl: privacyPolicy.url,
        customLinkPreviewEnabled: messagingAllowed
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
        ctaLabel: messagingAllowed ? body.ctaLabel : undefined,
        ctaUrl: messagingAllowed ? validatedCtaUrl : undefined,
        ...layoutData,
      },
    });

    await writeCachedBrandLogo(teamId, brand);

    return res.status(200).json(brand);
  },
  { requiredPermissions: ["branding.write"] },
);

const putHandler = withTeamApi(
  async ({ req, res, teamId, team }) => {
    const messagingAllowed = teamPlanAllowsCustomWelcomeAndCta(team.plan);
    const layoutAllowed = teamPlanAllowsLayoutCustomization(team.plan);

    const parsed = updateBrandingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const body = parsed.data;

    const existingBrand = await findDefaultBrand(teamId);

    let validatedCtaUrl: string | null | undefined = body.ctaUrl;
    if (messagingAllowed && typeof body.ctaUrl === "string") {
      const ctaValidation = await validateRedirectUrl(body.ctaUrl, teamId);
      if (!ctaValidation.valid) {
        return res.status(400).json({ message: ctaValidation.message });
      }
      validatedCtaUrl = ctaValidation.url;
    }

    const privacyPolicy = await resolvePrivacyPolicyUrl(
      teamId,
      body.privacyPolicyUrl,
    );
    if (!privacyPolicy.ok) {
      return res.status(400).json({ message: privacyPolicy.message });
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

    const brand = await persistDefaultBrand({
      teamId,
      create: {
        name: body.name ?? "Default",
        logo: body.logo,
        hideLogo: body.hideLogo ?? false,
        banner: body.banner,
        brandColor: body.brandColor,
        accentColor: body.accentColor,
        accentButtonColor: body.accentButtonColor ?? undefined,
        applyAccentColorToDataroomView: !!body.applyAccentColorToDataroomView,
        welcomeMessage: messagingAllowed ? (body.welcomeMessage ?? null) : null,
        customLinkPreviewEnabled: messagingAllowed
          ? !!body.customLinkPreviewEnabled
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
        ctaLabel: messagingAllowed ? (body.ctaLabel ?? undefined) : undefined,
        ctaUrl: messagingAllowed ? (validatedCtaUrl ?? undefined) : undefined,
        privacyPolicyUrl: privacyPolicy.url ?? undefined,
        ...layoutData,
        teamId: teamId,
      },
      update: {
        name: body.name,
        logo: body.logo,
        hideLogo: body.hideLogo,
        banner: body.banner,
        brandColor: body.brandColor,
        accentColor: body.accentColor,
        accentButtonColor: body.accentButtonColor ?? null,
        applyAccentColorToDataroomView: !!body.applyAccentColorToDataroomView,
        welcomeMessage: resolvedWelcome,
        privacyPolicyUrl: privacyPolicy.url,
        // Preserve stored link-preview settings on partial PUTs: only write
        // these fields when they're explicitly present in the payload.
        // Prisma skips updates for `undefined` values. Plans without messaging
        // access cannot mutate any link-preview fields, so the stored value
        // is preserved as-is.
        customLinkPreviewEnabled: messagingAllowed
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
        ctaLabel: resolvedCtaLabel,
        ctaUrl: resolvedCtaUrl,
        ...layoutData,
      },
    });

    await writeCachedBrandLogo(teamId, brand);

    return res.status(200).json(brand);
  },
  { requiredPermissions: ["branding.write"] },
);

const deleteHandler = withTeamApi(
  async ({ res, teamId }) => {
    const brand = await findDefaultBrand(teamId);

    if (brand) {
      await deleteTeamBrand({ teamId, brand });
    } else {
      await prisma.team.update({
        where: { id: teamId },
        data: { defaultBrandId: null },
      });
      await clearCachedBrandLogo(teamId);
    }

    return res.status(204).end();
  },
  { requiredPermissions: ["branding.write"] },
);

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    return getHandler(req, res);
  }
  if (req.method === "POST") {
    return postHandler(req, res);
  }
  if (req.method === "PUT") {
    return putHandler(req, res);
  }
  if (req.method === "DELETE") {
    return deleteHandler(req, res);
  }

  res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
