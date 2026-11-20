import ErrorPage from "next/error";

import { TStatsData } from "@/lib/swr/use-stats";

import { Skeleton } from "@/components/ui/skeleton";

import StatsElement from "./stats-element";

export default function StatsCard({
  statsData,
}: {
  statsData: { stats: TStatsData | undefined; loading: boolean; error: any };
}) {
  const { stats, loading, error } = statsData;

  if (error && error.status === 404) {
    return <ErrorPage statusCode={404} />;
  }

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1.5 border-foreground/5 sm:gap-2 lg:gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            className="rounded-lg border border-foreground/5 px-2 py-2 sm:px-6 sm:py-6 lg:px-8"
            key={i}
          >
            <Skeleton className="h-3 w-[85%] rounded-sm sm:h-6 sm:w-[80%]" />
            <Skeleton className="mt-2 h-6 w-8 rounded-sm sm:mt-4 sm:h-8 sm:w-9" />
          </div>
        ))}
      </div>
    );
  }

  const statistics = [
    {
      name: "Number of views",
      shortName: "Views",
      value: stats?.totalViews.toString() ?? "0",
      active: true,
    },
    {
      name: "Average view completion",
      shortName: "Avg. completion",
      value: `${stats?.avgCompletionRate ?? 0}%`,
      active: true,
    },
    {
      name: "Total average view duration",
      shortName: "Duration",
      value:
        stats?.total_duration == null
          ? "46"
          : stats?.total_duration < 60000
            ? `${Math.round(stats?.total_duration / 1000)}`
            : `${Math.floor(stats?.total_duration / 60000)}:${
                Math.round((stats?.total_duration % 60000) / 1000) < 10
                  ? `0${Math.round((stats?.total_duration % 60000) / 1000)}`
                  : Math.round((stats?.total_duration % 60000) / 1000)
              }`,
      unit: stats?.total_duration! < 60000 ? "seconds" : "minutes",
      active: stats?.total_duration ? true : false,
    },
  ];

  return stats && stats.views.length > 0 ? (
    <div className="grid grid-cols-3 gap-1.5 border-foreground/5 sm:gap-2 lg:gap-3">
      {statistics.map((stat, statIdx) => (
        <StatsElement key={statIdx} stat={stat} statIdx={statIdx} />
      ))}
    </div>
  ) : null;
}
