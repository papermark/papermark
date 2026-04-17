---
name: trigger-cost-savings
description: Analyze Trigger.dev tasks, schedules, and runs for cost optimization opportunities. Use when asked to reduce spend, optimize costs, audit usage, right-size machines, or review task efficiency. Requires Trigger.dev MCP tools for run analysis.
---

# Trigger.dev Cost Savings Analysis

Analyze task runs and configurations to find cost reduction opportunities.

## Prerequisites: MCP Tools

This skill requires the **Trigger.dev MCP server** to analyze live run data.

### Check MCP availability

Before analysis, verify these MCP tools are available:
- `list_runs` — list runs with filters (status, task, time period, machine size)
- `get_run_details` — get run logs, duration, and status
- `get_current_worker` — get registered tasks and their configurations

If these tools are **not available**, instruct the user:

```
To analyze your runs, you need the Trigger.dev MCP server installed.

Run this command to install it:

  npx trigger.dev@latest install-mcp

This launches an interactive wizard that configures the MCP server for your AI client.
```

Do NOT proceed with run analysis without MCP tools. You can still review source code for static issues (see Static Analysis below).

### Load latest cost reduction documentation

Before giving recommendations, fetch the latest guidance:

```
WebFetch: https://trigger.dev/docs/how-to-reduce-your-spend
```

Use the fetched content to ensure recommendations are current. If the fetch fails, fall back to the reference documentation in `references/cost-reduction.md`.

## Analysis Workflow

### Step 1: Static Analysis (source code)

Scan task files in the project for these issues:

1. **Oversized machines** — tasks using `large-1x` or `large-2x` without clear need
2. **Missing `maxDuration`** — tasks without execution time limits (runaway cost risk)
3. **Excessive retries** — `maxAttempts` > 5 without `AbortTaskRunError` for known failures
4. **Missing debounce** — high-frequency triggers without debounce configuration
5. **Missing idempotency** — payment/critical tasks without idempotency keys
6. **Polling instead of waits** — `setTimeout`/`setInterval`/sleep loops instead of `wait.for()`
7. **Short waits** — `wait.for()` with < 5 seconds (not checkpointed, wastes compute)
8. **Sequential instead of batch** — multiple `triggerAndWait()` calls that could use `batchTriggerAndWait()`
9. **Over-scheduled crons** — schedules running more frequently than necessary

### Step 2: Run Analysis (requires MCP tools)

Use MCP tools to analyze actual usage patterns:

#### 2a. Identify expensive tasks

```
list_runs with filters:
- period: "30d" or "7d"
- Sort by duration or cost
- Check across different task IDs
```

Look for:
- Tasks with high total compute time (duration x run count)
- Tasks with high failure rates (wasted retries)
- Tasks running on large machines with short durations (over-provisioned)

#### 2b. Analyze failure patterns

```
list_runs with status: "FAILED" or "CRASHED"
```

For high-failure tasks:
- Check if failures are retryable (transient) vs permanent
- Suggest `AbortTaskRunError` for known non-retryable errors
- Calculate wasted compute from failed retries

#### 2c. Check machine utilization

```
get_run_details for sample runs of each task
```

Compare actual resource usage against machine preset:
- If a task on `large-2x` consistently runs in < 1 second, it's over-provisioned
- If tasks are I/O-bound (API calls, DB queries), they likely don't need large machines

#### 2d. Review schedule frequency

```
get_current_worker to list scheduled tasks and their cron patterns
```

Flag schedules that may be too frequent for their purpose.

### Step 3: Generate Recommendations

Present findings as a prioritized list with estimated impact:

```markdown
## Cost Optimization Report

### High Impact
1. **Right-size `process-images` machine** — Currently `large-2x`, average run 2s.
   Switching to `small-2x` could reduce this task's cost by ~16x.
   ```ts
   machine: { preset: "small-2x" }  // was "large-2x"
   ```

### Medium Impact
2. **Add debounce to `sync-user-data`** — 847 runs/day, often triggered in bursts.
   ```ts
   debounce: { key: `user-${userId}`, delay: "5s" }
   ```

### Low Impact / Best Practices
3. **Add `maxDuration` to `generate-report`** — No timeout configured.
   ```ts
   maxDuration: 300  // 5 minutes
   ```
```

## Machine Preset Costs (relative)

Larger machines cost proportionally more per second of compute:

| Preset | vCPU | RAM | Relative Cost |
|--------|------|-----|---------------|
| micro | 0.25 | 0.25 GB | 0.25x |
| small-1x | 0.5 | 0.5 GB | 1x (baseline) |
| small-2x | 1 | 1 GB | 2x |
| medium-1x | 1 | 2 GB | 2x |
| medium-2x | 2 | 4 GB | 4x |
| large-1x | 4 | 8 GB | 8x |
| large-2x | 8 | 16 GB | 16x |

## Key Principles

- **Waits > 5 seconds are free** — checkpointed, no compute charge
- **Start small, scale up** — default `small-1x` is right for most tasks
- **I/O-bound tasks don't need big machines** — API calls, DB queries wait on network
- **Debounce saves the most on high-frequency tasks** — consolidates bursts into single runs
- **Idempotency prevents duplicate work** — especially important for expensive operations
- **`AbortTaskRunError` stops wasteful retries** — don't retry permanent failures

See `references/cost-reduction.md` for detailed strategies with code examples.
