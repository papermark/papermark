export const GENERIC_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "tutanota.com",
  "tuta.com",
  "fastmail.com",
  "hey.com",
];

/**
 * Returns true if the email belongs to a well-known free / consumer email
 * provider (e.g. gmail.com, outlook.com).  Useful for distinguishing
 * organisation-owned domains from personal addresses.
 */
export const isGenericEmail = (email: string): boolean => {
  const domain = email.trim().toLowerCase().split("@").pop();
  return !!domain && GENERIC_EMAIL_DOMAINS.includes(domain);
};

/**
 * Returns true if the bare domain (no "@" prefix) is a well-known free /
 * consumer email provider.
 */
export const isGenericDomain = (domain: string): boolean => {
  return GENERIC_EMAIL_DOMAINS.includes(domain.trim().toLowerCase());
};

export function extractEmailDomain(email: string): string | null {
  if (!email || typeof email !== "string") {
    return null;
  }
  const normalizedEmail = email.trim().toLowerCase();

  const atSymbolCount = (normalizedEmail.match(/@/g) || []).length;
  if (atSymbolCount !== 1) {
    return null;
  }

  const atIndex = normalizedEmail.lastIndexOf("@");
  if (atIndex === -1 || atIndex === normalizedEmail.length - 1) {
    return null;
  }

  const domain = normalizedEmail.substring(atIndex);

  if (domain.length <= 1) {
    return null;
  }

  return domain;
}

const GROUP_DOMAIN_REGEX =
  /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Normalize a viewer-group domain audience entry to the canonical stored and
 * runtime format: a lowercased, "@"-prefixed domain such as "@acme.com".
 *
 * Membership at view time compares stored domains against extractEmailDomain(),
 * which yields "@acme.com", so every stored/accepted domain must carry the "@"
 * prefix. Accepts input with or without the prefix (the public API documents
 * bare domains like "acme.com"; the dashboard uses "@acme.com"). Returns null
 * when the value is not a valid domain.
 */
export function normalizeGroupDomain(input: string): string | null {
  if (!input || typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim().toLowerCase();
  const bare = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!GROUP_DOMAIN_REGEX.test(bare)) {
    return null;
  }
  return `@${bare}`;
}

export function mergeGroupDomains(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...existing, ...incoming]) {
    const normalized = normalizeGroupDomain(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

export function normalizeListEntry(entry: string): string {
  if (!entry || typeof entry !== "string") {
    return "";
  }
  return entry.trim().toLowerCase();
}

export function isEmailMatched(email: string, entry: string): boolean {
  if (!email || !entry) {
    return false;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedEntry = normalizeListEntry(entry);

  // Direct email match
  if (normalizedEmail === normalizedEntry) {
    return true;
  }

  // Domain match (entry starts with @)
  if (normalizedEntry.startsWith("@")) {
    const emailDomain = extractEmailDomain(normalizedEmail);
    return emailDomain === normalizedEntry;
  }

  return false;
}
