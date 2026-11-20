import dynamic from "next/dynamic";

import {
  type CSSProperties,
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Brand, DataroomBrand } from "@prisma/client";
import {
  CheckCircle2,
  DownloadIcon,
  FileSignatureIcon,
  PenLineIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import useSWRImmutable from "swr/immutable";

import {
  type StoredAgreementResponse,
  getAgreementResponseStorageKey,
  parseStoredAgreementResponse,
} from "@/lib/signing/agreement-storage";
import {
  downloadSignedAgreement,
  getErrorMessageFromResponse,
} from "@/lib/signing/download";
import { fetcher } from "@/lib/utils";
import { validateEmail } from "@/lib/utils/validate-email";
import { localStorage } from "@/lib/webstorage";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { DEFAULT_ACCESS_FORM_TYPE } from ".";
import { useAccessFormTheme } from "./access-form-theme";

const getEmbedSurfaceColor = (value?: string) => {
  return value && value !== "transparent" ? value : "rgb(255 255 255)";
};

// Injected into the Documenso iframe to hide its sidebar and use only the bottom widget; kept at module scope for a stable string identity.
const SIGNING_EMBED_CSS = `
    /* Never render the signing sidebar — the hovering bottom widget is the
       only signing surface we want the visitor to use. */
    .embed--DocumentWidgetContainer {
      display: none !important;
    }

    /* Force the fixed bottom widget to show even at the desktop breakpoint
       where Documenso would otherwise hide it in favour of the sidebar. The
       widget wrapper is the \`lg:hidden\` direct child of the document viewer;
       this pairs with the sidebar rule above so a wider surface still keeps a
       signing control. */
    .embed--DocumentViewer > .lg\\:hidden {
      display: block !important;
    }

    /* Let the document reclaim the full width the sidebar used to occupy. */
    .embed--DocumentContainer {
      padding-left: 0;
      padding-right: 0;
    }

    .embed--Root,
    .embed--DocumentContainer,
    .embed--DocumentViewer {
      border-radius: 0.5rem;
    }

    /* Flatten Documenso's heavy default shadows so the header and the
       completed/waiting states sit cleanly inside the Papermark sheet. */
    .embed--DocumentWidgetHeader,
    .embed--DocumentCompleted,
    .embed--WaitingForTurn {
      box-shadow: none;
    }
  `;

const EmbedDirectTemplate = dynamic(
  () => import("@documenso/embed-react").then((mod) => mod.EmbedDirectTemplate),
  {
    ssr: false,
  },
);

type AgreementSigningSession = {
  agreementResponseId: string;
  externalId: string;
  token: string;
  host: string;
};

type AgreementSigningSessionResult =
  | (AgreementSigningSession & { alreadySigned?: false })
  | {
      alreadySigned: true;
      agreementResponseId: string;
      signingStatus: string;
    };

type SignedAgreementStatus = {
  signed?: boolean;
  agreementResponseId?: string;
  signingStatus?: string;
  signerEmail?: string | null;
  signerName?: string | null;
};

type CompletedSigningResult = {
  id: string;
  signingStatus: string;
};

const normalizeSignedEmail = (email?: string | null) => {
  if (typeof email !== "string") {
    return null;
  }

  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeSignedName = (name?: string | null) => {
  if (typeof name !== "string") {
    return null;
  }

  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const persistSignedAgreementResponse = ({
  linkId,
  agreementId,
  agreementResponseId,
  signingStatus,
}: {
  linkId: string;
  agreementId: string;
  agreementResponseId: string;
  signingStatus: string;
}) => {
  const payload: StoredAgreementResponse = {
    agreementResponseId,
    signingStatus,
  };

  localStorage.setItem(
    getAgreementResponseStorageKey(linkId, agreementId),
    JSON.stringify(payload),
  );
};

export default function AgreementSection({
  data,
  setData,
  agreementId,
  agreementContent,
  agreementName,
  agreementContentType,
  signingProvider,
  brand,
  linkId,
  requireEmail,
  requireName,
  hideFooterOnAccessForm,
}: {
  data: DEFAULT_ACCESS_FORM_TYPE;
  setData: Dispatch<SetStateAction<DEFAULT_ACCESS_FORM_TYPE>>;
  agreementId?: string;
  agreementContent: string;
  agreementName: string;
  agreementContentType?: string;
  signingProvider?: string;
  brand?: Partial<Brand> | Partial<DataroomBrand> | null;
  linkId?: string;
  requireEmail?: boolean;
  requireName?: boolean;
  hideFooterOnAccessForm?: boolean;
}) {
  const theme = useAccessFormTheme();
  const { t } = useTranslation("access-form");
  const isChecked = !!data.hasConfirmedAgreement;
  const protectedLinkLabel = hideFooterOnAccessForm
    ? "protected link"
    : "protected Papermark link";
  const visitorEmail = typeof data.email === "string" ? data.email.trim() : "";
  const visitorName = typeof data.name === "string" ? data.name.trim() : "";
  const currentSigningIdentity = `${visitorEmail}\n${visitorName}`;
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [isCompletingSession, setIsCompletingSession] = useState(false);
  const [isDownloadingSigned, setIsDownloadingSigned] = useState(false);
  const [session, setSession] = useState<AgreementSigningSession | null>(null);
  const currentSigningIdentityRef = useRef(currentSigningIdentity);
  const sessionIdentityRef = useRef<string | null>(null);
  // Holds the in-flight session-creation request so a pre-warm (hover/focus)
  // and a subsequent click both await the same POST instead of firing two.
  const sessionPromiseRef =
    useRef<Promise<AgreementSigningSession | null> | null>(null);
  const sessionPromiseIdentityRef = useRef<string | null>(null);
  // Pre-warm fires at most once per mount; reset on failure so a click retries.
  const hasPrewarmedSessionRef = useRef(false);

  const handleCheckChange = (checked: boolean) => {
    setData((prevData) => ({ ...prevData, hasConfirmedAgreement: checked }));
  };

  const toggleAgreement = () => {
    handleCheckChange(!isChecked);
  };

  const isSigningAgreement =
    signingProvider === "DOCUMENSO" || agreementContentType === "SIGNING";
  const isTextContent = agreementContentType === "TEXT";
  const hasRequiredSigningIdentity =
    (!requireName || visitorName.length > 0) &&
    (!requireEmail || validateEmail(visitorEmail));
  const hasCurrentSigningSession =
    !!session && sessionIdentityRef.current === currentSigningIdentity;
  const signingIdentityPrompt =
    requireName && requireEmail
      ? "Enter your name and email address before opening signing."
      : requireName
        ? "Enter your name before opening signing."
        : "Enter a valid email address before opening signing.";

  useEffect(() => {
    currentSigningIdentityRef.current = currentSigningIdentity;
    hasPrewarmedSessionRef.current = false;
  }, [currentSigningIdentity]);

  // The stored response id is only a hint the status API honors with a matching session-proof cookie, so it's safe to fold into the cache key.
  const storedAgreementResponseId = useMemo(() => {
    if (!isSigningAgreement || !linkId || !agreementId) {
      return null;
    }

    return (
      parseStoredAgreementResponse(
        localStorage.getItem(
          getAgreementResponseStorageKey(linkId, agreementId),
        ),
      )?.agreementResponseId ?? null
    );
  }, [isSigningAgreement, linkId, agreementId]);

  // Only hydrate while unconfirmed (null key disables the request); useSWRImmutable since signed status is effectively one-shot.
  const signedStatusKey = useMemo(() => {
    if (
      !isSigningAgreement ||
      !agreementId ||
      !linkId ||
      data.hasConfirmedAgreement
    ) {
      return null;
    }

    const params = new URLSearchParams({ linkId, agreementId });
    if (storedAgreementResponseId) {
      params.set("agreementResponseId", storedAgreementResponseId);
    }

    return `/api/agreements/signing/status?${params.toString()}`;
  }, [
    isSigningAgreement,
    agreementId,
    linkId,
    data.hasConfirmedAgreement,
    storedAgreementResponseId,
  ]);

  // Best-effort hydration; failures are ignored so the visitor can still sign.
  const { data: signedStatus } = useSWRImmutable<SignedAgreementStatus>(
    signedStatusKey,
    fetcher,
  );

  useEffect(() => {
    if (
      !linkId ||
      !agreementId ||
      data.hasConfirmedAgreement ||
      !signedStatus?.signed ||
      !signedStatus.agreementResponseId ||
      !signedStatus.signingStatus
    ) {
      return;
    }

    const { agreementResponseId, signingStatus } = signedStatus;
    const signerEmail = normalizeSignedEmail(signedStatus.signerEmail);
    const signerName = normalizeSignedName(signedStatus.signerName);

    setData((prevData) => ({
      ...prevData,
      hasConfirmedAgreement: true,
      agreementResponseId,
      agreementStatus: signingStatus,
      email: signerEmail ?? prevData.email,
      name: signerName ?? prevData.name,
    }));

    persistSignedAgreementResponse({
      linkId,
      agreementId,
      agreementResponseId,
      signingStatus,
    });
  }, [signedStatus, agreementId, linkId, data.hasConfirmedAgreement, setData]);

  const signedAgreementHref = data.agreementResponseId
    ? `/api/agreements/signing/${data.agreementResponseId}/download`
    : null;

  // The embed re-initializes when these change identity, so we depend only on
  // the primitive theme tokens that actually feed into the CSS variables.
  const signingEmbedCssVars = useMemo(
    () => ({
      background: getEmbedSurfaceColor(theme.backgroundColor),
      foreground: theme.textColor,
      muted: getEmbedSurfaceColor(theme.panelBgColor),
      mutedForeground: theme.subtleTextColor,
      popover: getEmbedSurfaceColor(theme.panelBgColor),
      popoverForeground: theme.textColor,
      card: getEmbedSurfaceColor(theme.panelBgColor),
      cardBorder: theme.controlBorderColor,
      cardBorderTint: theme.controlBorderStrongColor,
      cardForeground: theme.textColor,
      fieldCard: getEmbedSurfaceColor(theme.controlBgColor),
      fieldCardBorder: theme.controlBorderColor,
      fieldCardForeground: theme.textColor,
      widget: getEmbedSurfaceColor(theme.panelBgColor),
      widgetForeground: theme.textColor,
      border: theme.controlBorderColor,
      input: theme.controlBorderStrongColor,
      primary: theme.ctaBgColor,
      primaryForeground: theme.ctaTextColor,
      secondary: getEmbedSurfaceColor(theme.controlBgColor),
      secondaryForeground: theme.textColor,
      accent: getEmbedSurfaceColor(theme.panelHoverBgColor),
      accentForeground: theme.textColor,
      destructive: "hsl(0 84.2% 60.2%)",
      destructiveForeground: "hsl(210 20% 98%)",
      ring: theme.controlBorderStrongColor,
      warning: "hsl(38 92% 50%)",
      radius: "0.5rem",
    }),
    [
      theme.backgroundColor,
      theme.controlBgColor,
      theme.controlBorderColor,
      theme.controlBorderStrongColor,
      theme.ctaBgColor,
      theme.ctaTextColor,
      theme.panelBgColor,
      theme.panelHoverBgColor,
      theme.subtleTextColor,
      theme.textColor,
    ],
  );

  const openSignedAgreement = async () => {
    if (!signedAgreementHref || isDownloadingSigned) {
      return;
    }

    setIsDownloadingSigned(true);

    try {
      await downloadSignedAgreement({ url: signedAgreementHref });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to download the signed copy.",
      );
    } finally {
      setIsDownloadingSigned(false);
    }
  };

  // Create or reuse the signing session; returns null when already-signed or unconfigured, and concurrent callers share one in-flight promise.
  const ensureSigningSession =
    useCallback(async (): Promise<AgreementSigningSession | null> => {
      const requestSigningIdentity = currentSigningIdentity;

      if (session && sessionIdentityRef.current === requestSigningIdentity) {
        return session;
      }
      if (
        sessionPromiseRef.current &&
        sessionPromiseIdentityRef.current === requestSigningIdentity
      ) {
        return sessionPromiseRef.current;
      }
      if (!agreementId || !linkId) {
        return null;
      }

      const createSession =
        async (): Promise<AgreementSigningSession | null> => {
          const stored = parseStoredAgreementResponse(
            localStorage.getItem(
              getAgreementResponseStorageKey(linkId, agreementId),
            ),
          );

          const response = await fetch("/api/agreements/signing/session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agreementId,
              linkId,
              email: visitorEmail.length > 0 ? visitorEmail : null,
              name: visitorName.length > 0 ? visitorName : null,
              agreementResponseId:
                data.agreementResponseId ?? stored?.agreementResponseId ?? null,
            }),
          });

          if (!response.ok) {
            throw new Error(
              await getErrorMessageFromResponse(
                response,
                "Failed to start the agreement signing session.",
              ),
            );
          }

          const result =
            (await response.json()) as AgreementSigningSessionResult;

          if (result.alreadySigned) {
            if (currentSigningIdentityRef.current === requestSigningIdentity) {
              setData((prevData) => ({
                ...prevData,
                hasConfirmedAgreement: true,
                agreementResponseId: result.agreementResponseId,
                agreementStatus: result.signingStatus,
              }));

              persistSignedAgreementResponse({
                linkId,
                agreementId,
                agreementResponseId: result.agreementResponseId,
                signingStatus: result.signingStatus,
              });
            }
            return null;
          }

          if (currentSigningIdentityRef.current !== requestSigningIdentity) {
            return null;
          }

          sessionIdentityRef.current = requestSigningIdentity;
          setSession(result);
          setData((prevData) => ({
            ...prevData,
            agreementResponseId: result.agreementResponseId,
            agreementStatus: "PENDING",
          }));
          return result;
        };

      const pending = createSession();
      sessionPromiseRef.current = pending;
      sessionPromiseIdentityRef.current = requestSigningIdentity;

      try {
        return await pending;
      } finally {
        if (sessionPromiseRef.current === pending) {
          sessionPromiseRef.current = null;
          sessionPromiseIdentityRef.current = null;
        }
      }
    }, [
      agreementId,
      currentSigningIdentity,
      linkId,
      session,
      visitorEmail,
      visitorName,
      data.agreementResponseId,
      setData,
    ]);

  // Pre-warm on hover/focus so the iframe is ready on click; fires once per mount and resets its guard on failure so the click can retry.
  const handlePrewarmSigningSession = useCallback(() => {
    if (
      hasPrewarmedSessionRef.current ||
      !isSigningAgreement ||
      !agreementId ||
      !linkId ||
      isChecked ||
      !hasRequiredSigningIdentity ||
      hasCurrentSigningSession ||
      sessionPromiseRef.current
    ) {
      return;
    }

    hasPrewarmedSessionRef.current = true;

    void ensureSigningSession().catch(() => {
      hasPrewarmedSessionRef.current = false;
    });
  }, [
    isSigningAgreement,
    agreementId,
    linkId,
    isChecked,
    hasRequiredSigningIdentity,
    hasCurrentSigningSession,
    ensureSigningSession,
  ]);

  const handleOpenSigningSheet = async () => {
    if (!hasRequiredSigningIdentity) {
      toast.error(signingIdentityPrompt);
      return;
    }

    if (!agreementId || !linkId) {
      toast.error(
        "Agreement signing is not configured correctly for this link.",
      );
      return;
    }

    if (isChecked && signedAgreementHref) {
      openSignedAgreement();
      return;
    }

    if (hasCurrentSigningSession) {
      setIsSheetOpen(true);
      return;
    }

    setIsPreparingSession(true);

    try {
      const preparedSession = await ensureSigningSession();

      if (preparedSession) {
        setIsSheetOpen(true);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to start the agreement signing session.",
      );
    } finally {
      setIsPreparingSession(false);
    }
  };

  const handleDocumentCompleted = async ({
    documentId,
    recipientId,
  }: {
    documentId: number;
    recipientId: number;
  }) => {
    if (!session) {
      toast.error("Agreement signing session is missing.");
      return;
    }

    setIsCompletingSession(true);

    try {
      const response = await fetch("/api/agreements/signing/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agreementResponseId: session.agreementResponseId,
          documentId,
          recipientId,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await getErrorMessageFromResponse(
            response,
            "Failed to confirm the signed agreement.",
          ),
        );
      }

      const result = (await response.json()) as CompletedSigningResult;

      setData((prevData) => ({
        ...prevData,
        hasConfirmedAgreement: true,
        agreementResponseId: result.id,
        agreementStatus: result.signingStatus,
      }));

      if (linkId && agreementId) {
        persistSignedAgreementResponse({
          linkId,
          agreementId,
          agreementResponseId: result.id,
          signingStatus: result.signingStatus,
        });
      }

      setIsSheetOpen(false);
      toast.success("Agreement signed successfully.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to confirm the signed agreement.",
      );
    } finally {
      setIsCompletingSession(false);
    }
  };

  if (isSigningAgreement) {
    const isLoading = isPreparingSession || isCompletingSession;

    return (
      <>
        <div className="pt-2">
          <div
            className="flex items-center gap-3 rounded-md border px-3 py-2 transition-colors"
            style={{
              borderColor: isChecked
                ? theme.controlBorderStrongColor
                : theme.controlBorderColor,
              backgroundColor: theme.controlBgColor,
            }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
              style={{
                backgroundColor: theme.panelBgColor,
                color: theme.textColor,
              }}
              aria-hidden="true"
            >
              {isChecked ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <FileSignatureIcon className="h-5 w-5" />
              )}
            </div>

            <p
              className="min-w-0 flex-1 truncate text-sm font-medium leading-5"
              style={{ color: theme.textColor }}
            >
              {agreementName}
            </p>

            {isChecked ? (
              signedAgreementHref ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openSignedAgreement}
                  loading={isDownloadingSigned}
                  className="shrink-0 border bg-transparent hover:opacity-90"
                  style={
                    {
                      backgroundColor: "transparent",
                      borderColor: theme.controlBorderStrongColor,
                      color: theme.textColor,
                    } as CSSProperties
                  }
                >
                  {!isDownloadingSigned ? (
                    <DownloadIcon className="!h-4 !w-4" />
                  ) : null}
                  {isDownloadingSigned ? "Preparing…" : "Download"}
                </Button>
              ) : null
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleOpenSigningSheet}
                onMouseEnter={handlePrewarmSigningSession}
                onFocus={handlePrewarmSigningSession}
                loading={isLoading}
                disabled={!hasRequiredSigningIdentity}
                className="shrink-0 hover:opacity-90"
                style={{
                  backgroundColor: theme.ctaBgColor,
                  color: theme.ctaTextColor,
                }}
              >
                {!isLoading ? <PenLineIcon className="!h-4 !w-4" /> : null}
                Open signing
              </Button>
            )}
          </div>
        </div>

        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          {/* Width capped at max-w-3xl on purpose: without the white-label flag we can't hide Documenso's sidebar via CSS, so staying below its 768px breakpoint makes the embed render sidebar-less. Don't widen or the sidebar reappears. */}
          <SheetContent className="w-[96vw] bg-background px-0 sm:max-w-3xl">
            <SheetHeader className="px-6 pt-6 text-start">
              <SheetTitle>Sign {agreementName}</SheetTitle>
              <SheetDescription>
                Complete the embedded signing flow to continue into the{" "}
                {protectedLinkLabel}.
              </SheetDescription>
            </SheetHeader>

            <div className="h-[calc(100%-96px)] px-4 pb-4 pt-2 sm:px-6">
              {session ? (
                <div className="h-full overflow-hidden rounded-lg border">
                  <EmbedDirectTemplate
                    className="h-full w-full"
                    host={session.host}
                    token={session.token}
                    externalId={session.externalId}
                    darkModeDisabled
                    cssVars={signingEmbedCssVars}
                    css={SIGNING_EMBED_CSS}
                    email={data.email ?? undefined}
                    lockEmail={!!data.email}
                    name={data.name ?? undefined}
                    lockName={!!data.name}
                    onDocumentCompleted={handleDocumentCompleted}
                    onDocumentError={(error) => toast.error(error)}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Preparing signing flow...
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <div className="relative flex items-start space-x-2 pt-5">
      <Checkbox
        id="agreement"
        checked={isChecked}
        onCheckedChange={handleCheckChange}
        className="border border-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--agreement-checked-bg)] data-[state=checked]:bg-[var(--agreement-checked-bg)] data-[state=checked]:text-[var(--agreement-check-color)]"
        style={
          {
            borderColor: theme.controlBorderStrongColor,
            color: theme.backgroundColor || undefined,
            "--agreement-checked-bg": theme.textColor,
            "--agreement-check-color": theme.inverseTextColor,
          } as React.CSSProperties
        }
      />
      <label
        className="text-sm font-normal leading-5 text-white peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        style={{ color: theme.textColor }}
      >
        {isTextContent ? (
          <span
            className="cursor-pointer whitespace-pre-line"
            onClick={toggleAgreement}
          >
            {agreementContent}
          </span>
        ) : (
          <>
            <span className="cursor-pointer" onClick={toggleAgreement}>
              {t("agreement.fallbackPrefix", "I have reviewed and agree to the terms of this")}{" "}
            </span>
            <a
              href={`${agreementContent}`}
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:text-gray-200"
              onClick={(event) => event.stopPropagation()}
              style={{ color: theme.textColor }}
            >
              {agreementName}
            </a>
            <span className="cursor-pointer" onClick={toggleAgreement}>
              .
            </span>
          </>
        )}
      </label>
    </div>
  );
}
