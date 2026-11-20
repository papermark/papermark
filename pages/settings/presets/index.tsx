import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { LinkPreset } from "@prisma/client";
import { format } from "date-fns";
import { CircleHelpIcon, SettingsIcon } from "lucide-react";
import useSWR from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { fetcher } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 sm:flex-row sm:items-center sm:p-6 dark:border-gray-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Link Presets
                </h2>
                <BadgeTooltip content="Create reusable link configurations that can be applied to new links">
                  <CircleHelpIcon className="h-4 w-4 text-gray-400" />
                </BadgeTooltip>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Configure and save presets for your links.
              </p>
            </div>
            {isTrial || isBusiness || isDatarooms || isDataroomsPlus ? (
              <Button
                onClick={() => router.push("/settings/presets/new")}
                className="shrink-0 whitespace-nowrap bg-gray-900 text-gray-50 hover:bg-gray-900/90"
              >
                Create Preset
              </Button>
            ) : (
              <Button
                onClick={() => setShowUpgradeModal(true)}
                className="shrink-0 whitespace-nowrap bg-gray-900 text-gray-50 hover:bg-gray-900/90"
              >
                Upgrade
              </Button>
            )}
          </div>

          {/* Presets List */}
          {isLoading ? (
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
          ) : !presets || presets.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                <SettingsIcon className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  No presets configured
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Create link presets to quickly apply your preferred settings
                  when creating links.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Name
                    </TableHead>
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {presets.map((preset) => (
                    <TableRow
                      key={preset.id}
                      className="cursor-pointer"
                      onClick={() =>
                        router.push(`/settings/presets/${preset.id}`)
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <SettingsIcon className="h-4 w-4 text-gray-400" />
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {preset.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                        {format(new Date(preset.createdAt), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
