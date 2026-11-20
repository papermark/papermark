import { useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { CrownIcon, ListOrderedIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ResponsiveButton } from "@/components/ui/responsive-button";

interface RebuildIndexButtonProps {
  /** Team id from context; may be undefined briefly while layout loads. */
  teamId?: string;
  dataroomId?: string;
  disabled?: boolean;
}

export default function RebuildIndexButton({
  teamId,
  dataroomId,
  disabled = false,
}: RebuildIndexButtonProps) {
  const { isFeatureEnabled } = useFeatureFlags();
  const { isDatarooms, isDataroomsPlus, isTrial } = usePlan();
  const [loadingAction, setLoadingAction] = useState<
    "rebuild" | "clear" | null
  >(null);
  const [isOpen, setIsOpen] = useState(false);

  const isDataroomIndexEnabled = isFeatureEnabled("dataroomIndex");
  const hasDataroomsPlan = isDatarooms || isDataroomsPlus || isTrial;
  const hasDataroomsPlusPlan = isDataroomsPlus;

  // Show button if: feature flag is enabled OR user has datarooms plan or higher
  const shouldShowButton = isDataroomIndexEnabled || hasDataroomsPlan;

  // Allow usage if: feature flag is enabled OR user has datarooms-plus plan
  const canUseFeature = isDataroomIndexEnabled || hasDataroomsPlusPlan;

  // Don't render if conditions aren't met
  if (!shouldShowButton) {
    return null;
  }

  const handleIndexAction = async (action: "rebuild" | "clear") => {
    if (!canUseFeature) {
      toast.error("Upgrade to Data Rooms Plus plan to use this feature.");
      return;
    }

    if (!teamId || !dataroomId) {
      toast.error("Missing team or data room. Refresh the page and try again.");
      return;
    }

    const isClear = action === "clear";

    try {
      setLoadingAction(action);

      const response = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/calculate-indexes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action }),
        },
      );

      if (!response.ok) {
        const raw = await response.text();
        let message = isClear
          ? "Failed to remove index"
          : "Failed to rebuild indexes";
        try {
          const parsed = JSON.parse(raw) as { message?: string };
          if (typeof parsed.message === "string") message = parsed.message;
        } catch {
          if (raw) message = raw;
        }
        throw new Error(message);
      }

      const result = await response.json();

      toast.success(
        isClear
          ? `Hierarchical index removed successfully! Cleared ${result.totalUpdated} items (${result.foldersUpdated} folders, ${result.documentsUpdated} documents).`
          : `Hierarchical indexes rebuilt successfully! Updated ${result.totalUpdated} items (${result.foldersUpdated} folders, ${result.documentsUpdated} documents).`,
      );

      setIsOpen(false);

      // Trigger a page refresh to show updated indexes
      window.location.reload();
    } catch (error) {
      console.error(
        isClear ? "Error removing index:" : "Error rebuilding indexes:",
        error,
      );
      toast.error(
        error instanceof Error
          ? error.message
          : isClear
            ? "Failed to remove index"
            : "Failed to rebuild indexes",
      );
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <ResponsiveButton
          icon={<ListOrderedIcon className="h-4 w-4" />}
          text="Rebuild Index"
          variant="outline"
          size="sm"
          disabled={disabled || !teamId || !dataroomId}
        />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            Rebuild Hierarchical Index
          </DialogTitle>
          <DialogDescription>
            Recalculate the hierarchical numbering based on the dataroom
            items&apos; current order.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="rounded-lg bg-muted p-4">
            <div className="flex items-start gap-3">
              <div className="text-sm text-muted-foreground">
                <p className="mb-1 font-medium">What this does:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    Analyzes the current folder structure and document order
                  </li>
                  <li>
                    Assigns hierarchical numbers (1, 1.1, 1.1.1, 2, 2.1, etc.)
                  </li>
                  <li>
                    Updates the display to show these numbers alongside names
                  </li>
                  <li>Maintains the existing order and hierarchy</li>
                </ul>
                <p className="mt-3">
                  Prefer plain names? Use{" "}
                  <span className="font-medium">Remove Index</span> to clear the
                  hierarchical numbering from all folders and documents.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {canUseFeature ? (
            <>
              <Button
                variant="ghost"
                className="whitespace-nowrap text-destructive hover:text-destructive"
                onClick={() => handleIndexAction("clear")}
                loading={loadingAction === "clear"}
                disabled={loadingAction !== null}
              >
                <Trash2Icon className="h-4 w-4" />
                Remove Index
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsOpen(false)}
                  disabled={loadingAction !== null}
                >
                  Cancel
                </Button>
                <Button
                  className="whitespace-nowrap"
                  onClick={() => handleIndexAction("rebuild")}
                  loading={loadingAction === "rebuild"}
                  disabled={loadingAction !== null}
                >
                  <ListOrderedIcon className="h-4 w-4" />
                  Rebuild Index
                </Button>
              </div>
            </>
          ) : (
            <UpgradePlanModal
              clickedPlan={PlanEnum.DataRoomsPlus}
              trigger="datarooms_rebuild_index_button"
              highlightItem={["indexing"]}
            >
              <Button className="gap-1.5">
                <CrownIcon className="h-4 w-4" />
                Upgrade to rebuild index
              </Button>
            </UpgradePlanModal>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
