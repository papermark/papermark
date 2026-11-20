import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";

import { useTeam } from "@/context/team-context";

import { Card } from "@/components/ui/card";
import LoadingSpinner from "@/components/ui/loading-spinner";

import { fetcher } from "@/lib/utils";

export default function VisitorVideoChart({
  documentId,
  viewId,
  teamId,
}: {
  documentId: string;
  viewId: string;
  teamId?: string;
}) {
  const teamInfo = useTeam();
  const resolvedTeamId = teamId || teamInfo?.currentTeam?.id;
  const { data: videoEvents, error: videoError } = useSWR<{
    data: Array<{
      start_time: number;
      views: number;
    }>;
  }>(
    resolvedTeamId
      ? `/api/teams/${resolvedTeamId}/documents/${documentId}/views/${viewId}/video-stats`
      : null,
    fetcher,
  );

  if (videoError) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Playback chart could not be loaded.
      </p>
    );
  }

  if (!videoEvents) {
    return (
      <Card>
        <div className="flex h-[200px] items-center justify-center">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="-ml-10 h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={videoEvents.data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <XAxis
            dataKey="start_time"
            tickFormatter={formatTime}
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
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="space-y-1 rounded-md border bg-background p-2 text-sm">
                    <p className="font-medium">{formatTime(label)}</p>
                    <div className="space-y-0.5 text-muted-foreground">
                      <p>Playback count: {payload[0].value}</p>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area
            type="monotone"
            dataKey="views"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#playbackGradient)"
            dot={false}
          />
          <defs>
            <linearGradient id="playbackGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
