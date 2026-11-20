import ffmpeg from "fluent-ffmpeg";

export type VideoMetadata = {
  width: number;
  height: number;
  duration: number;
  fps: number;
};

export function probeVideo(
  source: string,
  timeoutMs: number = 60_000,
): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    let settled = false;

    // Rejecting cannot kill the ffprobe child: fluent-ffmpeg's ffprobe returns
    // no process handle, unlike FfmpegCommand.
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const succeed = (value: VideoMetadata) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(
      () => fail(new Error(`ffprobe timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    ffmpeg.ffprobe(source, (err, metadata) => {
      if (err) {
        fail(err);
        return;
      }
      const stream = metadata.streams.find((s) => s.codec_type === "video");
      if (!stream) {
        fail(new Error("No video stream"));
        return;
      }
      const fpsStr = stream.r_frame_rate || stream.avg_frame_rate || "0/1";
      const [num, den] = fpsStr.split("/").map(Number);
      succeed({
        width: stream.width || 0,
        height: stream.height || 0,
        duration: Math.round(metadata.format.duration || 0),
        fps: num / (den || 1),
      });
    });
  });
}
