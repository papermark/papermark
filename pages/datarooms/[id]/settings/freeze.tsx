import { useDataroom } from "@/lib/swr/use-dataroom";

import FreezeSettings from "@/ee/features/dataroom-freeze/components/freeze-settings";
import AppLayout from "@/components/layouts/app";

export default function Freeze() {
  const { dataroom } = useDataroom();

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <div className="grid gap-6">
          <FreezeSettings
            dataroomId={dataroom.id}
            isFrozen={dataroom.isFrozen}
            frozenAt={dataroom.frozenAt}
            frozenByUser={dataroom.frozenByUser ?? null}
            freezeArchiveUrl={dataroom.freezeArchiveUrl}
            freezeArchiveHash={dataroom.freezeArchiveHash}
          />
        </div>
      </main>
    </AppLayout>
  );
}
