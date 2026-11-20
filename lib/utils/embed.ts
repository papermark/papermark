// Custom-domain embeds are served from the customer's domain so the iframe is
// first-party relative to a host app on the same root domain, letting the
// session cookie flow. Falls back to the default papermark URL otherwise.
export function getEmbedUrl({
  linkId,
  domain,
  slug,
  baseUrl = process.env.NEXT_PUBLIC_BASE_URL,
}: {
  linkId: string;
  domain?: string | null;
  slug?: string | null;
  baseUrl?: string;
}): string {
  if (domain && slug) {
    return `https://${domain}/${slug}/embed`;
  }
  return `${baseUrl}/view/${linkId}/embed`;
}
