---
name: trigger-config
description: Configure Trigger.dev projects with trigger.config.ts. Use when setting up build extensions for Prisma, Playwright, FFmpeg, Python, or customizing deployment settings.
---

# Trigger.dev Configuration

Configure your Trigger.dev project with `trigger.config.ts` and build extensions.

## When to Use

- Setting up a new Trigger.dev project
- Adding database support (Prisma, TypeORM)
- Configuring browser automation (Playwright, Puppeteer)
- Adding media processing (FFmpeg)
- Running Python scripts from tasks
- Syncing environment variables
- Installing system packages

## Basic Configuration

```ts
// trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "<project-ref>",
  dirs: ["./trigger"],
  runtime: "node", // "node", "node-22", or "bun"
  logLevel: "info",

  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },

  build: {
    extensions: [], // Add extensions here
  },
});
```

## Common Build Extensions

### Prisma

```ts
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  // ...
  build: {
    extensions: [
      prismaExtension({
        schema: "prisma/schema.prisma",
        migrate: true,
        directUrlEnvVarName: "DIRECT_DATABASE_URL",
      }),
    ],
  },
});
```

### Playwright (Browser Automation)

```ts
import { playwright } from "@trigger.dev/build/extensions/playwright";

extensions: [
  playwright({
    browsers: ["chromium"], // or ["chromium", "firefox", "webkit"]
  }),
]
```

### Puppeteer

```ts
import { puppeteer } from "@trigger.dev/build/extensions/puppeteer";

extensions: [puppeteer()]

// Set env var: PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome-stable"
```

### FFmpeg (Media Processing)

```ts
import { ffmpeg } from "@trigger.dev/build/extensions/core";

extensions: [
  ffmpeg({ version: "7" }),
]
// Automatically sets FFMPEG_PATH and FFPROBE_PATH
```

### Python

```ts
import { pythonExtension } from "@trigger.dev/build/extensions/python";

extensions: [
  pythonExtension({
    scripts: ["./python/**/*.py"],
    requirementsFile: "./requirements.txt",
    devPythonBinaryPath: ".venv/bin/python",
  }),
]

// Usage in tasks:
const result = await python.runScript("./python/process.py", ["arg1"]);
```

### System Packages (apt-get)

```ts
import { aptGet } from "@trigger.dev/build/extensions/core";

extensions: [
  aptGet({
    packages: ["imagemagick", "curl"],
  }),
]
```

### Additional Files

```ts
import { additionalFiles } from "@trigger.dev/build/extensions/core";

extensions: [
  additionalFiles({
    files: ["./assets/**", "./templates/**"],
  }),
]
```

### Environment Variable Sync

```ts
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

extensions: [
  syncEnvVars(async (ctx) => {
    return [
      { name: "API_KEY", value: await getSecret(ctx.environment) },
      { name: "ENV", value: ctx.environment },
    ];
  }),
]
```

## Common Extension Combinations

### Full-Stack Web App

```ts
extensions: [
  prismaExtension({ schema: "prisma/schema.prisma", migrate: true }),
  additionalFiles({ files: ["./assets/**"] }),
  syncEnvVars(async (ctx) => [...envVars]),
]
```

### AI/ML Processing

```ts
extensions: [
  pythonExtension({
    scripts: ["./ai/**/*.py"],
    requirementsFile: "./requirements.txt",
  }),
  ffmpeg({ version: "7" }),
]
```

### Web Scraping

```ts
extensions: [
  playwright({ browsers: ["chromium"] }),
  additionalFiles({ files: ["./selectors.json"] }),
]
```

## Global Lifecycle Hooks

```ts
export default defineConfig({
  // ...
  onStartAttempt: async ({ payload, ctx }) => {
    console.log("Task starting:", ctx.task.id);
  },
  onSuccess: async ({ payload, output, ctx }) => {
    console.log("Task succeeded");
  },
  onFailure: async ({ payload, error, ctx }) => {
    console.error("Task failed:", error);
  },
});
```

## Machine Defaults

```ts
export default defineConfig({
  // ...
  defaultMachine: "medium-1x",
  maxDuration: 300, // seconds
});
```

## Telemetry Integration

```ts
import { PrismaInstrumentation } from "@prisma/instrumentation";

export default defineConfig({
  // ...
  telemetry: {
    instrumentations: [new PrismaInstrumentation()],
  },
});
```

## Best Practices

1. **Pin versions** for reproducible builds
2. **Use `syncEnvVars`** for dynamic secrets
3. **Add native modules** to `build.external` array
4. **Debug with** `--log-level debug --dry-run`

Extensions only affect deployment, not local development.

See `references/config.md` for complete documentation.
