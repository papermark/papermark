import { useCallback, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  AlertTriangleIcon,
  DownloadIcon,
  Loader2Icon,
  MailIcon,
  SnowflakeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useFreezeProgress } from "@/ee/features/dataroom-freeze/lib/swr/use-freeze-progress";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { TimestampTooltip } from "@/components/ui/timestamp-tooltip";

const CONFIRMATION_TEXT = "confirm freeze dataroom";

interface FreezeSettingsProps {
  dataroomId: string;
  isFrozen: boolean;
  frozenAt: string | Date | null;
  frozenByUser: { name: string | null; email: string | null } | null;
  freezeArchiveUrl: string | null;
  freezeArchiveHash: string | null;
}

type DialogStep = "confirm-text" | "otp-sent" | "freezing";

export default function FreezeSettings({
  dataroomId,
  isFrozen,
  frozenAt,
  frozenByUser,
  freezeArchiveUrl,
  freezeArchiveHash,
}: FreezeSettingsProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<DialogStep>("confirm-text");
  const [confirmText, setConfirmText] = useState("");
  const [otpValue, setOtpValue] = useState("");
  const [isSendingToken, setIsSendingToken] = useState(false);
  const [isFreezing, setIsFreezing] = useState(false);
  const [publicAccessToken, setPublicAccessToken] = useState<string>();

  const otpInputRef = useRef<HTMLInputElement>(null);

  const [isDownloading, setIsDownloading] = useState(false);

  const {
    isArchiveInProgress: isArchiveGenerating,
    progress,
    progressText,
    archiveReady: realtimeArchiveReady,
    failedRun,
    completedRun,
  } = useFreezeProgress({
    dataroomId,
    isFrozen,
    frozenAt,
    freezeArchiveUrl,
    initialToken: publicAccessToken,
  });

  const hasArchive = !!freezeArchiveUrl || realtimeArchiveReady;

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
          {isArchiveGenerating && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {progressText || "Generating freeze archive..."}
              </p>
              <Progress value={progress} />
            </div>
          )}

          {failedRun && !completedRun && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <AlertTriangleIcon className="h-4 w-4 text-destructive" />
              <p className="text-sm text-destructive">
                Archive generation failed. Please try again.
              </p>
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
                    window.open(url, "_blank");
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
              <p className="text-sm font-medium">
                Archive Integrity (SHA-256)
              </p>
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
    <Card className="border-destructive/50 bg-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SnowflakeIcon className="h-5 w-5" />
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
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetDialog();
          }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <SnowflakeIcon className="h-4 w-4" />
              Freeze Data Room
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Freeze this data room?</DialogTitle>
              <DialogDescription>
                This will permanently close the data room, archive all links,
                and revoke all viewer access. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {step === "confirm-text" && (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="confirm-freeze">
                    Type <span className="font-mono font-bold">{CONFIRMATION_TEXT}</span> to
                    continue
                  </Label>
                  <Input
                    id="confirm-freeze"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={CONFIRMATION_TEXT}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleSendToken}
                    disabled={!isConfirmTextValid || isSendingToken}
                    className="gap-2"
                  >
                    {isSendingToken ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <MailIcon className="h-4 w-4" />
                    )}
                    {isSendingToken
                      ? "Sending code..."
                      : "Send verification code"}
                  </Button>
                </DialogFooter>
              </div>
            )}

            {step === "otp-sent" && (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>
                    Enter the 6-digit code sent to your email
                  </Label>
                  <div className="flex justify-center">
                    <InputOTP
                      ref={otpInputRef}
                      maxLength={6}
                      value={otpValue}
                      onChange={setOtpValue}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }, (_, i) => (
                          <InputOTPSlot
                            key={i}
                            index={i}
                            className="h-12 w-12 text-lg font-semibold"
                            style={{
                              color: "hsl(var(--foreground))",
                              borderColor: "hsl(var(--border))",
                              caretColor: "hsl(var(--foreground))",
                            }}
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
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
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleFreeze}
                    disabled={otpValue.length !== 6 || isFreezing}
                    className="gap-2"
                  >
                    {isFreezing ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <SnowflakeIcon className="h-4 w-4" />
                    )}
                    {isFreezing
                      ? "Freezing..."
                      : "Confirm & freeze data room"}
                  </Button>
                </DialogFooter>
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
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
