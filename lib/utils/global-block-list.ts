import { isEmailMatched } from "@/lib/utils/email-domain";
import { validateEmail } from "@/lib/utils/validate-email";

export function checkGlobalBlockList(
  email: string | undefined,
  globalBlockList: string[] | undefined,
): { isBlocked: boolean; error?: string } {
  if (!email || !globalBlockList || globalBlockList.length === 0) {
    return { isBlocked: false };
  }

  if (!validateEmail(email)) {
    return {
      isBlocked: false,
      error: "Invalid email address",
    };
  }

  const isBlocked = globalBlockList.some((blockedEntry) =>
    isEmailMatched(email, blockedEntry),
  );

  return { isBlocked };
}

export type EmailAccessDenial = "allow" | "global" | "deny";

export type EmailAccessResult =
  | { denied: false }
  | { denied: true; reason: EmailAccessDenial; error?: string };

/**
 * Allow list is evaluated first and overrides the team-wide global block list,
 * so an explicit per-link allow (e.g. abc@gmail.com) can admit a visitor even
 * when their domain is blocked globally (e.g. @gmail.com). Per-link deny list
 * still applies after that.
 */
export function checkViewerEmailAccess({
  email,
  allowList,
  denyList,
  globalBlockList,
}: {
  email: string | undefined;
  allowList?: string[];
  denyList?: string[];
  globalBlockList?: string[];
}): EmailAccessResult {
  const combinedAllowList = allowList ?? [];
  const isOnAllowList =
    combinedAllowList.length > 0 &&
    combinedAllowList.some((entry) => isEmailMatched(email ?? "", entry));

  if (combinedAllowList.length > 0 && !isOnAllowList) {
    return { denied: true, reason: "allow" };
  }

  if (!isOnAllowList) {
    const globalBlockCheck = checkGlobalBlockList(email, globalBlockList);
    if (globalBlockCheck.error) {
      return { denied: true, reason: "global", error: globalBlockCheck.error };
    }
    if (globalBlockCheck.isBlocked) {
      return { denied: true, reason: "global" };
    }
  }

  if (denyList && denyList.length > 0) {
    const isDenied = denyList.some((denied) =>
      isEmailMatched(email ?? "", denied),
    );
    if (isDenied) {
      return { denied: true, reason: "deny" };
    }
  }

  return { denied: false };
}
