import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
import { pythonExtension } from "@trigger.dev/python/extension";
import { defineConfig, timeout } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_plmsfqvqunboixacjjus",
  dirs: ["./lib/trigger", "./ee/features/ai/lib/trigger"],
  maxDuration: timeout.None, // no max duration
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    external: ["mupdf"],
    extensions: [
      prismaExtension({
        mode: "legacy",
        schema: "prisma/schema/schema.prisma",
      }),
      ffmpeg(),
      pythonExtension({
        scripts: ["./**/*.py"],
      }),
    ],
  },
});
