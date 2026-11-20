import { videoProcessingMode } from "./processing-plan";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  videoProcessingMode({ type: "pdf", contentType: "application/pdf" }) === null,
  "non-video type should return null",
);
assert(
  videoProcessingMode({ type: "video", contentType: "video/mp4" }) === "probe",
  "mp4 should return probe",
);
assert(
  videoProcessingMode({
    type: "video",
    contentType: "Video/MP4; codecs=avc1",
  }) === "probe",
  "mp4 with charset/codecs should normalize to probe",
);
assert(
  videoProcessingMode({
    type: "video",
    contentType: " video/mp4 ; codecs=avc1 ",
  }) === "probe",
  "mp4 with whitespace around the parameter separator should normalize to probe",
);
assert(
  videoProcessingMode({ type: "video", contentType: "video/quicktime" }) ===
    "optimize",
  "non-mp4 video/* should return optimize",
);
assert(
  videoProcessingMode({ type: "video", contentType: null }) === null,
  "video with null content type should return null",
);
assert(
  videoProcessingMode({
    type: "video",
    contentType: "application/octet-stream",
  }) === null,
  "video with non-video content type should return null",
);
assert(
  videoProcessingMode({ type: "document", contentType: "video/mp4" }) === null,
  "non-video type with video content type should return null",
);

console.log("processing-plan.verify: all checks passed");
