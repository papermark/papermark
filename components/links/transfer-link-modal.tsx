import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useRouter } from "next/router";

import { useTeam } from "@/context/team-context";
import { FileTextIcon, ServerIcon, SnowflakeIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import useSWR from "swr";

import { useAnalytics } from "@/lib/analytics";
import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";
import { LinkWithViews } from "@/lib/types";
import { fetcher } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SingleSelect } from "@/components/ui/single-select";

type TransferTargetType = "DOCUMENT" | "DATAROOM";

type DocumentOption = { id: string; name: string };

// Case-insensitive, digit-aware ordering so names like "File 2" sort before
// "File 10" and casing doesn't split the list into two alphabetical runs.
const byName: Intl.CollatorOptions = { sensitivity: "base", numeric: true };

function TransferLinkModal({
  showTransferLinkModal,
  setShowTransferLinkModal,
  link,
  targetType,
}: {
  showTransferLinkModal: boolean;
  setShowTransferLinkModal: Dispatch<SetStateAction<boolean>>;
  link: LinkWithViews | null;
  targetType: "DOCUMENT" | "DATAROOM";
}) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const analytics = useAnalytics();

  const [destinationType, setDestinationType] =
    useState<TransferTargetType>(targetType);
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [transferring, setTransferring] = useState<boolean>(false);

  const currentTargetId = link?.documentId ?? link?.dataroomId ?? "";

  useEffect(() => {
    if (showTransferLinkModal) {
      setDestinationType(targetType);
      setSelectedTarget("");
    }
  }, [showTransferLinkModal, targetType, link?.id]);

  // Documents are fetched on demand (only while the modal is open and the
  // document destination is selected) to keep the picker scoped to documents
  // the current team/member can access.
  const { data: documentsData, isLoading: documentsLoading } = useSWR<{
    documents: DocumentOption[];
  }>(
    showTransferLinkModal && destinationType === "DOCUMENT" && teamId
      ? `/api/teams/${teamId}/documents?sort=name&limit=1000`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );

  const { datarooms, loading: dataroomsLoading } = useDataroomsSimple();

  const documentOptions = useMemo(() => {
    const docs = documentsData?.documents ?? [];
    return docs
      .map((doc) => ({
        label: doc.name,
        value: doc.id,
        searchableText: doc.name,
        meta: { isCurrent: doc.id === currentTargetId },
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, byName));
  }, [documentsData, currentTargetId]);

  const dataroomOptions = useMemo(() => {
    return (datarooms ?? [])
      .map((room) => ({
        label: room.name,
        value: room.id,
        searchableText: room.name,
        meta: {
          isFrozen: room.isFrozen,
          isCurrent: room.id === currentTargetId,
        },
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, byName));
  }, [datarooms, currentTargetId]);

  const isDocumentDestination = destinationType === "DOCUMENT";
  const options = isDocumentDestination ? documentOptions : dataroomOptions;
  const optionsLoading = isDocumentDestination
    ? documentsLoading
    : dataroomsLoading;

  const isNoop =
    destinationType === targetType && selectedTarget === currentTargetId;

  const canSubmit = !!selectedTarget && !isNoop && !transferring;

  const handleDestinationTypeChange = (type: TransferTargetType) => {
    setDestinationType(type);
    setSelectedTarget("");
  };

  async function transferLink() {
    if (!link || !teamId || !selectedTarget) return;

    setTransferring(true);
    try {
      const response = await fetch(`/api/links/${link.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          targetType: destinationType,
          targetId: selectedTarget,
        }),
      });

      if (!response.ok) {
        const { error } = await response.json().catch(() => ({
          error: "Failed to transfer link",
        }));
        throw new Error(error || "Failed to transfer link");
      }

      analytics.capture("Link Transferred", {
        teamId,
        linkId: link.id,
        fromType: targetType,
        toType: destinationType,
        fromTargetId: currentTargetId,
        toTargetId: selectedTarget,
      });

      // The transfer has committed server-side, so the modal should close on
      // success regardless of whether the cache refresh below succeeds.
      setShowTransferLinkModal(false);

      // Best-effort cache revalidation: drop the link from the current
      // target's lists (and any group-scoped list) and prime the destination's
      // list. A failed revalidation must not surface as a transfer failure.
      const fromEndpoint = `${targetType.toLowerCase()}s`;
      const toEndpoint = `${destinationType.toLowerCase()}s`;
      const revalidationKeys = [
        `/api/teams/${teamId}/${fromEndpoint}/${encodeURIComponent(
          currentTargetId,
        )}/links`,
        `/api/teams/${teamId}/${toEndpoint}/${encodeURIComponent(
          selectedTarget,
        )}/links`,
      ];
      if (link.groupId) {
        revalidationKeys.push(
          `/api/teams/${teamId}/${fromEndpoint}/${encodeURIComponent(
            currentTargetId,
          )}/groups/${link.groupId}/links`,
        );
      }
      await Promise.allSettled(revalidationKeys.map((key) => mutate(key)));
    } finally {
      setTransferring(false);
    }
  }

  if (!link) return null;

  const linkName = link.name || `Link #${link.id.slice(-5)}`;
  const viewCount = link._count?.views ?? 0;

  return (
    <Dialog open={showTransferLinkModal} onOpenChange={setShowTransferLinkModal}>
      <DialogContent className="max-w-[90vw] sm:max-w-[480px]">
        <DialogHeader className="text-start">
          <DialogTitle>Transfer link</DialogTitle>
          <DialogDescription>
            Move{" "}
            <span className="font-medium text-foreground">{linkName}</span> to a
            different document or data room. The link URL stays the same.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={isDocumentDestination ? "default" : "outline"}
              className="justify-center gap-2"
              onClick={() => handleDestinationTypeChange("DOCUMENT")}
            >
              <FileTextIcon className="h-4 w-4" />
              Document
            </Button>
            <Button
              type="button"
              variant={!isDocumentDestination ? "default" : "outline"}
              className="justify-center gap-2"
              onClick={() => handleDestinationTypeChange("DATAROOM")}
            >
              <ServerIcon className="h-4 w-4" />
              Data room
            </Button>
          </div>

          <SingleSelect
            options={options}
            value={selectedTarget}
            onValueChange={setSelectedTarget}
            loading={optionsLoading}
            placeholder={
              isDocumentDestination
                ? "Select a document"
                : "Select a data room"
            }
            searchPlaceholder={
              isDocumentDestination
                ? "Search documents..."
                : "Search data rooms..."
            }
            triggerIcon={
              isDocumentDestination ? (
                <FileTextIcon className="!size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ServerIcon className="!size-4 shrink-0 text-muted-foreground" />
              )
            }
            emptyText={
              isDocumentDestination
                ? "No documents found."
                : "No data rooms found."
            }
            renderOption={(option) => (
              <span className="flex w-full items-center gap-1.5">
                {option.meta?.isFrozen ? (
                  <SnowflakeIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                ) : null}
                <span className="truncate">
                  {option.label}
                  {option.meta?.isCurrent ? " (current)" : ""}
                  {option.meta?.isFrozen ? " (frozen)" : ""}
                </span>
              </span>
            )}
          />

          {isNoop ? (
            <p className="text-xs text-destructive">
              The link already points to this {targetType.toLowerCase()}.
            </p>
          ) : null}

          <div className="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>
              The link&apos;s existing{" "}
              <strong>
                {viewCount} view{viewCount !== 1 ? "s" : ""}
              </strong>{" "}
              stay attached to the previous{" "}
              {targetType === "DATAROOM" ? "data room" : "document"} for
              historical analytics. Going forward, visitors will see the new
              target.
            </p>
            <p className="mt-2">
              Data room settings don&apos;t carry over: visitor groups, file
              permissions, and upload folders will be cleared.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={async () => {
              const destination = destinationType;
              const destinationId = selectedTarget;
              try {
                await transferLink();
                const targetPath =
                  destination === "DATAROOM"
                    ? `/datarooms/${destinationId}`
                    : `/documents/${destinationId}`;
                toast.success("Link transferred successfully!", {
                  action: {
                    label: "Open",
                    onClick: () => router.push(targetPath),
                  },
                });
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to transfer",
                );
              }
            }}
            loading={transferring}
            disabled={!canSubmit}
            className="w-full"
          >
            Transfer link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useTransferLinkModal({
  link,
  targetType,
}: {
  link: LinkWithViews | null;
  targetType: "DOCUMENT" | "DATAROOM";
}) {
  const [showTransferLinkModal, setShowTransferLinkModal] = useState(false);

  const TransferLinkModalCallback = useCallback(() => {
    return (
      <TransferLinkModal
        showTransferLinkModal={showTransferLinkModal}
        setShowTransferLinkModal={setShowTransferLinkModal}
        link={link}
        targetType={targetType}
      />
    );
  }, [showTransferLinkModal, link, targetType]);

  return useMemo(
    () => ({
      setShowTransferLinkModal,
      TransferLinkModal: TransferLinkModalCallback,
    }),
    [setShowTransferLinkModal, TransferLinkModalCallback],
  );
}
