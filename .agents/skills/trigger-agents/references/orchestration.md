# Orchestration Patterns

Advanced patterns for `batch.triggerByTaskAndWait` and task coordination.

## Basic Usage

```typescript
import { batch, task } from "@trigger.dev/sdk";

// Trigger different tasks, get typed results
const { runs } = await batch.triggerByTaskAndWait([
  { task: taskA, payload: { foo: "bar" } },  // payload typed to taskA
  { task: taskB, payload: { num: 42 } },     // payload typed to taskB
]);

// Results are typed based on position
if (runs[0].ok) {
  console.log(runs[0].output);  // typed as taskA output
}
```

## Destructured Results

```typescript
const {
  runs: [userRun, postsRun, settingsRun],
} = await batch.triggerByTaskAndWait([
  { task: fetchUser, payload: { id } },
  { task: fetchPosts, payload: { userId: id } },
  { task: fetchSettings, payload: { userId: id } },
]);

// Each run is individually typed
const user = userRun.ok ? userRun.output : null;
const posts = postsRun.ok ? postsRun.output : [];
```

---

## Error Handling Per-Task

```typescript
const { runs } = await batch.triggerByTaskAndWait([
  { task: riskyTask, payload: item1 },
  { task: riskyTask, payload: item2 },
  { task: riskyTask, payload: item3 },
]);

// Individual error handling
const results = runs.map(run => {
  if (run.ok) {
    return { success: true, data: run.output };
  }
  return {
    success: false,
    error: run.error,
    taskId: run.taskIdentifier,
    runId: run.id,
  };
});

// Or throw if any failed
const failed = runs.filter(r => !r.ok);
if (failed.length > 0) {
  throw new Error(`${failed.length} tasks failed`);
}
```

---

## Filtering by Task Identifier

When running mixed task types, filter results by `taskIdentifier`:

```typescript
const { runs } = await batch.triggerByTaskAndWait([
  ...claims.map(c => ({ task: verifySource, payload: c })),
  ...claims.map(c => ({ task: analyzeHistory, payload: c })),
]);

// Filter to specific task results
const verifications = runs
  .filter((r): r is typeof r & { ok: true } =>
    r.ok && r.taskIdentifier === "verify-source"
  )
  .map(r => r.output as SourceVerification);

const analyses = runs
  .filter((r): r is typeof r & { ok: true } =>
    r.ok && r.taskIdentifier === "analyze-history"
  )
  .map(r => r.output as HistoricalAnalysis);
```

---

## Fan-out/Fan-in Pattern

```typescript
export const processItems = task({
  id: "process-items",
  run: async ({ items }) => {
    // Fan-out: process all items in parallel
    const { runs } = await batch.triggerByTaskAndWait(
      items.map(item => ({ task: processItem, payload: item }))
    );

    // Fan-in: aggregate results
    const successful = runs.filter(r => r.ok).map(r => r.output);
    const failed = runs.filter(r => !r.ok);

    return {
      processed: successful.length,
      failed: failed.length,
      results: successful,
      errors: failed.map(f => ({ id: f.id, error: f.error })),
    };
  },
});
```

---

## Sequential Then Parallel

```typescript
export const orchestrator = task({
  id: "orchestrator",
  run: async ({ input }) => {
    // Step 1: Sequential preprocessing
    const { runs: [prepResult] } = await batch.triggerByTaskAndWait([
      { task: preprocess, payload: { input } },
    ]);

    if (!prepResult.ok) {
      throw new Error(`Preprocessing failed: ${prepResult.error}`);
    }

    const items = prepResult.output;

    // Step 2: Parallel processing
    const { runs } = await batch.triggerByTaskAndWait(
      items.map(item => ({ task: processItem, payload: item }))
    );

    // Step 3: Sequential aggregation
    const { runs: [aggResult] } = await batch.triggerByTaskAndWait([
      { task: aggregate, payload: { results: runs.filter(r => r.ok).map(r => r.output) } },
    ]);

    return aggResult.ok ? aggResult.output : null;
  },
});
```

---

## Same Task, Multiple Items

For batch processing the same task:

```typescript
// Using batchTriggerAndWait (single task type)
const results = await processItem.batchTriggerAndWait([
  { payload: item1 },
  { payload: item2 },
  { payload: item3 },
]);

// Equivalent using batch.triggerByTaskAndWait
const { runs } = await batch.triggerByTaskAndWait([
  { task: processItem, payload: item1 },
  { task: processItem, payload: item2 },
  { task: processItem, payload: item3 },
]);
```

---

## Concurrency Control

Control parallelism via queue settings on child tasks:

```typescript
import { queue, task } from "@trigger.dev/sdk";

const rateLimitedQueue = queue({
  name: "api-calls",
  concurrencyLimit: 5,  // Max 5 concurrent
});

export const callExternalApi = task({
  id: "call-external-api",
  queue: rateLimitedQueue,
  run: async (payload) => {
    // Rate limited to 5 concurrent executions
    return fetch(payload.url);
  },
});

// Parent can batch trigger many - queue handles concurrency
export const batchProcess = task({
  id: "batch-process",
  run: async ({ urls }) => {
    // Will queue up, respecting concurrencyLimit: 5
    return callExternalApi.batchTriggerAndWait(
      urls.map(url => ({ payload: { url } }))
    );
  },
});
```

---

## Streaming Batch Items

For large batches, stream items instead of loading all at once:

```typescript
import { batch } from "@trigger.dev/sdk";

// Generator function for items
async function* generateItems() {
  for await (const record of database.cursor()) {
    yield { task: processRecord, payload: record };
  }
}

// Stream to batch trigger
const { runs } = await batch.triggerByTaskAndWait(generateItems());
```

---

## Tips

1. **Use destructuring** for known task counts - cleaner code
2. **Filter by taskIdentifier** when mixing task types
3. **Check `.ok`** before accessing `.output`
4. **Control concurrency** on child task queues, not in orchestrator
5. **Avoid parallel waits** - use batch methods, not Promise.all with triggerAndWait
