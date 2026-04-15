import { useState } from "react";

import { InviteViewersModal } from "@/ee/features/dataroom-invitations/components/invite-viewers-modal";
import { CircleHelpIcon, PlusIcon, SendIcon } from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom, useDataroomLinks } from "@/lib/swr/use-dataroom";

import AppLayout from "@/components/layouts/app";
import { DataroomLinkSheet } from "@/components/links/link-sheet/dataroom-link-sheet";
import LinksTable from "@/components/links/links-table";
import { TabMenu } from "@/components/tab-menu";
import { Button } from "@/components/ui/button";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function DataroomLinksPage() {
  const { dataroom } = useDataroom();
  const { links } = useDataroomLinks();
  const { isDataroomsPlus, isTrial } = usePlan();
  const canInviteViewers = isDataroomsPlus || isTrial;
  const [isLinkSheetOpen, setIsLinkSheetOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              Links
            </h3>
            <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
              Share your data room with access controls.
              <BadgeTooltip
                linkText="Learn more"
                content="Configure access controls for data room links."
                key="links"
                link="https://www.papermark.com/help/category/links"
              >
                <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
              </BadgeTooltip>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!canInviteViewers && (
              <Button
                variant="outline"
                onClick={() => setIsInviteModalOpen(true)}
              >
                <SendIcon className="h-4 w-4" />
                Invite via email
              </Button>
            )}
            <Button onClick={() => setIsLinkSheetOpen(true)}>
              <PlusIcon className="h-4 w-4" />
              Create link
            </Button>
          </div>
        </div>

        <TabMenu
          navigation={[
            {
              label: "Links",
              href: `/datarooms/${dataroom.id}/permissions`,
              value: "links",
              currentValue: "links",
            },
            {
              label: "Groups",
              href: `/datarooms/${dataroom.id}/groups`,
              value: "groups",
              currentValue: "links",
            },
          ]}
          className="md:hidden"
        />

        <LinksTable
          links={links}
          targetType={"DATAROOM"}
          dataroomName={dataroom.name}
        />
      </div>

      <DataroomLinkSheet
        isOpen={isLinkSheetOpen}
        setIsOpen={setIsLinkSheetOpen}
        linkType="DATAROOM_LINK"
        existingLinks={links}
      />

      {!canInviteViewers && (
        <InviteViewersModal
          open={isInviteModalOpen}
          setOpen={setIsInviteModalOpen}
          dataroomId={dataroom.id}
          dataroomName={dataroom.name}
          canSend={false}
        />
      )}
    </AppLayout>
  );
}
