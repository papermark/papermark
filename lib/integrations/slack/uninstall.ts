import { InstalledIntegration } from "@prisma/client";

import { getSlackEnv } from "./env";
import { SlackCredential } from "./types";
import { decryptSlackToken } from "./utils";

// Slack error codes that mean the remote app is already effectively uninstalled
// or the stored credentials are unusable. We treat these as "nothing left to do
// remotely" so the local disconnect can still succeed.
const ALREADY_UNINSTALLED_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "invalid_client_id",
  "bad_client_secret",
  "invalid_grant",
]);

export type SlackUninstallResult =
  | { ok: true }
  | { ok: false; error: string; recoverable: boolean };

export const uninstallSlackIntegration = async ({
  installation,
}: {
  installation: InstalledIntegration;
}): Promise<SlackUninstallResult> => {
  let env: ReturnType<typeof getSlackEnv>;
  try {
    env = getSlackEnv();
  } catch (e) {
    console.error("[Slack App] Failed to load Slack env for uninstall:", e);
    return {
      ok: false,
      error: "config_error",
      recoverable: false,
    };
  }

  const credentials = installation.credentials as SlackCredential;

  let decryptedToken: string;
  try {
    decryptedToken = decryptSlackToken(credentials.accessToken);
  } catch (e) {
    console.error("[Slack App] Failed to decrypt access token:", e);
    return {
      ok: false,
      error: "decrypt_failed",
      recoverable: true,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("https://slack.com/api/apps.uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: decryptedToken,
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    console.error("[Slack App] Network error during apps.uninstall:", e);
    return { ok: false, error: "network_error", recoverable: false };
  }
  clearTimeout(timeout);

  let data: { ok?: boolean; error?: string } = {};
  try {
    data = await response.json();
  } catch {
    // Ignore body parse errors; we'll treat this like an unknown failure below
  }

  if (response.ok && data.ok) {
    return { ok: true };
  }

  console.error("[Slack App] apps.uninstall failed:", {
    status: response.status,
    data,
  });

  const slackError = data.error || `http_${response.status}`;

  if (ALREADY_UNINSTALLED_ERRORS.has(slackError)) {
    return { ok: false, error: slackError, recoverable: true };
  }

  return { ok: false, error: slackError, recoverable: false };
};
