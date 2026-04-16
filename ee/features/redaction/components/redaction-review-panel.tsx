"use client";

import { useMemo } from "react";

import { Check, ChevronRight, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { RedactionStatus } from "../lib/schemas/redaction";

type RedactionItem = {
  id: string;
  pageNumber: number;
  detectedText?: string | null;
  category?: string | null;
  source: string;
  status: string;
  confidence?: string | null;
};

type Job = {
  id: string;
  redactions: RedactionItem[];
};

export interface RedactionReviewPanelProps {
  documentId: string;
  job: Job;
  onUpdate: (
    updates: Array<{ id: string; status: RedactionStatus }>,
  ) => void | Promise<void>;
}

const CATEGORY_LABELS: Record<string, string> = {
  PII_NAME: "Name",
  PII_EMAIL: "Email",
  PII_PHONE: "Phone",
  PII_SSN: "SSN / National ID",
  PII_ADDRESS: "Address",
  PII_TAX_ID: "Tax ID",
  PII_ACCOUNT_NUMBER: "Account #",
  CUSTOM_TERM: "Custom term",
  IMAGE: "Image",
  OTHER: "Other",
};

/**
 * Shows every AI- or manually-identified redaction grouped by page, with
 * per-row accept/decline controls. Designed to live inside the redaction
 * dialog's "review" state.
 */
export function RedactionReviewPanel({
  job,
  onUpdate,
}: RedactionReviewPanelProps) {
  const groupedByPage = useMemo(() => {
    const groups = new Map<number, RedactionItem[]>();
    for (const r of job.redactions) {
      const list = groups.get(r.pageNumber) ?? [];
      list.push(r);
      groups.set(r.pageNumber, list);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [job.redactions]);

  const totalPending = job.redactions.filter(
    (r) => r.status === "PENDING",
  ).length;

  const handleBulk = (status: RedactionStatus) => {
    const ids = job.redactions
      .filter((r) => r.status !== status && r.status !== "APPLIED")
      .map((r) => r.id);
    if (ids.length === 0) return;
    void onUpdate(ids.map((id) => ({ id, status })));
  };

  if (job.redactions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Sparkles className="h-5 w-5" />
        <div>No sensitive content was detected.</div>
        <div className="text-xs">
          You can close this dialog or add more custom terms and run detection
          again.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="text-xs text-muted-foreground">
          Review each suggestion. Accepted items will be burned into the PDF
          when you apply redactions.
        </div>
        <div className="ml-auto flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleBulk("ACCEPTED")}
            disabled={totalPending === 0}
          >
            <Check className="mr-1 h-3.5 w-3.5" /> Accept all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleBulk("DECLINED")}
            disabled={totalPending === 0}
          >
            <X className="mr-1 h-3.5 w-3.5" /> Decline all
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[360px] rounded-md border">
        <div className="divide-y">
          {groupedByPage.map(([pageNumber, items]) => (
            <div key={pageNumber} className="px-3 py-2">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ChevronRight className="h-3.5 w-3.5" />
                Page {pageNumber}
                <span className="ml-auto text-muted-foreground/70">
                  {items.length} item{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-2.5 py-1.5 text-sm",
                      item.status === "ACCEPTED" &&
                        "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20",
                      item.status === "DECLINED" &&
                        "border-muted bg-muted/40 text-muted-foreground line-through",
                      item.status === "APPLIED" &&
                        "border-muted bg-muted/30 text-muted-foreground",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {item.category ? (
                        <Badge variant="secondary" className="font-normal">
                          {CATEGORY_LABELS[item.category] ?? item.category}
                        </Badge>
                      ) : null}
                      {item.source === "MANUAL" ? (
                        <Badge variant="outline" className="font-normal">
                          Manual
                        </Badge>
                      ) : null}
                      <span className="truncate" title={item.detectedText ?? undefined}>
                        {item.detectedText || "(image region)"}
                      </span>
                    </div>
                    {item.status === "APPLIED" ? (
                      <span className="text-xs text-muted-foreground">
                        Applied
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant={
                            item.status === "ACCEPTED" ? "default" : "ghost"
                          }
                          className="h-6 w-6"
                          onClick={() =>
                            onUpdate([{ id: item.id, status: "ACCEPTED" }])
                          }
                          aria-label="Accept redaction"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant={
                            item.status === "DECLINED" ? "secondary" : "ghost"
                          }
                          className="h-6 w-6"
                          onClick={() =>
                            onUpdate([{ id: item.id, status: "DECLINED" }])
                          }
                          aria-label="Decline redaction"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
