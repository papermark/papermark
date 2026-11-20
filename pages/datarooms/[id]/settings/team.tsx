import { PlanEnum } from "@/ee/stripe/constants";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";

import DataroomTeamMembers from "@/components/datarooms/settings/dataroom-team-members";
import AppLayout from "@/components/layouts/app";
import { FeaturePreview } from "@/components/ui/feature-preview";

export default function DataroomTeamSettings() {
  const { dataroom } = useDataroom();
  const { isDatarooms, isTrial } = usePlan();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  const hasAccess = isDatarooms || isTrial;

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Team members
          </h3>
          <p className="text-sm text-muted-foreground">
            Add teammates to this data room and manage who can access it.
          </p>
        </div>

        {hasAccess ? (
          <DataroomTeamMembers
            dataroomId={dataroom.id}
            dataroomName={dataroom.name}
          />
        ) : (
          <FeaturePreview
            title="Add team members to this data room"
            description="Give teammates access to a single data room. Available on the Data Rooms plan and higher."
            requiredPlan={PlanEnum.DataRooms}
            trigger="dataroom_team_members"
            upgradeButtonText="Data Rooms"
            highlightItem={["assign"]}
          >
            <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 sm:flex-row sm:items-center sm:p-6 dark:border-gray-800">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Members
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    People on your team with access to this data room.
                  </p>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-12 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800"
                    />
                  ))}
                </div>
              </div>
            </div>
          </FeaturePreview>
        )}
      </main>
    </AppLayout>
  );
}
