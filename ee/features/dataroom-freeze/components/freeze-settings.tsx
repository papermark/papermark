import { useCallback, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { useFreezeProgress } from "@/ee/features/dataroom-freeze/lib/swr/use-freeze-progress";
import { PlanEnum } from "@/ee/stripe/constants";
import {
  AlertTriangleIcon,
  CrownIcon,
  DownloadIcon,
  Loader2Icon,
  MailIcon,
  RefreshCwIcon,
  SnowflakeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { usePlan } from "@/lib/swr/use-billing";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { TimestampTooltip } from "@/components/ui/timestamp-tooltip";

const CONFIRMATION_TEXT = "confirm freeze dataroom";

interface FreezeSettingsProps {
  dataroomId: string;
  dataroomName: string;
  isFrozen: boolean;
  frozenAt: string | Date | null;
  frozenByUser: { name: string | null; email: string | null } | null;
  freezeArchiveUrl: string | null;
  freezeArchiveHash: string | null;
}

type DialogStep = "confirm-text" | "otp-sent" | "freezing";

export default function FreezeSettings({
  dataroomId,
  dataroomName,
  isFrozen,
  frozenAt,
  frozenByUser,
  freezeArchiveUrl,
  freezeArchiveHash,
}: FreezeSettingsProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { isDataroomsPlus } = usePlan();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<DialogStep>("confirm-text");
  const [confirmText, setConfirmText] = useState("");
  const [otpValue, setOtpValue] = useState("");
  const [isSendingToken, setIsSendingToken] = useState(false);
  const [isFreezing, setIsFreezing] = useState(false);
  const [publicAccessToken, setPublicAccessToken] = useState<string>();

  const otpInputRef = useRef<HTMLInputElement>(null);

  const [isDownloading, setIsDownloading] = useState(false);

  const [isRetrying, setIsRetrying] = useState(false);

  const {
    isArchiveInProgress: isArchiveGenerating,
    progress,
    progressText,
    archiveReady: realtimeArchiveReady,
    failedRun,
    completedRun,
    noRunsFound,
    isFailed,
  } = useFreezeProgress({
    dataroomId,
    isFrozen,
    frozenAt,
    freezeArchiveUrl,
    initialToken: publicAccessToken,
  });

  const hasArchive = !!freezeArchiveUrl || realtimeArchiveReady;
  const showRecovery = (noRunsFound || isFailed) && !hasArchive;

  const handleRetryArchive = useCallback(async () => {
    if (!teamId || isRetrying) return;
    setIsRetrying(true);
    try {
      const res = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/freeze/retry-archive`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error || data.message || "Failed to retry archive",
        );
      }
      const { publicAccessToken: token } = await res.json();
      setPublicAccessToken(token);
      toast.success("Archive generation restarted");
      await mutate(`/api/teams/${teamId}/datarooms/${dataroomId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to retry archive",
      );
    } finally {
      setIsRetrying(false);
    }
  }, [teamId, dataroomId, isRetrying]);

  const isConfirmTextValid =
    confirmText.trim().toLowerCase() === CONFIRMATION_TEXT;

  const resetDialog = useCallback(() => {
    setStep("confirm-text");
    setConfirmText("");
    setOtpValue("");
    setIsSendingToken(false);
    setIsFreezing(false);
  }, []);

  const handleSendToken = useCallback(async () => {
    if (!teamId || !isConfirmTextValid) return;
    setIsSendingToken(true);

    try {
      const res = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/freeze/send-token`,
        { method: "POST" },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error || data.message || "Failed to send verification code",
        );
      }

      setStep("otp-sent");
      toast.success("Verification code sent to your email");
      setTimeout(() => otpInputRef.current?.focus(), 100);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send verification code",
      );
    } finally {
      setIsSendingToken(false);
    }
  }, [teamId, dataroomId, isConfirmTextValid]);

  const handleFreeze = useCallback(async () => {
    if (!teamId || isFreezing || otpValue.length !== 6) return;
    setIsFreezing(true);
    setStep("freezing");

    try {
      const res = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/freeze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: otpValue }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || "Failed to freeze");
      }

      const { publicAccessToken: token } = await res.json();
      setPublicAccessToken(token);
      setDialogOpen(false);
      resetDialog();

      await mutate(`/api/teams/${teamId}/datarooms/${dataroomId}`);
      toast.success("Data room frozen. Archive is being generated...");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to freeze data room",
      );
      setStep("otp-sent");
      setOtpValue("");
    } finally {
      setIsFreezing(false);
    }
  }, [teamId, dataroomId, isFreezing, otpValue, resetDialog]);

  if (isFrozen || isArchiveGenerating) {
    return (
      <Card className="bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SnowflakeIcon className="h-5 w-5" />
            Data Room Frozen
          </CardTitle>
          <CardDescription>
            {frozenAt && (
              <>
                Frozen{" "}
                <TimestampTooltip
                  timestamp={frozenAt}
                  rows={["local", "utc", "unix"]}
                  title="Frozen at"
                >
                  <span className="cursor-default underline decoration-dotted underline-offset-2">
                    {new Date(frozenAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                      timeZoneName: "short",
                    })}
                  </span>
                </TimestampTooltip>
                {frozenByUser?.name || frozenByUser?.email
                  ? ` by ${frozenByUser.name || frozenByUser.email}`
                  : ""}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isArchiveGenerating && !showRecovery && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {progressText || "Generating freeze archive..."}
              </p>
              <Progress value={progress} />
            </div>
          )}

          {showRecovery && (
            <div className="space-y-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangleIcon className="h-4 w-4 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">
                  {noRunsFound
                    ? "Archive generation did not start. This may be a temporary issue."
                    : "Archive generation failed."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={isRetrying}
                  onClick={handleRetryArchive}
                >
                  {isRetrying ? (
                    <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="h-3.5 w-3.5" />
                  )}
                  {isRetrying ? "Retrying..." : "Retry archive generation"}
                </Button>
                <a
                  href="mailto:support@papermark.io?subject=Freeze%20archive%20failed"
                  className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Contact support
                </a>
              </div>
            </div>
          )}

          {hasArchive && (
            <div className="space-y-3">
              <Button
                className="w-full gap-2"
                disabled={isDownloading}
                onClick={async () => {
                  if (!teamId) return;
                  setIsDownloading(true);
                  try {
                    const res = await fetch(
                      `/api/teams/${teamId}/datarooms/${dataroomId}/freeze/download`,
                    );
                    if (!res.ok) throw new Error("Failed to get download URL");
                    const { url } = await res.json();
                    window.location.assign(url);
                  } catch {
                    toast.error("Failed to download archive");
                  } finally {
                    setIsDownloading(false);
                  }
                }}
              >
                {isDownloading ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  <DownloadIcon className="h-4 w-4" />
                )}
                Download Freeze Archive
              </Button>

              <p className="text-xs text-muted-foreground">
                Contains documents.zip, audit-log.csv, qa-pairs.csv, and
                MANIFEST.sha256
              </p>
            </div>
          )}

          {freezeArchiveHash && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Archive Integrity (SHA-256)</p>
              <code className="block break-all rounded-md bg-muted p-2 font-mono text-xs">
                {freezeArchiveHash}
              </code>
              <p className="text-xs text-muted-foreground">
                Verify locally after download:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  {typeof navigator !== "undefined" &&
                  /windows/i.test(navigator.userAgent)
                    ? "certutil -hashfile <file> SHA256"
                    : "shasum -a 256 <file>"}
                </code>
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-6">
          <p className="text-sm text-muted-foreground">
            All viewer access has been revoked and links have been archived.
          </p>
        </CardFooter>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-destructive/50 bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SnowflakeIcon className="h-5 w-5 text-destructive" />
            Freeze Data Room
          </CardTitle>
          <CardDescription>
            Permanently close this data room from all viewer access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              This action cannot be undone.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>- All viewer access will be permanently revoked</li>
              <li>- All existing links will be archived</li>
              <li>
                - A downloadable archive will be generated containing all
                documents, audit logs, and Q&A data
              </li>
            </ul>
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-6">
          <p className="text-sm text-muted-foreground">
            Freezing creates a tamper-proof archive with SHA-256 integrity
            verification.
          </p>
          {isDataroomsPlus ? (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => setDialogOpen(true)}
            >
              <SnowflakeIcon className="h-4 w-4" />
              Freeze Data Room
            </Button>
          ) : (
            <UpgradePlanModal
              clickedPlan={PlanEnum.DataRoomsPlus}
              trigger="datarooms_freeze_button"
            >
              <Button className="gap-2">
                <CrownIcon className="h-4 w-4" />
                Upgrade to freeze
              </Button>
            </UpgradePlanModal>
          )}
        </CardFooter>
      </Card>

      <Modal
        showModal={dialogOpen}
        setShowModal={setDialogOpen}
        onClose={resetDialog}
      >
        <div className="flex flex-col items-center justify-center space-y-3 border-b border-border bg-white px-4 py-4 pt-8 dark:border-gray-900 dark:bg-gray-900 sm:px-8">
          <CardTitle>Freeze Data Room</CardTitle>
          <CardDescription className="text-md font-semibold text-foreground">
            {dataroomName}
          </CardDescription>
          <CardDescription className="text-center">
            {step === "otp-sent"
              ? "Enter the 6-digit verification code we sent to your email to confirm freezing."
              : "Warning: This will permanently close the data room, archive all links, and revoke all viewer access."}
          </CardDescription>
        </div>

        <div className="bg-muted px-4 py-8 dark:bg-gray-900 sm:px-8">
          {step === "confirm-text" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (isConfirmTextValid && !isSendingToken) {
                  handleSendToken();
                }
              }}
              className="flex flex-col space-y-6 text-left"
            >
              <div>
                <label
                  htmlFor="confirm-freeze"
                  className="block text-sm text-muted-foreground"
                >
                  To verify, type{" "}
                  <span className="font-semibold text-foreground">
                    {CONFIRMATION_TEXT}
                  </span>{" "}
                  below
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <Input
                    id="confirm-freeze"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    data-1p-ignore
                    className="bg-white dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent"
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="destructive"
                disabled={!isConfirmTextValid || isSendingToken}
                loading={isSendingToken}
                className="gap-2"
              >
                {!isSendingToken && <MailIcon className="h-4 w-4" />}
                {isSendingToken ? "Sending code..." : "Send verification code"}
              </Button>
            </form>
          )}

          {step === "otp-sent" && (
            <div className="flex flex-col space-y-6 text-left">
              <div>
                <label className="block text-center text-sm text-muted-foreground">
                  Enter the 6-digit code
                </label>
                <div className="mt-3 flex justify-center">
                  <InputOTP
                    ref={otpInputRef}
                    maxLength={6}
                    value={otpValue}
                    onChange={setOtpValue}
                    accentColor="#e5e5e5"
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }, (_, i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          className="h-12 w-12 bg-white text-lg font-semibold dark:bg-gray-800"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Didn&apos;t receive the code?{" "}
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                    onClick={() => {
                      setStep("confirm-text");
                      setOtpValue("");
                    }}
                  >
                    Resend
                  </button>
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={handleFreeze}
                disabled={otpValue.length !== 6 || isFreezing}
                loading={isFreezing}
                className="gap-2"
              >
                {!isFreezing && <SnowflakeIcon className="h-4 w-4" />}
                {isFreezing ? "Freezing..." : "Confirm freeze dataroom"}
              </Button>
            </div>
          )}

          {step === "freezing" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2Icon className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Freezing data room...
              </p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
