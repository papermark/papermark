---
name: trigger-realtime
description: Subscribe to Trigger.dev task runs in real-time from frontend and backend. Use when building progress indicators, live dashboards, streaming AI/LLM responses, or React components that display task status.
---

# Trigger.dev Realtime

Subscribe to task runs and stream data in real-time from frontend and backend.

## When to Use

- Building progress indicators for long-running tasks
- Creating live dashboards showing task status
- Streaming AI/LLM responses to the UI
- React components that trigger and monitor tasks
- Waiting for user approval in tasks

## Authentication

### Create Public Access Token (Backend)

```ts
import { auth } from "@trigger.dev/sdk";

// Read-only token for specific runs
const publicToken = await auth.createPublicToken({
  scopes: {
    read: {
      runs: ["run_123"],
      tasks: ["my-task"],
    },
  },
  expirationTime: "1h",
});

// Pass this token to your frontend
```

### Create Trigger Token (for frontend triggering)

```ts
const triggerToken = await auth.createTriggerPublicToken("my-task", {
  expirationTime: "30m",
});
```

## Backend Subscriptions

```ts
import { runs, tasks } from "@trigger.dev/sdk";

// Trigger and subscribe
const handle = await tasks.trigger("my-task", { data: "value" });

for await (const run of runs.subscribeToRun(handle.id)) {
  console.log(`Status: ${run.status}`);
  console.log(`Progress: ${run.metadata?.progress}`);
  
  if (run.status === "COMPLETED") {
    console.log("Output:", run.output);
    break;
  }
}

// Subscribe to tagged runs
for await (const run of runs.subscribeToRunsWithTag("user-123")) {
  console.log(`Run ${run.id}: ${run.status}`);
}

// Subscribe to batch
for await (const run of runs.subscribeToBatch(batchId)) {
  console.log(`Batch run ${run.id}: ${run.status}`);
}
```

## React Hooks

### Installation

```bash
npm add @trigger.dev/react-hooks
```

### Trigger Task from React

```tsx
"use client";
import { useRealtimeTaskTrigger } from "@trigger.dev/react-hooks";
import type { myTask } from "../trigger/tasks";

function TaskTrigger({ accessToken }: { accessToken: string }) {
  const { submit, run, isLoading } = useRealtimeTaskTrigger<typeof myTask>(
    "my-task",
    { accessToken }
  );

  return (
    <div>
      <button 
        onClick={() => submit({ data: "value" })} 
        disabled={isLoading}
      >
        Start Task
      </button>
      
      {run && (
        <div>
          <p>Status: {run.status}</p>
          <p>Progress: {run.metadata?.progress}%</p>
          {run.output && <p>Result: {JSON.stringify(run.output)}</p>}
        </div>
      )}
    </div>
  );
}
```

### Subscribe to Existing Run

```tsx
"use client";
import { useRealtimeRun } from "@trigger.dev/react-hooks";
import type { myTask } from "../trigger/tasks";

function RunStatus({ runId, accessToken }: { runId: string; accessToken: string }) {
  const { run, error } = useRealtimeRun<typeof myTask>(runId, {
    accessToken,
    onComplete: (run) => {
      console.log("Completed:", run.output);
    },
  });

  if (error) return <div>Error: {error.message}</div>;
  if (!run) return <div>Loading...</div>;

  return (
    <div>
      <p>Status: {run.status}</p>
      <p>Progress: {run.metadata?.progress || 0}%</p>
    </div>
  );
}
```

### Subscribe to Tagged Runs

```tsx
"use client";
import { useRealtimeRunsWithTag } from "@trigger.dev/react-hooks";

function UserTasks({ userId, accessToken }: { userId: string; accessToken: string }) {
  const { runs } = useRealtimeRunsWithTag(`user-${userId}`, { accessToken });

  return (
    <ul>
      {runs.map((run) => (
        <li key={run.id}>{run.id}: {run.status}</li>
      ))}
    </ul>
  );
}
```

## Realtime Streams (AI/LLM)

### Define Stream (shared location)

```ts
// trigger/streams.ts
import { streams } from "@trigger.dev/sdk";

export const aiStream = streams.define<string>({
  id: "ai-output",
});
```

### Pipe Stream in Task

```ts
import { task } from "@trigger.dev/sdk";
import { aiStream } from "./streams";

export const streamingTask = task({
  id: "streaming-task",
  run: async (payload: { prompt: string }) => {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: payload.prompt }],
      stream: true,
    });

    const { waitUntilComplete } = aiStream.pipe(completion);
    await waitUntilComplete();
  },
});
```

### Read Stream in React

```tsx
"use client";
import { useRealtimeStream } from "@trigger.dev/react-hooks";
import { aiStream } from "../trigger/streams";

function AIResponse({ runId, accessToken }: { runId: string; accessToken: string }) {
  const { parts, error } = useRealtimeStream(aiStream, runId, {
    accessToken,
    throttleInMs: 50,
  });

  if (error) return <div>Error: {error.message}</div>;
  if (!parts) return <div>Waiting for response...</div>;

  return <div>{parts.join("")}</div>;
}
```

## Wait Tokens (Human-in-the-loop)

### In Task

```ts
import { task, wait } from "@trigger.dev/sdk";

export const approvalTask = task({
  id: "approval-task",
  run: async (payload) => {
    // Process initial data
    const processed = await processData(payload);

    // Wait for human approval
    const approval = await wait.forToken<{ approved: boolean }>({
      token: `approval-${payload.id}`,
      timeoutInSeconds: 86400, // 24 hours
    });

    if (approval.approved) {
      return await finalizeData(processed);
    }
    
    throw new Error("Not approved");
  },
});
```

### Complete Token from React

```tsx
"use client";
import { useWaitToken } from "@trigger.dev/react-hooks";

function ApprovalButton({ tokenId, accessToken }: { tokenId: string; accessToken: string }) {
  const { complete } = useWaitToken(tokenId, { accessToken });

  return (
    <div>
      <button onClick={() => complete({ approved: true })}>
        Approve
      </button>
      <button onClick={() => complete({ approved: false })}>
        Reject
      </button>
    </div>
  );
}
```

## Run Object Properties

| Property | Description |
|----------|-------------|
| `id` | Unique run identifier |
| `status` | `QUEUED`, `EXECUTING`, `COMPLETED`, `FAILED`, `CANCELED` |
| `payload` | Task input (typed) |
| `output` | Task result (typed, when completed) |
| `metadata` | Real-time updatable data |
| `createdAt` | Start timestamp |
| `costInCents` | Execution cost |

## Best Practices

1. **Scope tokens narrowly** — only grant necessary permissions
2. **Set expiration times** — don't use long-lived tokens
3. **Use typed hooks** — pass task types for proper inference
4. **Handle errors** — always check for errors in hooks
5. **Throttle streams** — use `throttleInMs` to control re-renders

See `references/realtime.md` for complete documentation.
