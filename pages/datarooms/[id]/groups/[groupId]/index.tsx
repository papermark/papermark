import { useTeam } from "@/context/team-context";
import { toast } from "sonner";
import { mutate } from "swr";

import DeleteGroup from "@/components/datarooms/groups/delete-group";
import { GroupHeader } from "@/components/datarooms/groups/group-header";
import { GroupNavigation } from "@/components/datarooms/groups/group-navigation";
import AppLayout from "@/components/layouts/app";
import { Form } from "@/components/ui/form";

import { useDataroom } from "@/lib/swr/use-dataroom";
import { useDataroomGroup } from "@/lib/swr/use-dataroom-groups";

export default function DataroomGroupPage() {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
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
            viewerGroupId={viewerGroup.id}
          />
          <div className="grid gap-6">
            <Form
              title="Group Name"
              description="This is the name of your data room group on Papermark."
              inputAttrs={{
                name: "name",
                placeholder: "e.g. Management Team",
                maxLength: 32,
              }}
              defaultValue={viewerGroup?.name ?? ""}
              helpText="Max 32 characters"
              handleSubmit={(updateData) =>
                fetch(
                  `/api/teams/${teamId}/datarooms/${dataroom.id}/groups/${viewerGroup.id}`,
                  {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify(updateData),
                  },
                ).then(async (res) => {
                  if (res.status === 200) {
                    await Promise.all([
                      mutate(
                        `/api/teams/${teamId}/datarooms/${dataroom.id}/groups`,
                      ),
                      mutate(
                        `/api/teams/${teamId}/datarooms/${dataroom.id}/groups/${viewerGroup.id}`,
                      ),
                    ]);
                    toast.success("Successfully updated group name!");
                  } else {
                    const { error } = await res.json();
                    toast.error(error.message);
                  }
                })
              }
            />
            <DeleteGroup
              dataroomId={dataroom.id}
              groupId={viewerGroup.id}
              groupName={viewerGroup.name.trim()}
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
