import {
  documentViewDistribution,
  resolveVideoLength,
  viewPlaybackTimeline,
} from "./playback";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const playbackEvent = {
  event_type: "played",
  start_time: 0,
  end_time: 10,
};

assert(
  resolveVideoLength(210, [playbackEvent]) === 210,
  "stored duration should determine the video length",
);
assert(
  resolveVideoLength(null, [playbackEvent]) === 10,
  "event duration should remain the fallback video length",
);

const timeline = viewPlaybackTimeline([playbackEvent], 210);
assert(
  timeline.length === 211,
  "timeline should contain seconds 0 through 210",
);
assert(
  timeline.at(-1)?.start_time === 210,
  "timeline should end at the stored duration",
);
assert(
  timeline
    .filter(({ start_time }) => start_time >= 11)
    .every(({ views }) => views === 0),
  "timeline should have zero views after playback ends",
);

const distribution = documentViewDistribution(
  [{ ...playbackEvent, view_id: "view_1" }],
  210,
);
assert(
  distribution.length === 211,
  "distribution should contain seconds 0 through 210",
);
assert(
  distribution.at(-1)?.start_time === 210,
  "distribution should end at the stored duration",
);
assert(
  distribution
    .filter(({ start_time }) => start_time >= 11)
    .every(
      ({ unique_views, total_views }) =>
        unique_views === 0 && total_views === 0,
    ),
  "distribution should have zero views after playback ends",
);

console.log("playback.verify: all checks passed");
