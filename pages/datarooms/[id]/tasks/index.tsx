import { RequestListView } from "@/ee/features/request-lists/components/request-list-view";
import { CircleHelpIcon } from "lucide-react";

import { useDataroom } from "@/lib/swr/use-dataroom";

import AppLayout from "@/components/layouts/app";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function DataroomTasksPage() {
  const { dataroom } = useDataroom();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-6 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            Request List
            <BadgeTooltip
              content="Create a due-diligence checklist of requests, assign them to visitors or groups, and track completion."
              key="request-list"
              link="https://www.papermark.com/help"
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          </h3>
          <p className="text-sm text-muted-foreground">
            Track outstanding requests and assign them to data room visitors.
          </p>
        </div>

        <RequestListView dataroomId={dataroom.id} />
      </div>
    </AppLayout>
  );
}
