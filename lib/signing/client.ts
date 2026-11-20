import { Documenso } from "@documenso/sdk-typescript";

import { TeamError } from "@/lib/errorHandler";

const DEFAULT_SIGNING_HOST = "https://app.documenso.com";

const stripTrailingSlash = (value: string) => value.replace(/\/$/, "");

export const getSigningHost = () => {
  return stripTrailingSlash(
    process.env.NEXT_PUBLIC_SIGNING_HOST || DEFAULT_SIGNING_HOST,
  );
};

export const getSigningApiUrl = () => {
  return stripTrailingSlash(
    process.env.SIGNING_API_URL || `${getSigningHost()}/api/v2`,
  );
};

export const getSigningWebhookSecret = (): string | null => {
  const secret = process.env.SIGNING_WEBHOOK_SECRET;

  if (!secret) {
    return null;
  }

  return secret;
};

let signingClient: Documenso | null = null;

export const getSigningClient = () => {
  const apiKey = process.env.SIGNING_API_KEY;

  if (!apiKey) {
    throw new TeamError("SIGNING_API_KEY environment variable is not set.");
  }

  if (!signingClient) {
    signingClient = new Documenso({
      apiKey,
      serverURL: getSigningApiUrl(),
      timeoutMs: 30000,
    });
  }

  return signingClient;
};
