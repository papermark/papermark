import { get } from "@vercel/edge-config";

/**
 * Allowlist of hostnames stored in Edge Config under the `embeddableDomains`
 * key as an array of plain strings. The list is intentionally kept out of the
 * codebase so that hosts can be added or removed without a deploy.
 *
 * Each entry is matched against the URL hostname (case-insensitive). Entries
 * beginning with a dot are treated as suffix matches (e.g. `.example.com`
 * matches `app.example.com` but not `example.com`). All other entries
 * require an exact hostname match.
 */

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const matchesHost = (hostname: string, host: string): boolean => {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedHost = host.toLowerCase();

  if (normalizedHost.startsWith(".")) {
    return normalizedHostname.endsWith(normalizedHost);
  }

  return normalizedHostname === normalizedHost;
};

/**
 * Reads the embeddable-domains allowlist from Edge Config. Returns an empty
 * array (i.e. nothing is embeddable) when Edge Config is not configured or
 * the key is missing/malformed.
 */
export const getEmbeddableDomains = async (): Promise<string[]> => {
  if (!process.env.EDGE_CONFIG) return [];

  try {
    const result = await get("embeddableDomains");
    if (!Array.isArray(result)) return [];
    return result.filter(isNonEmptyString);
  } catch {
    return [];
  }
};

/**
 * Returns true when the supplied URL is HTTPS and its hostname is on the
 * Edge-Config-backed allowlist.
 */
export const isEmbeddableUrl = async (
  url: string | null | undefined,
): Promise<boolean> => {
  if (!url) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const allowlist = await getEmbeddableDomains();
  if (allowlist.length === 0) return false;

  return allowlist.some((host) => matchesHost(parsed.hostname, host));
};
