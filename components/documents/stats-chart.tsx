import ErrorPage from "next/error";

import { TStatsData } from "@/lib/swr/use-stats";

import BarChartComponent from "../charts/bar-chart";
import { buildPageDurationSeries } from "../charts/utils";
import StatsChartDummy from "./stats-chart-dummy";
import StatsChartSkeleton from "./stats-chart-skeleton";

export default function StatsChart({
  documentId,
  statsData,
  totalPagesMax = 0,
}: {
  documentId: string;
  statsData: { stats: TStatsData | undefined; loading: boolean; error: any };
  totalPagesMax?: number;
}) {
  const { stats, loading, error } = statsData;

  if (error && error.status === 404) {
    return <ErrorPage statusCode={404} />;
  }

  if (loading) {
    return <StatsChartSkeleton className="my-8" />;
  }

  if (!stats || stats.views.length === 0) {
    return <StatsChartDummy totalPagesMax={totalPagesMax} />;
  }

  return (
    <div className="overflow-x-auto rounded-bl-lg border-b border-l pb-0.5 pl-0.5 md:pb-1 md:pl-1">
      <BarChartComponent
        data={buildPageDurationSeries(
          stats.duration?.data ?? [],
          totalPagesMax,
        )}
      />
    </div>
  );
}
