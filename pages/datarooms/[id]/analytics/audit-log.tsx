import { CircleHelpIcon } from "lucide-react";

import { useDataroom } from "@/lib/swr/use-dataroom";

import AppLayout from "@/components/layouts/app";
import { BadgeTooltip } from "@/components/ui/tooltip";
import DataroomVisitorsTable from "@/components/visitors/dataroom-visitors-table";

export default function DataroomAuditLogPage() {
  const { dataroom } = useDataroom();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Audit Log
          </h3>
          <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            View all data room activity.
            <BadgeTooltip
              linkText="Learn more"
              content="Track all document access and activity."
              key="audit-log"
              link="https://www.papermark.com/help/article/audit-logs"
            >
              <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
            </BadgeTooltip>
          </p>
        </div>

        <DataroomVisitorsTable dataroomId={dataroom.id} />
      </div>
    </AppLayout>
  );
}
