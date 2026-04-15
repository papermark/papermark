import Link from "next/link";

import { useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { CircleHelpIcon, UsersIcon } from "lucide-react";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { AddGroupModal } from "@/components/datarooms/groups/add-group-modal";
import GroupCard from "@/components/datarooms/groups/group-card";
import { GroupCardPlaceholder } from "@/components/datarooms/groups/group-card-placeholder";
import AppLayout from "@/components/layouts/app";
import { TabMenu } from "@/components/tab-menu";
import { Button } from "@/components/ui/button";
import { BadgeTooltip } from "@/components/ui/tooltip";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";
import useDataroomGroups from "@/lib/swr/use-dataroom-groups";
import { cn } from "@/lib/utils";

export default function DataroomGroupPage() {
  const { isDatarooms, isDataroomsPlus, isTrial } = usePlan();
  const { dataroom } = useDataroom();
  const { viewerGroups, loading } = useDataroomGroups();

  const [modalOpen, setModalOpen] = useState<boolean>(false);

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  const ButtonComponent = () => {
    if (isDatarooms || isDataroomsPlus || isTrial) {
      return <Button onClick={() => setModalOpen(true)}>Create group</Button>;
    }
    return (
      <UpgradePlanModal
        clickedPlan={PlanEnum.DataRooms}
        trigger="create_group_button"
      >
        <Button>Upgrade to create group</Button>
      </UpgradePlanModal>
    );
  };

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-1">
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              Groups
            </h3>
            <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
              Control access with granular permissions.
              <BadgeTooltip
                linkText="Learn more"
                content="Manage Access with Granular Permissions for Data Room Groups"
                key="groups"
                link="https://www.papermark.com/help/article/granular-permissions"
              >
                <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
              </BadgeTooltip>
            </p>
          </div>
          <ButtonComponent />
        </div>

        <TabMenu
          navigation={[
            {
              label: "Links",
              href: `/datarooms/${dataroom.id}/permissions`,
              value: "links",
              currentValue: "groups",
            },
            {
              label: "Groups",
              href: `/datarooms/${dataroom.id}/groups`,
              value: "groups",
              currentValue: "groups",
            },
          ]}
          className="md:hidden"
        />

        <div className="space-y-4">
          <div className="grid gap-5">
            <div className="animate-fade-in">
              {!loading ? (
                viewerGroups && viewerGroups.length > 0 ? (
                  <ul className="grid grid-cols-1 gap-3">
                    {viewerGroups.map((group) => (
                      <li key={group.id}>
                        <Link
                          href={`/datarooms/${dataroom.id}/groups/${group.id}`}
                        >
                          <GroupCard group={group} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-200 py-10">
                    <div className="hidden rounded-full border border-gray-200 sm:block">
                      <div
                        className={cn(
                          "rounded-full border border-white bg-gradient-to-t from-gray-100 p-1 md:p-3",
                        )}
                      >
                        <UsersIcon className="size-6" />
                      </div>
                    </div>
                    <p>No groups found for this dataroom</p>
                    <ButtonComponent />
                  </div>
                )
              ) : (
                <ul className="grid grid-cols-1 gap-3">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <li key={idx}>
                      <GroupCardPlaceholder />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <AddGroupModal
            dataroomId={dataroom.id}
            open={modalOpen}
            setOpen={setModalOpen}
          />
        </div>
      </div>
    </AppLayout>
  );
}
