import Link from "next/link";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { CircleHelpIcon, CrownIcon, WebhookIcon } from "lucide-react";
import useSWR from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { fetcher } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Button } from "@/components/ui/button";
import { BadgeTooltip } from "@/components/ui/tooltip";

interface Webhook {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

export default function WebhookSettings() {
  const teamInfo = useTeam();
  const { isFree, isPro, isTrial } = usePlan();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: webhooks } = useSWR<Webhook[]>(
    teamId ? `/api/teams/${teamId}/webhooks` : null,
    fetcher,
  );

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />
        <div>
          <div className="mb-4 flex items-center justify-between md:mb-8 lg:mb-12">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
                Webhooks{" "}
                {(isFree || isPro) && !isTrial ? (
                  <UpgradePlanModal
                    clickedPlan={PlanEnum.Business}
                    trigger="create_webhook"
                    highlightItem={["webhooks"]}
                  >
                    <span className="cursor-pointer">
                      <CrownIcon className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </span>
                  </UpgradePlanModal>
                ) : null}
              </h3>
              <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
                Send data to external services when events happen in Papermark
                <BadgeTooltip content="Send data to external services when events happen in Papermark">
                  <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
                </BadgeTooltip>
              </p>
            </div>
            <Link href="/settings/webhooks/new">
              <Button>Create Webhook</Button>
            </Link>
          </div>

          {/* Webhooks List */}
          {!webhooks || webhooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12">
              <div className="rounded-full bg-gray-100 p-3">
                <WebhookIcon className="h-6 w-6 text-gray-600" />
              </div>
              <div className="text-center">
                <h3 className="font-medium">No webhooks configured</h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  Webhooks allow you to receive HTTP requests whenever specific
                  events occur in your account.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {webhooks.map((webhook) => (
                <Link
                  key={webhook.id}
                  href={`/settings/webhooks/${webhook.id}`}
                  className="rounded-xl border border-gray-200 bg-white p-4 transition-[filter] dark:border-gray-400 dark:bg-secondary sm:p-5"
                >
                  <div className="flex items-center gap-x-3">
                    {/* <div className="rounded-md border border-gray-200 bg-gradient-to-t from-gray-100 p-2.5">
                      <Avatar className="size-6">
                        <AvatarFallback>
                          {webhook.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div> */}
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">{webhook.name}</span>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        {webhook.url}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppLayout>
  );
}