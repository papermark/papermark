import Link from "next/link";
import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { LinkPreset } from "@prisma/client";
import { format } from "date-fns";
import { CircleHelpIcon, CrownIcon, PlusIcon } from "lucide-react";
import useSWR from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { fetcher, formatExpirationTime } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function Presets() {
  const router = useRouter();
  const teamInfo = useTeam();

  const { isBusiness, isDatarooms, isDataroomsPlus, isTrial } = usePlan();

  const {
    data: presets,
    error,
    isLoading,
  } = useSWR<LinkPreset[]>(
    teamInfo?.currentTeam?.id
      ? `/api/teams/${teamInfo.currentTeam.id}/presets`
      : null,
    fetcher,
  );

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />
        <div>
          <div className="mb-4 flex items-center justify-between gap-x-2 md:mb-8 lg:mb-12">
            <div className="min-w-0 space-y-1">
              <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Link Presets
              </h3>
              <p className="flex flex-row items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                Configure and save presets for your links
                <BadgeTooltip content="Create reusable link configurations that can be applied to new links">
                  <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
                </BadgeTooltip>
              </p>
            </div>
            {isTrial || isBusiness || isDatarooms || isDataroomsPlus ? (
              <Button onClick={() => router.push("/settings/presets/new")} className="shrink-0 whitespace-nowrap">
                <PlusIcon className="mr-1.5 h-4 w-4" />
                Create Preset
              </Button>
            ) : (
              <Button onClick={() => setShowUpgradeModal(true)} className="shrink-0 whitespace-nowrap text-xs sm:text-sm">
                <CrownIcon className="mr-1.5 h-4 w-4" />
                Upgrade
              </Button>
            )}
          </div>

          {/* Presets List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">Loading presets...</p>
            </div>
          ) : !presets || presets.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12">
              <div className="rounded-full bg-gray-100 p-3">
                <PlusIcon className="h-6 w-6 text-gray-600" />
              </div>
              <div className="text-center">
                <h3 className="font-medium">No presets configured</h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  Create link presets to quickly apply your preferred settings
                  when creating links.
                </p>
              </div>
              {isTrial || isBusiness || isDatarooms || isDataroomsPlus ? (
                <Button
                  variant="outline"
                  onClick={() => router.push("/settings/presets/new")}
                >
                  Create your first preset
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowUpgradeModal(true)}
                >
                  Upgrade to create presets
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {presets.map((preset) => (
                <Link
                  key={preset.id}
                  href={`/settings/presets/${preset.id}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 transition-[filter] hover:bg-gray-50 dark:border-gray-400 dark:bg-secondary dark:hover:bg-gray-800 sm:p-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{preset.name}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <span>
                            Created:{" "}
                            {format(new Date(preset.createdAt), "MMM d, yyyy")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <UpgradePlanModal
        clickedPlan={PlanEnum.Business}
        trigger="presets_page"
        open={showUpgradeModal}
        setOpen={setShowUpgradeModal}
      />
    </AppLayout>
  );
}
