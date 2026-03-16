import { useCallback, useState } from "react";

import { useTeam } from "@/context/team-context";
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  LockIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface FreezeSettingsProps {
  dataroomId: string;
  isFrozen: boolean;
  frozenAt: string | Date | null;
  frozenByUser: { name: string | null; email: string | null } | null;
  freezeArchiveUrl: string | null;
  freezeArchiveHash: string | null;
}

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
  const [isFreezing, setIsFreezing] = useState(false);
  const [publicAccessToken, setPublicAccessToken] = useState<string>();
  const [verifyResult, setVerifyResult] = useState<
    "idle" | "verifying" | "match" | "mismatch"
  >("idle");

  const tag = `freeze:${dataroomId}`;
  const { runs } = useRealtimeRunsWithTag(tag, {
    enabled: !!publicAccessToken,
    accessToken: publicAccessToken,
  });

  const activeRun = runs.find((r) =>
    ["QUEUED", "EXECUTING"].includes(r.status),
  );
  const completedRun = runs.find((r) => r.status === "COMPLETED");
  const failedRun = runs.find((r) =>
    ["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE"].includes(r.status),
  );

  let progress = 0;
  let progressText = "";
  if (activeRun?.metadata) {
    const meta = activeRun.metadata as Record<string, unknown>;
    progress = ((meta.progress as number) ?? 0) * 100;
    progressText = (meta.text as string) ?? "";
  }

  const realtimeDownloadUrl = completedRun?.metadata
    ? (completedRun.metadata as Record<string, unknown>).downloadUrl as string
    : null;

  const downloadUrl = freezeArchiveUrl || realtimeDownloadUrl;
  const isArchiveGenerating = !!activeRun && !completedRun;

  const handleFreeze = useCallback(async () => {
    if (!teamId || isFreezing) return;
    setIsFreezing(true);

    try {
      const res = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/freeze`,
        { method: "POST" },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || "Failed to freeze");
      }

      const { publicAccessToken: token } = await res.json();
      setPublicAccessToken(token);

      await mutate(`/api/teams/${teamId}/datarooms/${dataroomId}`);
      toast.success("Data room frozen. Archive is being generated...");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to freeze data room",
      );
    } finally {
      setIsFreezing(false);
    }
  }, [teamId, dataroomId, isFreezing]);

  const handleVerifyIntegrity = useCallback(async () => {
    if (!freezeArchiveHash || !downloadUrl) return;

    setVerifyResult("verifying");
    try {
      const response = await fetch(downloadUrl);
      const buffer = await response.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      setVerifyResult(hashHex === freezeArchiveHash ? "match" : "mismatch");
    } catch {
      toast.error("Failed to verify archive integrity");
      setVerifyResult("idle");
    }
  }, [freezeArchiveHash, downloadUrl]);

  if (isFrozen || isArchiveGenerating) {
    return (
      <Card className="bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LockIcon className="h-5 w-5" />
            Data Room Frozen
          </CardTitle>
          <CardDescription>
            {frozenAt && (
              <>
                Frozen on{" "}
                {new Date(frozenAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
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

          {downloadUrl && (
            <div className="space-y-3">
              <a href={downloadUrl} download>
                <Button className="w-full gap-2">
                  <DownloadIcon className="h-4 w-4" />
                  Download Freeze Archive
                </Button>
              </a>

              <p className="text-xs text-muted-foreground">
                Contains documents.zip, audit-log.csv, qa-pairs.csv, and
                MANIFEST.sha256
              </p>
            </div>
          )}

          {freezeArchiveHash && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Archive Integrity (SHA-256)</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleVerifyIntegrity}
                  disabled={verifyResult === "verifying" || !downloadUrl}
                >
                  <ShieldCheckIcon className="h-3.5 w-3.5" />
                  {verifyResult === "verifying"
                    ? "Verifying..."
                    : "Verify integrity"}
                </Button>
              </div>
              <code className="block break-all rounded-md bg-muted p-2 text-xs font-mono">
                {freezeArchiveHash}
              </code>
              {verifyResult === "match" && (
                <div className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle2Icon className="h-4 w-4" />
                  Archive integrity verified
                </div>
              )}
              {verifyResult === "mismatch" && (
                <div className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertTriangleIcon className="h-4 w-4" />
                  Hash mismatch - archive may have been tampered with
                </div>
              )}
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
          <LockIcon className="h-5 w-5" />
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
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <LockIcon className="h-4 w-4" />
              Freeze Data Room
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Freeze this data room?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently close the data room, archive all links,
                and revoke all viewer access. A downloadable archive will be
                generated with all documents, audit logs, and Q&A data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleFreeze}
                disabled={isFreezing}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isFreezing ? "Freezing..." : "Yes, freeze data room"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}
