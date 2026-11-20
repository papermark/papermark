import { get } from "@vercel/edge-config";

export type BetaFeatures =
  | "tokens"
  | "incomingWebhooks"
  | "roomChangeNotifications"
  | "webhooks"
  | "conversations"
  | "dataroomUpload"
  | "inDocumentLinks"
  | "usStorage"
  | "dataroomIndex"
  | "dataroomFreeze"
  | "slack"
  | "annotations"
  | "dataroomInvitations"
  | "workflows"
  | "ai"
  | "sso"
  | "textSelection"
  | "redaction"
  | "requestList"
  | "logoOnAccessForm"
  | "htmlDocuments"
  | "hideFooterOnAccessForm"
  | "customPrivacyUrl";

type BetaFeaturesRecord = Record<BetaFeatures, string[]>;

const BETA_FEATURES_TTL_MS = 10_000;

// On Vercel an Edge Config read hits a local filesystem replica, but everywhere
// else (localhost, CI) it is an HTTPS round trip, and a single page render can
// resolve flags three or four times. One cache entry covers every team because
// they all read the same `betaFeatures` payload.
let cachedBetaFeatures:
  | { value: BetaFeaturesRecord | undefined; expiresAt: number }
  | undefined;
let inFlightBetaFeatures: Promise<BetaFeaturesRecord | undefined> | undefined;

async function fetchBetaFeatures(): Promise<BetaFeaturesRecord | undefined> {
  try {
    return await get<BetaFeaturesRecord>("betaFeatures");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Invalid or local EDGE_CONFIG tokens surface as Unauthorized; flags stay off.
    if (msg.includes("Unauthorized") || msg.includes("403")) {
      console.warn(
        "[featureFlags] Edge Config unavailable; beta flags default to off. Fix EDGE_CONFIG or unset it for local dev.",
      );
    } else {
      console.error(`Error getting beta features: ${e}`);
    }
    return undefined;
  }
}

// Failures are cached too, so a broken Edge Config degrades to "all flags off"
// instead of one failed round trip per call.
async function readBetaFeatures(): Promise<BetaFeaturesRecord | undefined> {
  if (cachedBetaFeatures && cachedBetaFeatures.expiresAt > Date.now()) {
    return cachedBetaFeatures.value;
  }

  inFlightBetaFeatures ??= fetchBetaFeatures().then((value) => {
    cachedBetaFeatures = { value, expiresAt: Date.now() + BETA_FEATURES_TTL_MS };
    inFlightBetaFeatures = undefined;
    return value;
  });

  return inFlightBetaFeatures;
}

export const getFeatureFlags = async ({ teamId }: { teamId?: string }) => {
  const teamFeatures: Record<BetaFeatures, boolean> = {
    tokens: false,
    incomingWebhooks: false,
    roomChangeNotifications: false,
    webhooks: false,
    conversations: false,
    dataroomUpload: false,
    inDocumentLinks: false,
    usStorage: false,
    dataroomIndex: false,
    dataroomFreeze: false,
    slack: false,
    annotations: false,
    dataroomInvitations: false,
    workflows: false,
    ai: false,
    sso: false,
    textSelection: false,
    redaction: false,
    requestList: false,
    logoOnAccessForm: false,
    htmlDocuments: false,
    hideFooterOnAccessForm: false,
    customPrivacyUrl: false,
  };

  // Return all features as false if edge config is not available
  if (!process.env.EDGE_CONFIG) {
    return Object.fromEntries(
      Object.entries(teamFeatures).map(([key, _v]) => [key, false]),
    );
  } else if (!teamId) {
    return teamFeatures;
  }

  const betaFeatures = await readBetaFeatures();

  if (betaFeatures) {
    for (const [featureFlag, teamIds] of Object.entries(betaFeatures)) {
      if (teamIds.includes(teamId)) {
        teamFeatures[featureFlag as BetaFeatures] = true;
      }
    }
  }

  return teamFeatures;
};
