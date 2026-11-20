import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { InviteViewersModal } from "@/ee/features/dataroom-invitations/components/invite-viewers-modal";
import { CircleHelpIcon, SendIcon } from "lucide-react";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";
import { useDataroomVisitors } from "@/lib/swr/use-dataroom-visitors";

import DataroomTeamMembers from "@/components/datarooms/settings/dataroom-team-members";
import AppLayout from "@/components/layouts/app";
import { SearchBoxPersisted } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BadgeTooltip, ButtonTooltip } from "@/components/ui/tooltip";
import { DataroomParticipantsTable } from "@/components/visitors/dataroom-participants-table";
import { VisitorStatusFilter } from "@/components/visitors/visitor-status-filter";

export default function DataroomParticipantsPage() {
  const router = useRouter();
  const { dataroom } = useDataroom();
  // Email invitations stay a Data Rooms Plus (and higher) capability for now.
  const { isDataroomsPlus } = usePlan();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState("lastViewed");
  const [sortOrder, setSortOrder] = useState("desc");
  const [activeTab, setActiveTab] = useState(
    (router.query.tab as string) || "participants",
  );
  const [status, setStatus] = useState("all");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const {
    visitors,
    anonymous,
    pagination,
    sorting,
    isValidating,
    isFiltered,
    mutate: mutateParticipants,
  } = useDataroomVisitors({
      dataroomId: dataroom?.id,
      page: currentPage,
      pageSize,
      sortBy,
      sortOrder,
      status,
    });

  useEffect(() => {
    setCurrentPage(1);
  }, [router.query.search, status]);

  useEffect(() => {
    if (router.query.tab) {
      setActiveTab(router.query.tab as string);
    }
  }, [router.query.tab]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    router.push(
      { pathname: router.pathname, query: { ...router.query, tab: value } },
      undefined,
      { shallow: true },
    );
  };

  const handleSortChange = (newSortBy: string, newSortOrder: string) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    setCurrentPage(1);
  };

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Participants
          </h1>
          <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            Everyone who visited this data room, was invited, or is on one of
            its link allow lists.
            <BadgeTooltip
              linkText="Learn more"
              content="Track who has accessed your data room."
              key="participants"
              link="https://www.papermark.com/help/article/viewer-analytics"
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="participants">Participants</TabsTrigger>
              <TabsTrigger value="team">Team Members</TabsTrigger>
            </TabsList>

            {activeTab === "participants" ? (
              <div className="flex items-center gap-x-2">
                <VisitorStatusFilter value={status} onChange={setStatus} />
                <div className="relative w-full sm:max-w-xs">
                  <SearchBoxPersisted
                    loading={isValidating}
                    placeholder="Search participants..."
                    inputClassName="h-10"
                  />
                </div>
                {isDataroomsPlus ? (
                  <ButtonTooltip content="Invite via email">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={() => setIsInviteModalOpen(true)}
                    >
                      <SendIcon className="h-4 w-4" />
                      <span className="sr-only">Invite via email</span>
                    </Button>
                  </ButtonTooltip>
                ) : null}
              </div>
            ) : null}
          </div>

          <TabsContent value="participants">
            <div className="relative">
              <DataroomParticipantsTable
                visitors={visitors}
                anonymous={anonymous}
                pagination={pagination}
                sorting={sorting ?? { sortBy, sortOrder }}
                isFiltered={isFiltered}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                onSortChange={handleSortChange}
              />
            </div>
          </TabsContent>

          <TabsContent value="team">
            <DataroomTeamMembers
              dataroomId={dataroom.id}
              dataroomName={dataroom.name}
            />
          </TabsContent>
        </Tabs>
      </div>

      {isDataroomsPlus ? (
        <InviteViewersModal
          open={isInviteModalOpen}
          setOpen={setIsInviteModalOpen}
          dataroomId={dataroom.id}
          dataroomName={dataroom.name}
          canSend
          onSuccess={() => mutateParticipants()}
        />
      ) : null}
    </AppLayout>
  );
}
