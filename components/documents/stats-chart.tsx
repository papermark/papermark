import ErrorPage from "next/error";

import { TStatsData } from "@/lib/swr/use-stats";

import BarChartComponent from "../charts/bar-chart";
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

  let durationData = Array.from({ length: totalPagesMax }, (_, i) => ({
    pageNumber: (i + 1).toString(),
    data: [
      {
        versionNumber: 1,
        avg_duration: 0,
      },
    ],
  }));

  const swrData = stats?.duration;

  if (swrData) {
    swrData.data.forEach((dataItem) => {
      const pageIndex = durationData.findIndex(
        (item) => item.pageNumber === dataItem.pageNumber,
      );

      if (pageIndex !== -1) {
        // If page exists in the initialized array, update its data
        const versionIndex = durationData[pageIndex].data.findIndex(
          (v) => v.versionNumber === dataItem.versionNumber,
        );
        if (versionIndex === -1) {
          // If this version number doesn't exist, add it
          durationData[pageIndex].data.push({
            versionNumber: dataItem.versionNumber,
            avg_duration: dataItem.avg_duration,
          });
        } else {
          // Update existing data for this version
          durationData[pageIndex].data[versionIndex] = {
            ...durationData[pageIndex].data[versionIndex],
            avg_duration: dataItem.avg_duration,
          };
        }
      } else {
        // If this page number doesn't exist, add it with the version data
        durationData.push({
          pageNumber: dataItem.pageNumber,
          data: [
            {
              versionNumber: dataItem.versionNumber,
              avg_duration: dataItem.avg_duration,
            },
          ],
        });
      }
    });

    // Sort by page number
    durationData.sort(
      (a, b) => parseInt(a.pageNumber) - parseInt(b.pageNumber),
    );
  }

  return stats && stats.views.length > 0 ? (
    <div className="overflow-x-auto rounded-bl-lg border-b border-l pb-0.5 pl-0.5 md:pb-1 md:pl-1">
      <BarChartComponent data={durationData} />
    </div>
  ) : (
    <StatsChartDummy totalPagesMax={totalPagesMax} />
  );
}
