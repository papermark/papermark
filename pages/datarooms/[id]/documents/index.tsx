import { useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  ArrowUpDownIcon,
  CircleHelpIcon,
  FolderPlusIcon,
  PlusIcon,
} from "lucide-react";

import { useDataroom, useDataroomItems } from "@/lib/swr/use-dataroom";

import DownloadDataroomButton from "@/components/datarooms/actions/download-dataroom";
import GenerateIndexButton from "@/components/datarooms/actions/generate-index-button";
import RebuildIndexButton from "@/components/datarooms/actions/rebuild-index-button";
import { DataroomItemsList } from "@/components/datarooms/dataroom-items-list";
import { SidebarFolderTree } from "@/components/datarooms/folders";
import { DataroomSortableList } from "@/components/datarooms/sortable/sortable-list";
import { AddDocumentModal } from "@/components/documents/add-document-modal";
import { LoadingDocuments } from "@/components/documents/loading-document";
import { AddFolderModal } from "@/components/folders/add-folder-modal";
import AppLayout from "@/components/layouts/app";
import { Button } from "@/components/ui/button";
import { ResponsiveButton } from "@/components/ui/responsive-button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function Documents() {
  const { dataroom } = useDataroom();
  const { items, folderCount, documentCount, isLoading } = useDataroomItems({
    root: true,
  });
  const teamInfo = useTeam();

  const [isReordering, setIsReordering] = useState<boolean>(false);

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-4 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Documents
          </h3>
          <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            Manage files and folders in your data room.
            <BadgeTooltip
              linkText="Learn more"
              content="Learn how to add and organize documents."
              key="documents"
              link="https://www.papermark.com/help/article/create-data-room"
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          </p>
        </div>

        <div className="min-w-0 max-md:-mx-1 max-md:px-1">
          <div
            className="max-md:overflow-x-auto max-md:pb-1 max-md:[-webkit-overflow-scrolling:touch] max-md:[scrollbar-width:thin] md:overflow-visible md:pb-0"
            role="toolbar"
            aria-label="Data room documents actions"
          >
            <div className="flex w-max items-center gap-x-2 md:w-full md:justify-between">
              <div className="flex shrink-0 items-center gap-x-2">
                <GenerateIndexButton
                  teamId={teamInfo?.currentTeam?.id!}
                  dataroomId={dataroom?.id!}
                />
                <RebuildIndexButton
                  teamId={teamInfo?.currentTeam?.id!}
                  dataroomId={dataroom?.id!}
                />
                <DownloadDataroomButton
                  teamId={teamInfo?.currentTeam?.id!}
                  dataroomId={dataroom?.id!}
                  dataroomName={dataroom?.name}
                />
              </div>
              <div className="flex shrink-0 items-center gap-x-2">
                <AddDocumentModal
                  isDataroom={true}
                  dataroomId={dataroom?.id}
                  key={1}
                >
                  <Button
                    size="sm"
                    className="group flex items-center justify-start gap-x-1 whitespace-nowrap px-2 text-left sm:gap-x-3 sm:px-3"
                    title="Add Document"
                  >
                    <PlusIcon
                      className="h-4 w-4 shrink-0 sm:h-5 sm:w-5"
                      aria-hidden="true"
                    />
                    <span className="text-xs sm:text-sm">Add Document</span>
                  </Button>
                </AddDocumentModal>

                <AddFolderModal
                  isDataroom={true}
                  dataroomId={dataroom?.id}
                  key={2}
                >
                  <ResponsiveButton
                    icon={<FolderPlusIcon className="h-5 w-5 shrink-0" />}
                    text="Add Folder"
                    size="sm"
                    variant="outline"
                  />
                </AddFolderModal>
                <div id="dataroom-reordering-action" className="shrink-0">
                  {!isReordering ? (
                    <ResponsiveButton
                      icon={<ArrowUpDownIcon className="h-4 w-4" />}
                      text="Reorder"
                      size="sm"
                      variant="outline"
                      onClick={() => setIsReordering(!isReordering)}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid h-full gap-4 pb-2 md:grid-cols-4">
          <div className="hidden h-full min-h-0 truncate md:col-span-1 md:block">
            <ScrollArea showScrollbar>
              <SidebarFolderTree dataroomId={dataroom?.id!} />
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          <div className="min-w-0 space-y-4 md:col-span-3">
            <section id="documents-header-count" className="min-h-8" />

            {isLoading ? <LoadingDocuments count={3} /> : null}

            {isReordering ? (
              <DataroomSortableList
                mixedItems={items}
                teamInfo={teamInfo}
                dataroomId={dataroom?.id!}
                setIsReordering={setIsReordering}
              />
            ) : (
              <DataroomItemsList
                mixedItems={items}
                teamInfo={teamInfo}
                dataroomId={dataroom?.id!}
                folderCount={folderCount}
                documentCount={documentCount}
              />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
