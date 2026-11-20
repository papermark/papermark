import { useDataroom, useDataroomLinks } from "@/lib/swr/use-dataroom";

import StatsCard from "@/components/datarooms/stats-card";
import AppLayout from "@/components/layouts/app";
import LinksTable from "@/components/links/links-table";
import DataroomVisitorsTable from "@/components/visitors/dataroom-visitors-table";

export default function DataroomPage() {
  const { dataroom } = useDataroom();
  const { links } = useDataroomLinks();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Overview
          </h3>
        </div>

        <div className="space-y-4">
          <StatsCard />

          <LinksTable
            links={links}
            targetType={"DATAROOM"}
            dataroomName={dataroom.name}
          />

          <DataroomVisitorsTable dataroomId={dataroom.id} />
        </div>
      </div>
    </AppLayout>
  );
}
