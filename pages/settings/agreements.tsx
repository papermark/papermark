import { useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { CircleHelpIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { mutate } from "swr";

import { useAgreements } from "@/lib/swr/use-agreements";
import { usePlan } from "@/lib/swr/use-billing";

import AgreementCard from "@/components/agreements/agreement-card";
import AppLayout from "@/components/layouts/app";
import AgreementSheet from "@/components/links/link-sheet/agreement-panel";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Button } from "@/components/ui/button";
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

  const activeAgreements = useMemo(() => {
    return agreements?.filter((agreement) => !agreement.deletedAt) || [];
  }, [agreements]);

  const handleAgreementDeletion = (deletedAgreementId: string) => {
    mutate(
      `/api/teams/${teamInfo?.currentTeam?.id}/agreements`,
      agreements?.filter((agreement) => agreement.id !== deletedAgreementId),
      false,
    );
  };

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />
        <div>
          <div className="mb-4 flex items-center justify-between md:mb-8 lg:mb-12">
            <div className="space-y-1">
              <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                Agreements
              </h3>
              <p className="flx-row flex items-center gap-2 text-sm text-muted-foreground">
                Manage your one-click agreements for document sharing and data
                rooms.
                <BadgeTooltip
                  content="How to require NDA agreement before viewing documents?"
                  key="nda-help"
                  linkText="Learn more"
                  link="https://www.papermark.com/help/article/require-nda-to-view"
                >
                  <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
                </BadgeTooltip>
              </p>
            </div>
            <ul className="flex items-center justify-between gap-4">
              {isTrial || isBusiness || isDatarooms || isDataroomsPlus ? (
                <Button variant="outline" onClick={() => setIsOpen(true)}>
                  <FileTextIcon className="h-4 w-4" />
                  Create agreement
                </Button>
              ) : (
                <AgreementsUpgradeButton />
              )}
            </ul>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner" />
              <span className="ml-2 text-sm text-gray-500">
                Loading agreements...
              </span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12">
              <p className="text-center text-sm text-red-500">
                Failed to load agreements
              </p>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
            </div>
          ) : activeAgreements.length !== 0 ? (
            <div>
              <ul>
                {[...activeAgreements].reverse().map((agreement) => (
                  <li key={agreement.id} className="mt-4">
                    <AgreementCard
                      agreement={agreement}
                      onDelete={handleAgreementDeletion}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-4 py-12">
              <div className="rounded-full bg-gray-100 p-3">
                <PlusIcon className="h-6 w-6 text-gray-600" />
              </div>
              <div className="text-center">
                <h3 className="font-medium">No NDA agreements yet</h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  Create your first NDA agreement to get started
                </p>
              </div>
              {(isTrial || isBusiness || isDatarooms || isDataroomsPlus) && (
                <Button variant="outline" onClick={() => setIsOpen(true)}>
                  <FileTextIcon className="h-4 w-4" />
                  Create NDA agreement
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
      <AgreementSheet isOpen={isOpen} setIsOpen={setIsOpen} />
    </AppLayout>
  );
}
