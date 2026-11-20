export type StoredAgreementResponse = {
  agreementResponseId: string;
  signingStatus: string;
};

export const getAgreementResponseStorageKey = (
  linkId: string,
  agreementId: string,
): string => `papermark.agreement.${linkId}.${agreementId}`;

export const parseStoredAgreementResponse = (
  raw: string | null,
): StoredAgreementResponse | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredAgreementResponse | null;
    if (
      !parsed ||
      typeof parsed.agreementResponseId !== "string" ||
      typeof parsed.signingStatus !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};
