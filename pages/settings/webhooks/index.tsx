import Link from "next/link";
import { useRouter } from "next/router";

import { useMemo } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { format } from "date-fns";
import { CircleHelpIcon, CrownIcon, WebhookIcon } from "lucide-react";
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

interface Webhook {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

export default function WebhookSettings() {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { isFree, isPro, isTrial } = usePlan();
  const showUpgrade = (isFree || isPro) && !isTrial;

  const {
    data: webhooks,
    isLoading,
    error,
  } = useSWR<Webhook[]>(
    teamId ? `/api/teams/${teamId}/webhooks` : null,
    fetcher,
  );

  const hasWebhooks = useMemo(() => (webhooks?.length ?? 0) > 0, [webhooks]);

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        {
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 sm:flex-row sm:items-center sm:p-6 dark:border-gray-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Webhooks
                  </h2>
                  {showUpgrade ? (
                    <UpgradePlanModal
                      clickedPlan={PlanEnum.Business}
                      trigger="create_webhook"
                      highlightItem={["webhooks"]}
                    >
                      <span className="cursor-pointer">
                        <CrownIcon className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </span>
                    </UpgradePlanModal>
                  ) : (
                    <BadgeTooltip
                      content="Send data to external services when events happen in Papermark"
                      className="max-w-80 text-left leading-5 text-gray-600"
                    >
                      <CircleHelpIcon className="h-4 w-4 text-gray-400" />
                    </BadgeTooltip>
                  )}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Send data to external services when events happen in
                  Papermark.
                </p>
              </div>
              <Link href="/settings/webhooks/new">
                <Button className="bg-gray-900 text-gray-50 hover:bg-gray-900/90">
                  Create Webhook
                </Button>
              </Link>
            </div>

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
            ) : error ? (
              <ErrorState />
            ) : !hasWebhooks ? (
              <EmptyState />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        Name
                      </TableHead>
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        URL
                      </TableHead>
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        Created
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks?.map((webhook) => (
                      <TableRow
                        key={webhook.id}
                        className="cursor-pointer"
                        onClick={() =>
                          router.push(`/settings/webhooks/${webhook.id}`)
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <WebhookIcon className="h-4 w-4 text-gray-400" />
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {webhook.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                          {webhook.url}
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                          {format(new Date(webhook.createdAt), "MMM d, yyyy")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        }
      </main>
    </AppLayout>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 dark:border-red-900 dark:bg-red-950">
        <WebhookIcon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Failed to load webhooks
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Something went wrong while loading your webhooks. Please refresh the
          page or try again later.
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        <WebhookIcon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          No webhooks configured
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Webhooks allow you to receive HTTP requests whenever specific events
          occur in your account.
        </p>
      </div>
    </div>
  );
}
