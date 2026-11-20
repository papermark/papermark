import ErrorPage from "next/error";

import { useDataroomStats } from "@/lib/swr/use-dataroom-stats";

import StatsElement from "@/components/documents/stats-element";
import { Skeleton } from "@/components/ui/skeleton";

export default function StatsCard() {
  const { stats, loading, error } = useDataroomStats();

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
      value: stats?.dataroomViews.length.toString() ?? "0",
      active: true,
    },
    {
      name: "Number of documents views",
      shortName: "Doc views",
      value: stats?.documentViews.length.toString() ?? "0",
      active: true,
    },
    {
      name: "Total time spent",
      shortName: "Time",
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
      active: true,
    },
  ];

  return stats && stats.dataroomViews.length > 0 ? (
    <div className="grid grid-cols-3 gap-1.5 border-foreground/5 sm:gap-2 lg:gap-3">
      {statistics.map((stat, statIdx) => (
        <StatsElement key={statIdx} stat={stat} statIdx={statIdx} />
      ))}
    </div>
  ) : null;
}
