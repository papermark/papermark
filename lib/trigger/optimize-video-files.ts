import { logger, task } from "@trigger.dev/sdk";
import ffmpeg from "fluent-ffmpeg";
import { createReadStream, createWriteStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream } from "stream/web";

import { ONE_HOUR } from "@/lib/constants";
import { getFile } from "@/lib/files/get-file";
import { streamFileServer } from "@/lib/files/stream-file-server";
import prisma from "@/lib/prisma";
import { probeVideo } from "@/lib/video/probe";
import type { VideoProcessingMode } from "@/lib/video/processing-plan";

type ProcessVideoPayload = {
  documentVersionId: string;
  mode: VideoProcessingMode;
};

type ProcessVideoResult =
  | { status: "skipped"; reason: "version-missing" }
  | { status: "probed"; duration: number; lengthWritten: boolean }
  | {
      status: "optimization-skipped";
      duration: number;
      lengthWritten: boolean;
    }
  | { status: "optimized"; duration: number; lengthWritten: boolean };

const MAX_OPTIMIZATION_FILE_SIZE = BigInt(500 * 1024 * 1024);

// The upload path segment is minted by putFileInS3 before the Document row
// exists, so it is not Document.id. The optimized file must reuse it to stay
// under the same `teamId/docId/` prefix as the original.
function storageDocId(key: string): string {
  const docId = key.split("/")[1];
  if (!docId) {
    throw new Error(`Cannot derive storage docId from key ${key}`);
  }
  return docId;
}

export const processVideo = task({
  id: "process-video",
  machine: {
    preset: "medium-1x",
  },
  run: async ({
    documentVersionId,
    mode,
  }: ProcessVideoPayload): Promise<ProcessVideoResult> => {
    const version = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: {
        id: true,
        file: true,
        storageType: true,
        fileSize: true,
        length: true,
        document: {
          select: {
            teamId: true,
          },
        },
      },
    });

    if (!version) {
      logger.warn("Skipping video processing because version is missing", {
        documentVersionId,
        mode,
      });
      return { status: "skipped", reason: "version-missing" };
    }

    try {
      const signedUrl = await getFile({
        data: version.file,
        type: version.storageType,
        expiresIn: ONE_HOUR,
      });

      const metadata = await probeVideo(signedUrl);
      if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
        throw new Error(
          `Invalid video duration for document version ${documentVersionId}`,
        );
      }

      logger.info("Video probed", {
        documentVersionId,
        mode,
        duration: metadata.duration,
        width: metadata.width,
        fps: metadata.fps,
      });

      const written = await prisma.documentVersion.updateMany({
        where: {
          id: documentVersionId,
          OR: [{ length: null }, { length: { lte: 0 } }],
        },
        data: { length: metadata.duration },
      });
      const lengthWritten = written.count > 0;

      switch (mode) {
        case "probe":
          return {
            status: "probed",
            duration: metadata.duration,
            lengthWritten,
          };
        case "optimize": {
          if (
            version.fileSize !== null &&
            version.fileSize > MAX_OPTIMIZATION_FILE_SIZE
          ) {
            logger.info("Skipping optimization because the file is too large", {
              documentVersionId,
              mode,
              duration: metadata.duration,
              width: metadata.width,
              fps: metadata.fps,
              fileSize: version.fileSize?.toString(),
            });
            return {
              status: "optimization-skipped",
              duration: metadata.duration,
              lengthWritten,
            };
          }

          const tempDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), "video_"),
          );

          try {
            const inputPath = path.join(tempDirectory, "input.mp4");
            const outputPath = path.join(tempDirectory, "output.mp4");
            const response = await fetch(signedUrl);
            if (!response.body) {
              throw new Error("Failed to fetch video stream");
            }

            logger.info("Streaming video to temporary file", {
              documentVersionId,
              mode,
            });
            await pipeline(
              Readable.fromWeb(response.body as ReadableStream),
              createWriteStream(inputPath),
            );

            const keyframeInterval = Math.round(metadata.fps * 2);
            const bitrate = "6000k";
            const maxBitrate = parseInt(bitrate.replace("k", "")) * 2;
            const scaleFilter =
              metadata.width > 1920 ? "-vf scale=1920:-2" : null;

            await new Promise<void>((resolve, reject) => {
              const ffmpegCommand = ffmpeg(inputPath)
                .inputOptions(["-y"])
                .outputOptions([
                  ...(scaleFilter ? [scaleFilter] : []),
                  "-c:v libx264",
                  "-profile:v high",
                  "-level:v 4.1",
                  "-c:a aac",
                  "-ar 48000",
                  "-b:a 128k",
                  `-b:v ${bitrate}`,
                  `-maxrate ${maxBitrate}k`,
                  `-bufsize ${maxBitrate}k`,
                  "-preset medium",
                  `-g ${keyframeInterval}`,
                  `-keyint_min ${keyframeInterval}`,
                  "-sc_threshold 0",
                  "-movflags +faststart",
                ])
                .output(outputPath)
                .on("start", (cmd) => {
                  logger.info("FFmpeg started", {
                    cmd,
                    documentVersionId,
                    originalSize: `${metadata.width}x${metadata.height}`,
                    scaling: !!scaleFilter,
                    fps: metadata.fps,
                    keyframeInterval,
                  });
                })
                .on("error", (err, stdout, stderr) => {
                  logger.error("FFmpeg error", {
                    documentVersionId,
                    error: err.message,
                    stdout,
                    stderr,
                  });
                  reject(err);
                })
                .on("end", () => {
                  logger.info("FFmpeg completed", { documentVersionId });
                  resolve();
                });

              ffmpegCommand.run();
            });

            const fileStream = createReadStream(outputPath);
            fileStream.on("error", (err) => {
              logger.error("Stream error", {
                documentVersionId,
                error: err.message,
                stack: err.stack,
              });
            });

            const { type, data } = await streamFileServer({
              file: {
                name: "optimized.mp4",
                type: "video/mp4",
                stream: fileStream,
              },
              teamId: version.document.teamId,
              docId: storageDocId(version.file),
            });
            logger.info("Upload completed", {
              documentVersionId,
              type,
              data,
            });

            if (!data) {
              throw new Error("Upload failed: No file path returned");
            }

            await prisma.documentVersion.update({
              where: { id: documentVersionId },
              data: { file: data },
            });

            return {
              status: "optimized",
              duration: metadata.duration,
              lengthWritten,
            };
          } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
            logger.info("Temporary directory cleaned up", {
              documentVersionId,
              tempDirectory,
            });
          }
        }
        default: {
          const exhaustiveMode: never = mode;
          throw new Error(
            `Unsupported video processing mode: ${exhaustiveMode}`,
          );
        }
      }
    } catch (error) {
      logger.error("Failed to process video", {
        documentVersionId,
        mode,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },
});
