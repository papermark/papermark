import { useRouter } from "next/router";

import dynamic from "next/dynamic";

import { useEffect, useRef, useState } from "react";

import { InviteViewersModal } from "@/ee/features/dataroom-invitations/components/invite-viewers-modal";
import {
  CircleHelpIcon,
  FileSpreadsheetIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom, useDataroomLinks } from "@/lib/swr/use-dataroom";

import AppLayout from "@/components/layouts/app";
import { DataroomLinkSheet } from "@/components/links/link-sheet/dataroom-link-sheet";
import LinksTable from "@/components/links/links-table";
import { TabMenu } from "@/components/tab-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BadgeTooltip } from "@/components/ui/tooltip";

const BulkImportLinksModal = dynamic(
  () =>
    import("@/components/links/bulk-import-modal").then((mod) => ({
      default: mod.BulkImportLinksModal,
    })),
  { ssr: false },
);

export default function DataroomLinksPage() {
  const router = useRouter();
  const { dataroom } = useDataroom();
  const { links, loading: linksLoading } = useDataroomLinks();
  const { isDatarooms, isDataroomsPlus, isTrial } = usePlan();
  const { isFeatureEnabled } = useFeatureFlags();
  const canInviteViewers =
    isDataroomsPlus ||
    ((isDatarooms || isTrial) && isFeatureEnabled("dataroomInvitations"));
  const [isLinkSheetOpen, setIsLinkSheetOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

  // First-time experience: when the data room has no links yet, auto-open the
  // link sheet. With no existing links it opens with both panels (link access
  // controls + granular file permissions) side by side; once a link exists it
  // opens showing just the link settings. Guard with a ref so it only opens
  // once per visit and never reopens after the user closes it.
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (
      !didAutoOpenRef.current &&
      !linksLoading &&
      links &&
      links.length === 0
    ) {
      didAutoOpenRef.current = true;
      setIsLinkSheetOpen(true);
    }
  }, [linksLoading, links]);

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              Access links
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
            <Button
              variant="outline"
              onClick={() => setIsInviteModalOpen(true)}
            >
              <SendIcon className="h-4 w-4" />
              Invite via email
            </Button>
            <Button onClick={() => setIsLinkSheetOpen(true)}>
              <PlusIcon className="h-4 w-4" />
              Create link
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="More link actions"
                >
                  <MoreHorizontalIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsBulkImportOpen(true)}>
                  <FileSpreadsheetIcon className="mr-2 h-4 w-4" />
                  Bulk import from CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <TabMenu
          navigation={[
            {
              label: "Access links",
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
          onBulkImportOpen={() => setIsBulkImportOpen(true)}
        />
      </div>

      <DataroomLinkSheet
        isOpen={isLinkSheetOpen}
        setIsOpen={setIsLinkSheetOpen}
        linkType="DATAROOM_LINK"
        existingLinks={links}
        linkTargetId={dataroom.id}
      />

      <BulkImportLinksModal
        isOpen={isBulkImportOpen}
        setIsOpen={setIsBulkImportOpen}
        targetType="DATAROOM"
        targetId={dataroom.id}
      />

      <InviteViewersModal
        open={isInviteModalOpen}
        setOpen={setIsInviteModalOpen}
        dataroomId={dataroom.id}
        dataroomName={dataroom.name}
        canSend={canInviteViewers}
        onSuccess={() => router.push(`/datarooms/${dataroom.id}/participants`)}
      />
    </AppLayout>
  );
}
