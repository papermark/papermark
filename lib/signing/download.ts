export const getErrorMessageFromResponse = async (
  response: Response,
  fallback: string,
) => {
  const rawMessage = await response.text().catch(() => "");

  if (!rawMessage) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      message?: string;
      error?: string;
    };

    return parsed.message || parsed.error || fallback;
  } catch {
    return rawMessage;
  }
};

const filenameFromDisposition = (disposition: string | null) => {
  if (!disposition) return null;

  const starMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1]);
    } catch {
      return starMatch[1];
    }
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const bareMatch = disposition.match(/filename=([^;]+)/i);
  return bareMatch?.[1]?.trim() ?? null;
};

const filenameFromDownloadUrl = (url: string) => {
  try {
    const disposition = new URL(url).searchParams.get(
      "response-content-disposition",
    );
    return filenameFromDisposition(disposition);
  } catch {
    return null;
  }
};

export const buildTeamSignedAgreementDownloadUrl = ({
  teamId,
  agreementId,
  responseId,
}: {
  teamId: string;
  agreementId: string;
  responseId: string;
}) =>
  `/api/teams/${teamId}/agreements/${agreementId}/responses/${responseId}/download`;

export const downloadSignedAgreement = async ({
  url,
  fallbackFilename = "agreement_signed.pdf",
}: {
  url: string;
  fallbackFilename?: string;
}) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error(
      "Signed agreement downloads can only be triggered from the browser.",
    );
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      await getErrorMessageFromResponse(
        response,
        "Failed to download the signed agreement.",
      ),
    );
  }

  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get("content-disposition")) ||
    filenameFromDownloadUrl(response.url) ||
    fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Defer revoke so Safari/WebKit has time to start the download before the
  // blob URL is invalidated; revoking synchronously can abort the download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};
