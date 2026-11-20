import { useCallback, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { CircleHelpIcon, FileTextIcon } from "lucide-react";
import { mutate } from "swr";

import {
  AgreementWithLinksCount,
  useAgreements,
} from "@/lib/swr/use-agreements";
import { usePlan } from "@/lib/swr/use-billing";

import AgreementRow from "@/components/agreements/agreement-row";
import AppLayout from "@/components/layouts/app";
import AgreementSheet from "@/components/links/link-sheet/agreement-panel";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BadgeTooltip } from "@/components/ui/tooltip";
import { createUpgradeButton } from "@/components/ui/upgrade-button";

const AgreementsUpgradeButton = createUpgradeButton(
  "Create Agreements",
  PlanEnum.Business,
  "nda_agreements_page",
  { highlightItem: ["nda"] },
);

export default function NdaAgreements() {
  const { agreements, loading, error } = useAgreements();
  const teamInfo = useTeam();
  const { isTrial, isBusiness, isDatarooms, isDataroomsPlus } = usePlan();

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [editingAgreement, setEditingAgreement] =
    useState<AgreementWithLinksCount | null>(null);

  const activeAgreements = useMemo(() => {
    return agreements?.filter((agreement) => !agreement.deletedAt) || [];
  }, [agreements]);

  const displayedAgreements = useMemo(
    () => [...activeAgreements].reverse(),
    [activeAgreements],
  );

  const teamId = teamInfo?.currentTeam?.id;

  const handleAgreementDeletion = useCallback(
    (deletedAgreementId: string) => {
      mutate(
        `/api/teams/${teamId}/agreements`,
        (current?: AgreementWithLinksCount[]) =>
          current?.filter((agreement) => agreement.id !== deletedAgreementId),
        false,
      );
    },
    [teamId],
  );

  const handleAgreementEdit = useCallback(
    (agreement: AgreementWithLinksCount) => {
      setEditingAgreement(agreement);
      setIsOpen(true);
    },
    [],
  );

  const handleSheetOpenChange: React.Dispatch<React.SetStateAction<boolean>> = (
    value,
  ) => {
    setIsOpen((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      if (!next) {
        setEditingAgreement(null);
      }
      return next;
    });
  };

  const handleCreateNew = () => {
    setEditingAgreement(null);
    setIsOpen(true);
  };

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 dark:border-gray-800 sm:flex-row sm:items-center sm:p-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Agreements
                </h2>
                <BadgeTooltip
                  content="How to require NDA agreement before viewing documents?"
                  key="nda-help"
                  linkText="Learn more"
                  link="https://www.papermark.com/help/article/require-nda-to-view"
                >
                  <CircleHelpIcon className="h-4 w-4 text-gray-400" />
                </BadgeTooltip>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage your signed and one-click agreements.
              </p>
            </div>
            {isTrial || isBusiness || isDatarooms || isDataroomsPlus ? (
              <Button
                onClick={handleCreateNew}
                className="bg-gray-900 text-gray-50 hover:bg-gray-900/90"
              >
                Create agreement
              </Button>
            ) : (
              <AgreementsUpgradeButton />
            )}
          </div>

          {loading ? (
            <div className="p-6">
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800"
                  />
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <p className="text-sm text-red-500">Failed to load agreements</p>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
            </div>
          ) : activeAgreements.length !== 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Name
                    </TableHead>
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Links
                    </TableHead>
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Last updated
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedAgreements.map((agreement) => (
                    <AgreementRow
                      key={agreement.id}
                      agreement={agreement}
                      onDelete={handleAgreementDeletion}
                      onEdit={handleAgreementEdit}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                <FileTextIcon className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  No NDA agreements yet
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Create your first NDA agreement to get started.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
      <AgreementSheet
        isOpen={isOpen}
        setIsOpen={handleSheetOpenChange}
        editAgreement={editingAgreement}
      />
    </AppLayout>
  );
}
