export const COUNTABLE_VIDEO_EVENTS = [
  "played",
  "muted",
  "unmuted",
  "rate_changed",
] as const;

export type CountableVideoEventType = (typeof COUNTABLE_VIDEO_EVENTS)[number];

export type VideoPlaybackEvent = {
  view_id?: string;
  event_type: string;
  start_time: number;
  end_time: number;
};

const COUNTABLE = new Set<string>(COUNTABLE_VIDEO_EVENTS);

export function isCountablePlaybackEvent(
  event: VideoPlaybackEvent,
): boolean {
  return (
    COUNTABLE.has(event.event_type) &&
    typeof event.start_time === "number" &&
    typeof event.end_time === "number" &&
    event.end_time > event.start_time &&
    event.end_time - event.start_time >= 1
  );
}

export function countablePlaybackEvents<T extends VideoPlaybackEvent>(
  events: T[] | null | undefined,
): T[] {
  return (events ?? []).filter(isCountablePlaybackEvent);
}

export function playbackSeconds(event: VideoPlaybackEvent): number[] {
  const start = Math.floor(event.start_time);
  const end = Math.ceil(event.end_time);
  const seconds: number[] = [];
  for (let t = start; t < end; t++) {
    seconds.push(t);
  }
  return seconds;
}

export function resolveVideoLength(
  stored: number | null | undefined,
  events: VideoPlaybackEvent[],
): number {
  let maxEnd = 0;
  for (const event of events) {
    if (event.end_time > maxEnd) maxEnd = event.end_time;
  }
  return Math.max(stored && stored > 0 ? stored : 0, Math.ceil(maxEnd));
}

export function watchTimeSeconds(events: VideoPlaybackEvent[]): {
  total: number;
  unique: number;
} {
  const counts = new Map<number, number>();
  for (const event of events) {
    for (const second of playbackSeconds(event)) {
      counts.set(second, (counts.get(second) ?? 0) + 1);
    }
  }
  let total = 0;
  counts.forEach((count) => {
    total += count;
  });
  return { total, unique: counts.size };
}

export function completionRate(
  uniqueSeconds: number,
  videoLength: number,
): number {
  if (videoLength <= 0) return 0;
  return Math.min(100, (uniqueSeconds / videoLength) * 100);
}

export type DocumentSecondStats = {
  start_time: number;
  unique_views: number;
  total_views: number;
};

export function documentViewDistribution(
  events: Array<VideoPlaybackEvent & { view_id: string }>,
  videoLength: number,
): DocumentSecondStats[] {
  const buckets = new Map<
    number,
    { uniqueViewers: Set<string>; viewDurations: Map<string, number> }
  >();
  for (let t = 0; t <= videoLength; t++) {
    buckets.set(t, { uniqueViewers: new Set(), viewDurations: new Map() });
  }

  for (const event of events) {
    for (const second of playbackSeconds(event)) {
      let stats = buckets.get(second);
      if (!stats) {
        stats = { uniqueViewers: new Set(), viewDurations: new Map() };
        buckets.set(second, stats);
      }
      stats.uniqueViewers.add(event.view_id);
      stats.viewDurations.set(
        event.view_id,
        (stats.viewDurations.get(event.view_id) ?? 0) + 1,
      );
    }
  }

  return Array.from(buckets.entries())
    .map(([start_time, stats]) => {
      let total_views = 0;
      stats.viewDurations.forEach((count) => {
        total_views += count;
      });
      return {
        start_time,
        unique_views: stats.uniqueViewers.size,
        total_views,
      };
    })
    .sort((a, b) => a.start_time - b.start_time);
}

export type ViewSecondStats = {
  start_time: number;
  views: number;
};

export function viewPlaybackTimeline(
  events: VideoPlaybackEvent[],
  videoLength: number,
): ViewSecondStats[] {
  const buckets = new Map<number, number>();
  for (let t = 0; t <= videoLength; t++) {
    buckets.set(t, 0);
  }

  for (const event of events) {
    for (const second of playbackSeconds(event)) {
      buckets.set(second, (buckets.get(second) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries())
    .map(([start_time, views]) => ({ start_time, views }))
    .sort((a, b) => a.start_time - b.start_time);
}

export function eventsForView<T extends VideoPlaybackEvent & { view_id: string }>(
  events: T[],
  viewId: string,
): T[] {
  return events.filter((event) => event.view_id === viewId);
}
