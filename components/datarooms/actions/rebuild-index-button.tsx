import { useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { CrownIcon, ListOrderedIcon } from "lucide-react";
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
  teamId: string;
  dataroomId: string;
  disabled?: boolean;
}

export default function RebuildIndexButton({
  teamId,
  dataroomId,
  disabled = false,
}: RebuildIndexButtonProps) {
  const { isFeatureEnabled } = useFeatureFlags();
  const { isDatarooms, isDataroomsPlus, isTrial } = usePlan();
  const [isLoading, setIsLoading] = useState(false);
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

  const handleRebuildIndex = async () => {
    if (!canUseFeature) {
      toast.error("Upgrade to Data Rooms Plus plan to use this feature.");
      return;
    }

    try {
      setIsLoading(true);

      const response = await fetch(
        `/api/teams/${teamId}/datarooms/${dataroomId}/calculate-indexes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to rebuild indexes");
      }

      const result = await response.json();

      toast.success(
        `Hierarchical indexes rebuilt successfully! Updated ${result.totalUpdated} items (${result.foldersUpdated} folders, ${result.documentsUpdated} documents).`,
      );

      setIsOpen(false);

      // Trigger a page refresh to show updated indexes
      window.location.reload();
    } catch (error) {
      console.error("Error rebuilding indexes:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to rebuild indexes",
      );
    } finally {
      setIsLoading(false);
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
          disabled={disabled}
        />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
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
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          {canUseFeature ? (
            <>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleRebuildIndex} loading={isLoading}>
                <ListOrderedIcon className="h-4 w-4" />
                Rebuild Index
              </Button>
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
