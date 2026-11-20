import { useDataroom } from "@/lib/swr/use-dataroom";
import {
  useDataroomGroup,
  useDataroomGroupLinks,
} from "@/lib/swr/use-dataroom-groups";

import { GroupHeader } from "@/components/datarooms/groups/group-header";
import { GroupNavigation } from "@/components/datarooms/groups/group-navigation";
import AppLayout from "@/components/layouts/app";
import LinksTable from "@/components/links/links-table";

export default function DataroomGroupLinksPage() {
  const { dataroom } = useDataroom();
  const { viewerGroup } = useDataroomGroup();
  const { links, loading } = useDataroomGroupLinks();

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
            viewerGroupId={viewerGroup.id}
          />
          <div className="grid gap-6">
            {loading ? (
              <div>Loading...</div>
            ) : (
              <LinksTable
                links={links}
                targetType={"DATAROOM"}
                dataroomName={dataroom.name}
              />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
