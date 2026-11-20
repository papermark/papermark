import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type VideoRetentionPoint = {
  start_time: number;
  unique_views: number;
  total_views: number;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function RetentionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: number;
}) {
  if (!active || !payload || payload.length < 2) return null;

  const uniqueViews = payload[1].value;
  const playbackCount = payload[0].value;
  const intensity = playbackCount / uniqueViews || 1;

  return (
    <div className="space-y-1 rounded-md border bg-background p-2 text-sm">
      <p className="font-medium">{formatTime(label ?? 0)}</p>
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

export function VideoRetentionChart({
  data,
  height = 300,
}: {
  data: VideoRetentionPoint[];
  height?: number;
}) {
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
      <div className="-mx-9" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
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
            <Tooltip content={<RetentionTooltip />} />
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
    </div>
  );
}
