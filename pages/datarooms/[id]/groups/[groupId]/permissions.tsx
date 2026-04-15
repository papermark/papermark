import { GroupHeader } from "@/components/datarooms/groups/group-header";
import { GroupNavigation } from "@/components/datarooms/groups/group-navigation";
import ExpandableTable from "@/components/datarooms/groups/group-permissions";
import AppLayout from "@/components/layouts/app";

import { useDataroom } from "@/lib/swr/use-dataroom";
import { useDataroomGroup } from "@/lib/swr/use-dataroom-groups";

export default function DataroomGroupPage() {
  const { dataroom } = useDataroom();
  const { viewerGroup } = useDataroomGroup();

  if (!dataroom || !viewerGroup) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <GroupHeader dataroomId={dataroom.id} groupName={viewerGroup.name} />
        <div className="mx-auto grid w-full items-start gap-6 md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr]">
          <GroupNavigation
            dataroomId={dataroom.id}
            viewerGroupId={viewerGroup?.id!}
          />
          <div className="grid gap-6">
            <ExpandableTable
              dataroomId={dataroom.id}
              permissions={viewerGroup.accessControls}
              groupId={viewerGroup.id}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
