import { CircleHelpIcon } from "lucide-react";

import { useDataroom } from "@/lib/swr/use-dataroom";

import AppLayout from "@/components/layouts/app";
import { BadgeTooltip } from "@/components/ui/tooltip";
import DataroomViewersTable from "@/components/visitors/dataroom-viewers";

export default function DataroomUsersPage() {
  const { dataroom } = useDataroom();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Visitors
          </h3>
          <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            View and manage data room visitors.
            <BadgeTooltip
              linkText="Learn more"
              content="Track who has accessed your data room."
              key="visitors"
              link="https://www.papermark.com/help/article/viewer-analytics"
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          </p>
        </div>

        <DataroomViewersTable dataroomId={dataroom.id} />
      </div>
    </AppLayout>
  );
}
