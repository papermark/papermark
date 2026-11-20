import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { Domain } from "@prisma/client";
import { CircleHelpIcon, GlobeIcon } from "lucide-react";
import { mutate } from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { useDomains } from "@/lib/swr/use-domains";

import { AddDomainModal } from "@/components/domains/add-domain-modal";
import DomainRow from "@/components/domains/domain-row";
import AppLayout from "@/components/layouts/app";
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

export default function Domains() {
  const { domains } = useDomains({ enabled: true });
  const teamInfo = useTeam();
  const { isBusiness, isDatarooms } = usePlan();

  const [open, setOpen] = useState<boolean>(false);
  const [newlyAddedDomain, setNewlyAddedDomain] = useState<string | null>(null);

  const handleDomainDeletion = (deletedDomain: string) => {
    mutate(
      `/api/teams/${teamInfo?.currentTeam?.id}/domains`,
      domains?.filter((domain) => domain.slug !== deletedDomain),
      false,
    );
  };

  const handleDomainAddition = (newDomain: Domain) => {
    setNewlyAddedDomain(newDomain?.slug ?? null);
    mutate(
      `/api/teams/${teamInfo?.currentTeam?.id}/domains`,
      [...(domains || []), newDomain],
      false,
    );
  };

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 sm:flex-row sm:items-center sm:p-6 dark:border-gray-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Domains
                </h2>
                <BadgeTooltip
                  content="How to connect a custom domain to your link?"
                  key="verified"
                  linkText="Click here"
                  link="https://www.papermark.com/help/article/how-to-add-custom-domain-to-link"
                >
                  <CircleHelpIcon className="h-4 w-4 text-gray-400" />
                </BadgeTooltip>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage your custom domain for sharing documents and data rooms.
              </p>
            </div>
            <AddDomainModal
              open={open}
              setOpen={setOpen}
              onAddition={handleDomainAddition}
            >
              <Button className="bg-gray-900 text-gray-50 hover:bg-gray-900/90">
                Add Domain
              </Button>
            </AddDomainModal>
          </div>

          {domains && domains.length !== 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Domain
                    </TableHead>
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Status
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => (
                    <DomainRow
                      key={domain.slug}
                      domain={domain.slug}
                      isDefault={domain.isDefault}
                      redirectUrl={domain.redirectUrl}
                      redirectsAllowed={isBusiness || isDatarooms}
                      defaultOpen={domain.slug === newlyAddedDomain}
                      onDelete={handleDomainDeletion}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800">
                <GlobeIcon className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  No custom domains yet
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Add a custom domain to share your documents and data rooms on
                  your own branded URL.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
