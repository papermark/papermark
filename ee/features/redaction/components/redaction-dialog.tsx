"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

import { useRedactionRun } from "../hooks/use-redaction-run";
import type { RedactionStatus } from "../lib/schemas/redaction";
import { RedactionReviewPanel } from "./redaction-review-panel";

type DialogMode = "idle" | "detecting" | "review" | "applying" | "complete";

type RedactionItem = {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  detectedText?: string | null;
  category?: string | null;
  source: string;
  status: string;
  confidence?: string | null;
};

type Job = {
  id: string;
  status: string;
  documentVersionId: string;
  triggerRunId: string | null;
  redactions: RedactionItem[];
};

export interface RedactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  /** Called after a redaction job is successfully applied so the parent can refresh. */
  onApplied?: () => void;
}

export function RedactionDialog({
  open,
  onOpenChange,
  documentId,
  onApplied,
}: RedactionDialogProps) {
  const [customTermInput, setCustomTermInput] = useState("");
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [mode, setMode] = useState<DialogMode>("idle");
  const [job, setJob] = useState<Job | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setCustomTermInput("");
    setCustomTerms([]);
    setJob(null);
    setRunId(null);
    setMode("idle");
    setFatalError(null);
  }, []);

  // Poll the run for progress updates.
  const runStatus = useRedactionRun({
    runId: mode === "detecting" || mode === "applying" ? runId : null,
    pollInterval: 1500,
  });

  // Refresh the job record + its redactions from the server.
  const refreshJob = useCallback(
    async (jobId: string) => {
      const res = await fetch(`/api/redactions/${documentId}/${jobId}`);
      if (!res.ok) return null;
      const { job } = (await res.json()) as { job: Job };
      setJob(job);
      return job;
    },
    [documentId],
  );

  // When detection finishes, move the dialog into review mode and load items.
  useEffect(() => {
    if (mode !== "detecting") return;
    if (runStatus.isFailed) {
      setFatalError(runStatus.error || "AI detection failed");
      setMode("idle");
      return;
    }
    if (runStatus.isCompleted && job) {
      void refreshJob(job.id).then(() => setMode("review"));
    }
  }, [
    mode,
    runStatus.isCompleted,
    runStatus.isFailed,
    runStatus.error,
    job,
    refreshJob,
  ]);

  // Similar handling for the apply phase.
  useEffect(() => {
    if (mode !== "applying") return;
    if (runStatus.isFailed) {
      setFatalError(runStatus.error || "Failed to apply redactions");
      setMode("review");
      return;
    }
    if (runStatus.isCompleted && job) {
      void refreshJob(job.id);
      setMode("complete");
      onApplied?.();
    }
  }, [
    mode,
    runStatus.isCompleted,
    runStatus.isFailed,
    runStatus.error,
    job,
    refreshJob,
    onApplied,
  ]);

  const handleAddTerm = useCallback(() => {
    const trimmed = customTermInput.trim();
    if (!trimmed) return;
    if (customTerms.includes(trimmed)) {
      setCustomTermInput("");
      return;
    }
    setCustomTerms((list) => [...list, trimmed]);
    setCustomTermInput("");
  }, [customTermInput, customTerms]);

  const handleRemoveTerm = useCallback((term: string) => {
    setCustomTerms((list) => list.filter((t) => t !== term));
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setFatalError(null);
    try {
      const res = await fetch(`/api/redactions/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTerms }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start redaction");
      }
      setJob(data.job as Job);
      setRunId(data.job.triggerRunId ?? null);
      setMode("detecting");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
      setFatalError(message);
    } finally {
      setStarting(false);
    }
  }, [customTerms, documentId]);

  const handleUpdateItems = useCallback(
    async (updates: Array<{ id: string; status: RedactionStatus }>) => {
      if (!job) return;
      const res = await fetch(
        `/api/redactions/${documentId}/${job.id}/items`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        },
      );
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        toast.error(error || "Failed to update redactions");
        return;
      }
      // Optimistically merge into state.
      setJob((prev) =>
        prev
          ? {
              ...prev,
              redactions: prev.redactions.map((r) => {
                const u = updates.find((x) => x.id === r.id);
                return u ? { ...r, status: u.status } : r;
              }),
            }
          : prev,
      );
    },
    [job, documentId],
  );

  const handleApply = useCallback(async () => {
    if (!job) return;
    setApplying(true);
    setFatalError(null);
    try {
      const res = await fetch(
        `/api/redactions/${documentId}/${job.id}/apply`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to apply redactions");
      }
      setRunId(data.runId as string);
      setMode("applying");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
      setFatalError(message);
    } finally {
      setApplying(false);
    }
  }, [job, documentId]);

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next && (mode === "detecting" || mode === "applying")) {
        // Don't allow closing while work is in flight -- but we'll let the
        // user manually force close via the X on the dialog footer.
        return;
      }
      if (!next) {
        resetState();
      }
      onOpenChange(next);
    },
    [mode, onOpenChange, resetState],
  );

  const pendingCount = useMemo(
    () => job?.redactions.filter((r) => r.status === "PENDING").length ?? 0,
    [job?.redactions],
  );
  const acceptedCount = useMemo(
    () => job?.redactions.filter((r) => r.status === "ACCEPTED").length ?? 0,
    [job?.redactions],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          "max-w-2xl",
          mode === "review" && "max-w-3xl",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Redact document
          </DialogTitle>
          <DialogDescription>
            Automatically detect and redact personally identifiable information
            (PII) and custom terms. Review every suggestion before it is
            applied.
          </DialogDescription>
        </DialogHeader>

        {fatalError ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
            <div className="flex-1">
              <div className="font-medium text-destructive">
                Something went wrong
              </div>
              <div className="text-muted-foreground">{fatalError}</div>
            </div>
          </div>
        ) : null}

        {mode === "idle" ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="redaction-custom-term">
                Custom terms (optional)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="redaction-custom-term"
                  placeholder="e.g. Acme Corp, Project Phoenix"
                  value={customTermInput}
                  onChange={(e) => setCustomTermInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTerm();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddTerm}
                  disabled={!customTermInput.trim()}
                >
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                In addition to automatically detected PII, any exact matches of
                these terms will be suggested for redaction.
              </p>
              {customTerms.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {customTerms.map((term) => (
                    <Badge
                      key={term}
                      variant="secondary"
                      className="gap-1 pl-2.5"
                    >
                      {term}
                      <button
                        type="button"
                        onClick={() => handleRemoveTerm(term)}
                        className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                        aria-label={`Remove ${term}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "detecting" ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-sm">
                  {runStatus.step || "Scanning document..."}
                </span>
                <Progress value={runStatus.progress} className="h-1.5" />
              </div>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {runStatus.progress}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                Pages: {runStatus.pagesProcessed} / {runStatus.totalPages || "-"}
              </div>
              <div>Suggestions so far: {runStatus.redactionsFound}</div>
            </div>
          </div>
        ) : null}

        {mode === "review" && job ? (
          <div className="py-1">
            <RedactionReviewPanel
              documentId={documentId}
              job={job}
              onUpdate={handleUpdateItems}
            />
          </div>
        ) : null}

        {mode === "applying" ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-sm">
                  {runStatus.step || "Burning redactions into PDF..."}
                </span>
                <Progress value={runStatus.progress} className="h-1.5" />
              </div>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {runStatus.progress}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              The redacted PDF is being saved as a new document version. Your
              original file stays intact so you can always revert.
            </p>
          </div>
        ) : null}

        {mode === "complete" ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-3 rounded-md bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <div className="flex-1 text-emerald-900 dark:text-emerald-200">
                Redactions applied. The document has been replaced with the
                redacted version.
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          {mode === "idle" ? (
            <>
              <Button
                variant="ghost"
                onClick={() => handleClose(false)}
                disabled={starting}
              >
                Cancel
              </Button>
              <Button onClick={handleStart} disabled={starting}>
                {starting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Detect with AI
                  </>
                )}
              </Button>
            </>
          ) : null}

          {mode === "review" ? (
            <>
              <div className="mr-auto text-xs text-muted-foreground">
                {pendingCount} pending · {acceptedCount} accepted
              </div>
              <Button
                variant="ghost"
                onClick={() => handleClose(false)}
                disabled={applying}
              >
                Close
              </Button>
              <Button
                onClick={handleApply}
                disabled={applying || acceptedCount === 0}
              >
                {applying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>Apply {acceptedCount} redaction{acceptedCount === 1 ? "" : "s"}</>
                )}
              </Button>
            </>
          ) : null}

          {mode === "complete" ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
