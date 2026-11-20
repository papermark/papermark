import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useState } from "react";

import { useStats } from "@/lib/swr/use-stats";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import StatsCard from "./stats-card";
import StatsChart from "./stats-chart";

export const StatsComponent = ({
  documentId,
  numPages,
  dataroomId,
}: {
  documentId: string;
  numPages: number;
  /**
   * When set, the stats are scoped to this data room's visits only (used on the
   * dataroom-scoped document page).
   */
  dataroomId?: string;
}) => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const initialExclude = searchParams?.get("excludeInternal") === "true";
  const [excludeTeamMembers, setExcludeTeamMembers] =
    useState<boolean>(initialExclude);

  const statsData = useStats({ excludeTeamMembers, documentId, dataroomId });

  const onToggle = (checked: boolean) => {
    setExcludeTeamMembers(checked);
    const params = new URLSearchParams(searchParams?.toString());
    params.set("excludeInternal", checked.toString());
    // Update the query on the current route. Keep the pathname explicit so this
    // works both on /documents/[id] and the dataroom-scoped document page where
    // the route's last segment is not the document id.
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <>
      <div className="flex items-center justify-end space-x-2">
        <Switch
          disabled={statsData.loading || statsData.error}
          id="toggle-stats"
          checked={excludeTeamMembers}
          onCheckedChange={onToggle}
        />
        <Label
          htmlFor="toggle-stats"
          className={excludeTeamMembers ? "" : "text-muted-foreground"}
        >
          Exclude internal views
        </Label>
      </div>

      {/* Stats Chart */}
      <StatsChart
        documentId={documentId}
        totalPagesMax={numPages}
        statsData={statsData}
      />

      {/* Stats Card */}
      <StatsCard statsData={statsData} />
    </>
  );
};
