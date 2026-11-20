import { DocumentVersion } from "@prisma/client";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import StatsElement from "@/components/documents/stats-element";
import VideoChartPlaceholder from "@/components/documents/video-chart-placeholder";
import { VideoRetentionChart } from "@/components/documents/video-retention-chart";
import { Card, CardContent } from "@/components/ui/card";
import LoadingSpinner from "@/components/ui/loading-spinner";

interface VideoAnalyticsProps {
  teamId: string;
  documentId: string;
  primaryVersion: DocumentVersion;
}

export default function VideoAnalytics({
  teamId,
  documentId,
  primaryVersion,
}: VideoAnalyticsProps) {
  const { data, error, isLoading } = useSWR<{
    overall: {
      unique_views: number;
      total_views: number;
      total_watch_time: number;
      avg_view_duration: number;
      last_viewed_at: string;
      first_viewed_at: string;
      view_distribution: Array<{
        start_time: number;
        unique_views: number;
        total_views: number;
      }>;
    } | null;
  }>(`/api/teams/${teamId}/documents/${documentId}/video-analytics`, fetcher);

  if (error) {
    console.error("Error loading video analytics:", error);
    return null;
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-[300px] items-center justify-center">
          <LoadingSpinner />
        </CardContent>
      </Card>
    );
  }

  if (!data?.overall) {
    const emptyStats = [
      {
        name: "Total views",
        shortName: "Views",
        value: "0",
        active: false,
      },
      {
        name: "Watch time",
        shortName: "Watch time",
        value: "0:00",
        unit: "minutes",
        active: false,
      },
      {
        name: "Average view duration",
        shortName: "Avg. duration",
        value: "0:00",
        unit: "minutes",
        active: false,
      },
    ];

    return (
      <div className="space-y-4">
        <VideoChartPlaceholder length={primaryVersion.length} />
        <div className="grid grid-cols-3 gap-1.5 sm:gap-4 lg:gap-4">
          {emptyStats.map((stat, index) => (
            <StatsElement key={stat.name} stat={stat} statIdx={index} />
          ))}
        </div>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const stats = [
    {
      name: "Total views",
      shortName: "Views",
      value: data.overall.unique_views.toString(),
      active: true,
    },
    {
      name: "View time",
      shortName: "View time",
      value: formatTime(data.overall.total_watch_time),
      unit: "minutes",
      active: true,
    },
    {
      name: "Average view duration",
      shortName: "Avg. duration",
      value: formatTime(data.overall.avg_view_duration),
      unit: "minutes",
      active: true,
    },
  ];

  return (
    <div className="space-y-4">
      <VideoRetentionChart data={data.overall.view_distribution} />
      <div className="grid grid-cols-3 gap-1.5 sm:gap-4 lg:gap-4">
        {stats.map((stat, index) => (
          <StatsElement key={stat.name} stat={stat} statIdx={index} />
        ))}
      </div>
    </div>
  );
}
