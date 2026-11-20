import { useTeam } from "@/context/team-context";
import FreezeSettings from "@/ee/features/dataroom-freeze/components/freeze-settings";

import { usePlan } from "@/lib/swr/use-billing";
import { useDataroom } from "@/lib/swr/use-dataroom";

import DeleteDataroom from "@/components/datarooms/settings/delete-dataroom";
import AppLayout from "@/components/layouts/app";

export default function DangerZone() {
  const { dataroom } = useDataroom();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { isBusiness, isDatarooms, isDataroomsPlus, isTrial } = usePlan();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  const canDelete = isBusiness || isDatarooms || isDataroomsPlus || isTrial;

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Danger Zone
          </h3>
          <p className="text-sm text-muted-foreground">
            Irreversible actions for this data room. Proceed with caution.
          </p>
        </div>

        <div className="grid gap-6">
          <FreezeSettings
            dataroomId={dataroom.id}
            dataroomName={dataroom.name}
            isFrozen={dataroom.isFrozen}
            frozenAt={dataroom.frozenAt}
            frozenByUser={dataroom.frozenByUser ?? null}
            freezeArchiveUrl={dataroom.freezeArchiveUrl}
            freezeArchiveHash={dataroom.freezeArchiveHash}
          />

          {canDelete ? (
            <DeleteDataroom
              dataroomId={dataroom.id}
              dataroomName={dataroom.name}
            />
          ) : null}
        </div>
      </main>
    </AppLayout>
  );
}
