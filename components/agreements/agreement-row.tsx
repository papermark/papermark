import { memo, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  ChevronDownIcon,
  DownloadIcon,
  FileSignatureIcon,
  FileTextIcon,
  Link2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  ServerIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildTeamSignedAgreementDownloadUrl,
  downloadSignedAgreement,
} from "@/lib/signing/download";
import {
  AgreementResponseSummary,
  useAgreementResponses,
} from "@/lib/swr/use-agreement-responses";
import { AgreementWithLinksCount } from "@/lib/swr/use-agreements";
import { cn, timeAgo } from "@/lib/utils";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { TimestampTooltip } from "@/components/ui/timestamp-tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AgreementRowProps {
  agreement: AgreementWithLinksCount;
  onDelete: (id: string) => void;
  onEdit: (agreement: AgreementWithLinksCount) => void;
}

function AgreementRow({ agreement, onDelete, onEdit }: AgreementRowProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const isSigningAgreement =
    agreement.signingProvider === "DOCUMENSO" ||
    agreement.contentType === "SIGNING";
  const hasSignedResponses = (agreement._count?.responses ?? 0) > 0;
  const disableEdit = isSigningAgreement && hasSignedResponses;
  const disabledEditReason =
    "Signing agreements cannot be edited after signatures have been collected";

  const {
    responses,
    loading: responsesLoading,
    error: responsesError,
  } = useAgreementResponses(
    isExpanded && isSigningAgreement ? agreement.id : null,
  );

  const handleDelete = async () => {
    if (!teamId) return;
    toast.promise(
      fetch(`/api/teams/${teamId}/agreements/${agreement.id}`, {
        method: "PUT",
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to delete agreement");
        }
        onDelete(agreement.id);
      }),
      {
        loading: "Deleting agreement...",
        success: "Agreement deleted successfully",
        error: "Failed to delete agreement",
      },
    );
  };

  const handleDownload = async () => {
    if (!teamId) return;
    toast.promise(
      fetch(`/api/teams/${teamId}/agreements/${agreement.id}/download`, {
        method: "POST",
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to download agreement");
        }

        const contentDisposition = response.headers.get("Content-Disposition");
        const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/);
        const filename = filenameMatch
          ? filenameMatch[1]
          : `${agreement.name}.txt`;

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(link);
        }, 100);
      }),
      {
        loading: "Downloading agreement...",
        success: "Agreement downloaded successfully",
        error: "Failed to download agreement",
      },
    );
  };

  const handleDownloadResponse = async (response: AgreementResponseSummary) => {
    if (!teamId) return;

    const url = buildTeamSignedAgreementDownloadUrl({
      teamId,
      agreementId: agreement.id,
      responseId: response.id,
    });

    const safeName = agreement.name
      .replace(/[^a-z0-9\-_]/gi, "_")
      .toLowerCase()
      .substring(0, 50);

    await toast.promise(
      downloadSignedAgreement({
        url,
        fallbackFilename: `${safeName || "agreement"}_signed.pdf`,
      }),
      {
        loading: "Preparing signed NDA...",
        success: "Signed NDA downloaded",
        error: (error: unknown) =>
          error instanceof Error
            ? error.message
            : "Failed to download the signed NDA.",
      },
    );
  };

  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell>
          <div className="flex items-center gap-2">
            {isSigningAgreement ? (
              <FileSignatureIcon className="h-4 w-4 text-gray-400" />
            ) : (
              <FileTextIcon className="h-4 w-4 text-gray-400" />
            )}
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {agreement.name}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-sm text-gray-700 dark:text-gray-300">
          {agreement._count?.links || 0}{" "}
          {agreement._count?.links === 1 ? "link" : "links"}
        </TableCell>
        <TableCell className="text-sm text-gray-700 dark:text-gray-300">
          {new Date(agreement.updatedAt).toLocaleDateString()}
        </TableCell>
        <TableCell
          className="text-right"
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Open agreement actions"
              >
                <MoreHorizontalIcon className="!h-4 !w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuItem
                      aria-disabled={disableEdit}
                      className={cn(
                        disableEdit &&
                          "cursor-not-allowed opacity-50 focus:bg-transparent focus:text-muted-foreground",
                      )}
                      onSelect={(event) => {
                        if (disableEdit) {
                          event.preventDefault();
                          return;
                        }

                        onEdit(agreement);
                      }}
                    >
                      <PencilIcon className="mr-2 h-4 w-4" />
                      Edit agreement
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  {disableEdit ? (
                    <TooltipPortal>
                      <TooltipContent
                        side="left"
                        sideOffset={8}
                        className="max-w-64 text-center text-xs"
                      >
                        {disabledEditReason}
                      </TooltipContent>
                    </TooltipPortal>
                  ) : null}
                </Tooltip>
              </TooltipProvider>
              {isSigningAgreement ? (
                <DropdownMenuItem
                  onClick={() => setIsExpanded((prev) => !prev)}
                >
                  <FileSignatureIcon className="mr-2 h-4 w-4" />
                  {isExpanded ? "Hide signed NDAs" : "Show signed NDAs"}
                </DropdownMenuItem>
              ) : null}
              {!isSigningAgreement ? (
                <DropdownMenuItem onClick={handleDownload}>
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Download agreement
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                onClick={() => setShowDeleteDialog(true)}
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                Delete agreement
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      {isExpanded && isSigningAgreement ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="bg-muted/20 p-0">
            <div className="px-4 py-3">
              <AgreementResponsesSection
                loading={responsesLoading}
                error={!!responsesError}
                responses={responses}
                onDownload={handleDownloadResponse}
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the agreement &quot;
              {agreement.name}&quot;. This action cannot be undone.
              <br />
              <br />
              <span className="font-medium">
                Note: If this agreement is still referenced in any documents or
                dataroom links, it will remain available there until those
                references are removed.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default memo(AgreementRow);

function AgreementResponsesSection({
  loading,
  error,
  responses,
  onDownload,
}: {
  loading: boolean;
  error: boolean;
  responses: AgreementResponseSummary[];
  onDownload: (response: AgreementResponseSummary) => void | Promise<void>;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-2 text-sm text-destructive">
        Failed to load signed NDAs. Try again later.
      </p>
    );
  }

  if (responses.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No signed NDAs yet. Once a visitor completes the embedded signing flow,
        their signed copy will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      <li className="flex items-center gap-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">Signer</span>
        <span className="hidden flex-1 md:block">Source</span>
        <span className="hidden w-24 md:block">Signed</span>
        <span className="w-10" />
      </li>
      {responses.map((response) => {
        const signedAt =
          response.signedAt || response.completedAt || response.createdAt;
        const signerLabel =
          response.view?.viewerName ||
          response.view?.viewerEmail ||
          response.signerName ||
          response.signerEmail ||
          "Signed before opening link";
        const signerSubLabel =
          response.view?.viewerName && response.view?.viewerEmail
            ? response.view.viewerEmail
            : !response.view && response.signerName && response.signerEmail
              ? response.signerEmail
              : null;
        const linkSourceId =
          response.view?.link?.id ||
          response.view?.linkId ||
          response.link?.id ||
          response.linkId ||
          null;
        const linkSourceName =
          response.view?.link?.name || response.link?.name || null;
        const linkLabel =
          linkSourceName ||
          (linkSourceId ? `Link #${linkSourceId.slice(-5)}` : "Unknown link");
        const documentLabel = response.view?.document?.name;
        const dataroomLabel = response.view?.dataroom?.name;
        const isOrphanResponse = !response.view;

        return (
          <li
            key={response.id}
            className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-3"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <FileSignatureIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {signerLabel}
                </p>
                {signerSubLabel ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {signerSubLabel}
                  </p>
                ) : isOrphanResponse ? (
                  <p className="truncate text-xs text-muted-foreground">
                    Signed but did not continue into the link
                  </p>
                ) : null}
              </div>
            </div>

            <div className="min-w-0 flex-1 text-xs text-muted-foreground md:text-sm">
              <div className="flex items-center gap-1 truncate">
                <Link2Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{linkLabel}</span>
              </div>
              {dataroomLabel ? (
                <div className="mt-0.5 flex items-center gap-1 truncate">
                  <ServerIcon className="h-3.5 w-3.5 shrink-0 text-[#fb7a00]" />
                  <span className="truncate">{dataroomLabel}</span>
                </div>
              ) : documentLabel ? (
                <div className="mt-0.5 flex items-center gap-1 truncate">
                  <FileTextIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{documentLabel}</span>
                </div>
              ) : null}
            </div>

            <div className="text-xs text-muted-foreground md:w-24">
              {signedAt ? (
                <TimestampTooltip
                  timestamp={new Date(signedAt)}
                  rows={["local", "utc", "unix"]}
                >
                  <time
                    className="select-none"
                    dateTime={new Date(signedAt).toISOString()}
                  >
                    {timeAgo(new Date(signedAt))}
                  </time>
                </TimestampTooltip>
              ) : (
                "—"
              )}
            </div>

            <div className="flex justify-end md:w-10">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDownload(response)}
                title="Download signed NDA"
              >
                <DownloadIcon className="h-4 w-4" />
                <span className="sr-only">Download signed NDA</span>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
