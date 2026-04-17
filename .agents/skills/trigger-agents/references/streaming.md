# Realtime Streams

Stream data from tasks to your frontend in real-time. Perfect for AI completions, progress updates, and live status.

## Define Streams

Create typed stream definitions in a shared file:

```typescript
// trigger/streams.ts
import { streams } from "@trigger.dev/sdk";

// Define with type and unique ID
export const progressStream = streams.define<string>({
  id: "progress",
});

export const aiOutputStream = streams.define<string>({
  id: "ai-output",
});

// Export type for frontend
export type STREAMS = typeof progressStream | typeof aiOutputStream;
```

---

## Emit from Tasks

### Basic emit

```typescript
import { task } from "@trigger.dev/sdk";
import { progressStream } from "./streams";

export const processItems = task({
  id: "process-items",
  run: async ({ items }) => {
    for (const [i, item] of items.entries()) {
      await processItem(item);

      // Emit progress
      progressStream.append(
        JSON.stringify({
          current: i + 1,
          total: items.length,
          status: `Processing ${item.name}`,
        })
      );
    }

    return { processed: items.length };
  },
});
```

### Stream AI completion

```typescript
import { task } from "@trigger.dev/sdk";
import { streamText } from "ai";
import { aiOutputStream } from "./streams";

export const generateText = task({
  id: "generate-text",
  run: async ({ prompt }) => {
    const result = streamText({
      model: openai("gpt-4o"),
      prompt,
    });

    // Pipe AI stream to Trigger stream
    for await (const chunk of result.textStream) {
      aiOutputStream.append(chunk);
    }

    return { text: await result.text };
  },
});
```

---

## Child → Parent Streaming

When child tasks need to emit to the parent's stream:

```typescript
// Child task
export const workerTask = task({
  id: "worker",
  run: async ({ item }) => {
    const result = await processItem(item);

    // Emit to PARENT's stream, not this task's
    progressStream.append(
      JSON.stringify({ item: item.id, status: "done" }),
      { target: "parent" }
    );

    return result;
  },
});

// Parent task - frontend subscribes to this run
export const orchestrator = task({
  id: "orchestrator",
  run: async ({ items }) => {
    // Child emits bubble up to this task's stream
    return workerTask.batchTriggerAndWait(
      items.map(item => ({ payload: { item } }))
    );
  },
});
```

---

## Frontend Subscription

### Using useRealtimeStream (Recommended)

```tsx
import { useRealtimeStream } from "@trigger.dev/react-hooks";
import type { progressStream } from "@/trigger/streams";

function Progress({ runId, accessToken }: { runId: string; accessToken: string }) {
  const { data } = useRealtimeStream<typeof progressStream>(runId, {
    accessToken,
    stream: "progress",
  });

  if (!data) return <div>Waiting...</div>;

  // data is array of emitted values
  const latest = data[data.length - 1];
  const progress = JSON.parse(latest);

  return (
    <div>
      {progress.current} / {progress.total}: {progress.status}
    </div>
  );
}
```

### Using useRealtimeRunWithStreams

```tsx
import { useRealtimeRunWithStreams } from "@trigger.dev/react-hooks";
import type { processItems, STREAMS } from "@/trigger/tasks";

function TaskProgress({ runId, accessToken }: Props) {
  const { run, streams } = useRealtimeRunWithStreams<typeof processItems, STREAMS>(
    runId,
    { accessToken }
  );

  const progressUpdates = streams.progress ?? [];
  const latest = progressUpdates[progressUpdates.length - 1];

  return (
    <div>
      <p>Status: {run?.status}</p>
      {latest && <p>Progress: {latest}</p>}
    </div>
  );
}
```

---

## Backend Consumption

Read streams from your backend:

```typescript
import { aiOutputStream } from "./trigger/streams";

async function consumeStream(runId: string) {
  const stream = await aiOutputStream.read(runId, {
    timeoutInSeconds: 120,
  });

  let fullText = "";
  for await (const chunk of stream) {
    fullText += chunk;
    console.log("Received:", chunk);
  }

  return fullText;
}
```

---

## JSON Serialization Pattern

Streams serialize as strings. For objects, use JSON:

```typescript
// Define helper functions
export function emitProgress(update: ProgressUpdate, options?: { target: "parent" }) {
  progressStream.append(JSON.stringify(update), options);
}

// Parse on frontend
const updates = streams.progress?.map(s => JSON.parse(s) as ProgressUpdate) ?? [];
```

---

## Throttling Frontend Updates

Prevent excessive re-renders:

```tsx
const { data } = useRealtimeStream<typeof progressStream>(runId, {
  accessToken,
  stream: "progress",
  throttleInMs: 100,  // Max 10 updates/second
});
```

---

## AI SDK Tool Calls

Stream tool calls and results:

```tsx
const { streams } = useRealtimeRunWithStreams<typeof aiTask, STREAMS>(runId, {
  accessToken,
});

// streams.openai is TextStreamPart[]
const toolCalls = streams.openai?.filter(s => s.type === "tool-call") ?? [];
const toolResults = streams.openai?.filter(s => s.type === "tool-result") ?? [];
const textDeltas = streams.openai?.filter(s => s.type === "text-delta") ?? [];

const fullText = textDeltas.map(d => d.textDelta).join("");
```

---

## Tips

1. **Use streams.define()** - always define in shared file for type safety
2. **JSON stringify objects** - streams are strings internally
3. **Use `{ target: "parent" }`** - for child-to-parent bubbling
4. **Throttle on frontend** - prevent excessive re-renders
5. **Set appropriate timeouts** - AI completions may need longer waits
