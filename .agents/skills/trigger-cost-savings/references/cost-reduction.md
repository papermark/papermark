# Cost Reduction Strategies

Detailed strategies for reducing Trigger.dev spend. For the latest version, fetch:
https://trigger.dev/docs/how-to-reduce-your-spend

## 1. Monitor Usage

Review your usage dashboard regularly to identify:
- Most expensive tasks (by total compute time)
- Run counts and daily spikes
- Failure rates and wasted retries

## 2. Configure Billing Alerts

Set up alerts in the Trigger.dev dashboard:
- **Standard alerts**: Notifications at 75%, 90%, 100%, 200%, 500% of budget
- **Spike alerts**: Protection at 10x, 20x, 50x, 100x of monthly budget

Keep spike alerts enabled as a safety net against runaway costs.

## 3. Right-Size Machines

Start with the smallest machine and scale only when necessary:

```ts
// Default (small-1x) is right for most tasks
export const apiTask = task({
  id: "call-api",
  // No machine preset needed — defaults to small-1x
  run: async (payload) => {
    const response = await fetch("https://api.example.com/data");
    return response.json();
  },
});

// Only use larger machines for CPU/memory-intensive work
export const imageProcessor = task({
  id: "process-image",
  machine: { preset: "medium-1x" }, // Only if actually needed
  run: async (payload) => {
    // Heavy image processing that needs more RAM
  },
});

// Override machine at trigger time for variable workloads
await imageProcessor.trigger(largePayload, {
  machine: { preset: "large-1x" }, // Larger only for this specific run
});
```

## 4. Use Idempotency Keys

Prevent duplicate execution of expensive operations:

```ts
import { task, idempotencyKeys } from "@trigger.dev/sdk";

export const expensiveTask = task({
  id: "expensive-operation",
  run: async (payload: { orderId: string }) => {
    const key = await idempotencyKeys.create(`order-${payload.orderId}`);

    // This won't re-execute if triggered again with same key
    await costlyChildTask.trigger(payload, {
      idempotencyKey: key,
      idempotencyKeyTTL: "24h",
    });
  },
});
```

## 5. Parallelize Within Tasks

Consolidate multiple async operations into single tasks instead of spawning many:

```ts
// Expensive: 3 separate task runs
await taskA.triggerAndWait(data);
await taskB.triggerAndWait(data);
await taskC.triggerAndWait(data);

// Cheaper: single task with parallel I/O (when work is I/O-bound)
export const combinedTask = task({
  id: "combined-api-calls",
  run: async (payload) => {
    const [a, b, c] = await Promise.all([
      fetch("https://api-a.com"),
      fetch("https://api-b.com"),
      fetch("https://api-c.com"),
    ]);
    return { a: await a.json(), b: await b.json(), c: await c.json() };
  },
});
```

Note: Only use `Promise.all` for regular async operations (fetch, DB queries), NOT for `triggerAndWait()` or `wait.*` calls.

## 6. Optimize Retries

Reduce wasted compute from retries:

```ts
import { task, AbortTaskRunError } from "@trigger.dev/sdk";

export const smartRetryTask = task({
  id: "smart-retry",
  retry: {
    maxAttempts: 3, // Not 10 — be realistic
  },
  catchError: async ({ error }) => {
    // Don't retry known permanent failures
    if (error.message?.includes("NOT_FOUND")) {
      throw new AbortTaskRunError("Resource not found — won't retry");
    }
    if (error.message?.includes("UNAUTHORIZED")) {
      throw new AbortTaskRunError("Auth failed — won't retry");
    }
    // Only retry transient errors
  },
  run: async (payload) => {
    // task logic
  },
});
```

## 7. Set maxDuration

Prevent runaway tasks from consuming unlimited compute:

```ts
export const boundedTask = task({
  id: "bounded-task",
  maxDuration: 300, // 5 minutes max
  run: async (payload) => {
    // If this takes longer than 5 minutes, it's killed
  },
});
```

## 8. Use Waitpoints Instead of Polling

Waits > 5 seconds are checkpointed and free:

```ts
// Expensive: polling loop burns compute
export const pollingTask = task({
  id: "polling-bad",
  run: async (payload) => {
    while (true) {
      const status = await checkStatus(payload.id);
      if (status === "ready") break;
      await new Promise((r) => setTimeout(r, 5000)); // WASTES compute
    }
  },
});

// Free: checkpointed wait
import { wait } from "@trigger.dev/sdk";

export const waitTask = task({
  id: "wait-good",
  run: async (payload) => {
    await wait.for({ minutes: 5 }); // FREE — checkpointed
    const status = await checkStatus(payload.id);
    if (status !== "ready") {
      await wait.for({ minutes: 5 }); // Still free
    }
  },
});
```

## 9. Debounce High-Frequency Triggers

Consolidate bursts into single executions:

```ts
// Without debounce: 100 webhook events = 100 task runs
await syncTask.trigger({ userId: "123" });

// With debounce: 100 events in 5s = 1 task run
await syncTask.trigger(
  { userId: "123" },
  {
    debounce: {
      key: "sync-user-123",
      delay: "5s",
      mode: "trailing", // Use latest payload
    },
  }
);
```

## Cost Checklist

Use this checklist when reviewing tasks:

- [ ] Machine preset matches actual resource needs (start with `small-1x`)
- [ ] `maxDuration` is set to a reasonable limit
- [ ] Retry `maxAttempts` is appropriate (not excessive)
- [ ] `AbortTaskRunError` used for known permanent failures
- [ ] Idempotency keys used for expensive/critical operations
- [ ] `wait.for()` used instead of polling loops (with delays > 5s)
- [ ] Debounce configured for high-frequency trigger sources
- [ ] Batch triggering used instead of sequential `triggerAndWait()` loops
- [ ] Scheduled task frequency matches actual business needs
- [ ] Billing alerts configured in dashboard
