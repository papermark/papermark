import { DocumentVersion } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import StatsElement from "@/components/documents/stats-element";
import VideoChartPlaceholder from "@/components/documents/video-chart-placeholder";
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

  const formatTooltipTime = (value: number) => {
    return formatTime(value);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const uniqueViews = payload[1].value;
      const playbackCount = payload[0].value;
      const intensity = playbackCount / uniqueViews || 1;

      return (
        <div className="space-y-1 rounded-md border bg-background p-2 text-sm">
          <p className="font-medium">{formatTooltipTime(label)}</p>
          <div className="space-y-0.5 text-muted-foreground">
            <p className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {uniqueViews} unique viewer{uniqueViews !== 1 ? "s" : ""}
            </p>
            <p className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#3B82F6]" />
              {playbackCount} playback{playbackCount !== 1 ? "s" : ""}
            </p>
            <p className="pt-1 text-xs">
              Replayed {(intensity - 1).toFixed(1)}x on average
            </p>
          </div>
        </div>
      );
    }
    return null;
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
      <div className="mt-2 flex items-center justify-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-emerald-500" />
          <span>Unique Viewers</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-[#3B82F6]" />
          <span>Playback Count</span>
        </div>
      </div>
      <div className="-mx-9 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data.overall.view_distribution}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="start_time"
              tickFormatter={formatTooltipTime}
              stroke="#888888"
              fontSize={12}
            />
            <YAxis
              stroke="#888888"
              fontSize={12}
              tickFormatter={(value) => Math.floor(value).toString()}
              domain={[0, (dataMax: number) => dataMax + 1]}
              padding={{ top: 20 }}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <defs>
              <linearGradient
                id="uniqueViewsGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="playbackGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="total_views"
              stroke="#3B82F6"
              strokeWidth={2}
              fill="url(#playbackGradient)"
              dot={false}
              name="Playback Count"
            />
            <Area
              type="monotone"
              dataKey="unique_views"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#uniqueViewsGradient)"
              dot={false}
              name="Unique Viewers"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:gap-4 lg:gap-4">
        {stats.map((stat, index) => (
          <StatsElement key={stat.name} stat={stat} statIdx={index} />
        ))}
      </div>
    </div>
  );
}
