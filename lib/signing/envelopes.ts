import { TeamError } from "@/lib/errorHandler";

import { getSigningClient } from "./client";

/** O(1) keyed lookup of a Documenso V2 envelope by its `envelopeId` — prefer over the old paginated find/filter helpers wherever the id is known. */
export const getEnvelope = (envelopeId: string) =>
  getSigningClient().envelopes.get({ envelopeId });

/** Mint a pre-signed download URL for a signed envelope: fast path via the numeric `documentId`, legacy fallback resolves the envelope's primary item. */
export const getEnvelopeSignedDownloadUrl = async ({
  envelopeId,
  documentId,
}: {
  envelopeId: string;
  documentId?: number | null;
}): Promise<{ url: string }> => {
  const signingClient = getSigningClient();

  if (documentId) {
    const download = await signingClient.document.documentDownload({
      documentId,
      version: "signed",
    });

    if (!download.downloadUrl) {
      throw new TeamError(
        "Documenso did not return a download URL for the signed agreement.",
      );
    }

    return { url: download.downloadUrl };
  }

  // Legacy path: resolve the envelope and use the envelope-item download route.
  const envelope = await getEnvelope(envelopeId);
  const primaryItem =
    envelope.envelopeItems.find((item) => item.order === 1) ??
    envelope.envelopeItems[0];

  if (!primaryItem) {
    throw new TeamError(
      "Signed agreement file could not be located in the signing envelope.",
    );
  }

  const itemDownload = await signingClient.envelopes.items.download({
    envelopeItemId: primaryItem.id,
    version: "signed",
  });

  // The SDK types this response body as `any`, but in practice it's `{ downloadUrl: string }` — extract defensively and error if the shape changes.
  const url = (itemDownload.result as { downloadUrl?: unknown } | undefined)
    ?.downloadUrl;

  if (typeof url !== "string" || url.length === 0) {
    throw new TeamError(
      "Documenso did not return a download URL for the signed agreement.",
    );
  }

  return { url };
};
