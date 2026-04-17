# Human-in-the-Loop with Waitpoints

Pause task execution for human approval, external callbacks, or async events.

## Core API

```typescript
import { wait } from "@trigger.dev/sdk";

// Create a token (pauses execution point)
const token = await wait.createToken({
  timeout: "10m",  // "1h", "1d", etc.
});

// Wait for completion (blocks until resolved)
const result = await wait.forToken<ApprovalPayload>(token.id);

if (result.ok) {
  console.log(result.output);  // Typed as ApprovalPayload
} else {
  console.log("Timed out:", result.error);
}
```

---

## Complete Pattern: Slack Approval

```typescript
import { task, wait } from "@trigger.dev/sdk";

type ApprovalToken = {
  approved: boolean;
  selectedOption: "optionA" | "optionB";
  approvedBy: string;
};

export const generateWithApproval = task({
  id: "generate-with-approval",
  maxDuration: 600,  // 10 min to account for human delay
  run: async ({ prompt }) => {
    // 1. Generate options
    const options = await generateOptions(prompt);

    // 2. Create approval token
    const token = await wait.createToken({
      timeout: "1h",
    });

    // 3. Send to Slack/email/webhook
    await sendSlackMessage({
      text: "Please approve one option:",
      options,
      approvalUrl: `${process.env.APP_URL}/approve?token=${token.id}`,
      // Or use: token.url for direct callback
    });

    // 4. Wait for human (task suspends here)
    const result = await wait.forToken<ApprovalToken>(token.id);

    if (!result.ok) {
      throw new Error("Approval timed out");
    }

    // 5. Continue with approved option
    return {
      selected: result.output.selectedOption,
      approvedBy: result.output.approvedBy,
      options,
    };
  },
});
```

---

## Completing Tokens

### From your backend

```typescript
import { wait } from "@trigger.dev/sdk";

// In your approval endpoint
export async function POST(request: Request) {
  const { tokenId, approved, option, userId } = await request.json();

  await wait.completeToken<ApprovalToken>(tokenId, {
    approved,
    selectedOption: option,
    approvedBy: userId,
  });

  return Response.json({ success: true });
}
```

### Via HTTP callback (webhooks)

```typescript
const token = await wait.createToken({ timeout: "10m" });

// token.url is a webhook URL that completes the token
// POST to token.url with JSON body → becomes the output
await externalService.startJob({
  callbackUrl: token.url,  // Service POSTs result here
});

const result = await wait.forToken<ExternalResult>(token.id);
```

### From React (useWaitToken)

```typescript
import { useWaitToken } from "@trigger.dev/react-hooks";

function ApprovalButton({ tokenId, publicToken }) {
  const { complete, isCompleting } = useWaitToken(tokenId, {
    accessToken: publicToken,
  });

  return (
    <button
      onClick={() => complete({ approved: true })}
      disabled={isCompleting}
    >
      Approve
    </button>
  );
}
```

---

## Timeout Handling

```typescript
const result = await wait.forToken<ApprovalToken>(token.id);

if (result.ok) {
  // Human responded in time
  return processApproval(result.output);
} else {
  // Timed out - handle gracefully
  await notifyTimeout();
  return { status: "timeout", defaultAction: "rejected" };
}
```

### Using .unwrap() for cleaner code

```typescript
try {
  const approval = await wait.forToken<ApprovalToken>(token.id).unwrap();
  // approval is directly typed, throws on timeout
  return processApproval(approval);
} catch (error) {
  // Timeout throws here
  return handleTimeout();
}
```

---

## Idempotency

Prevent duplicate tokens for the same workflow:

```typescript
const token = await wait.createToken({
  timeout: "1h",
  idempotencyKey: `review-${workflowId}`,
});
```

---

## Tags for Tracking

```typescript
const token = await wait.createToken({
  timeout: "1h",
  tags: [`workflow:${workflowId}`, `user:${userId}`],
});
```

---

## Public Access Token

For frontend completion without server round-trip:

```typescript
const token = await wait.createToken({ timeout: "10m" });

// Pass to frontend
return {
  tokenId: token.id,
  publicToken: token.publicAccessToken,  // Auto-generated, expires in 1h
};
```

---

## Example: Multi-step Review

```typescript
export const contentPipeline = task({
  id: "content-pipeline",
  run: async ({ content }) => {
    // Step 1: AI generation
    const draft = await generateDraft(content);

    // Step 2: Human review
    const reviewToken = await wait.createToken({ timeout: "24h" });
    await sendForReview(draft, reviewToken.id);
    const review = await wait.forToken<ReviewResult>(reviewToken.id);

    if (!review.ok || !review.output.approved) {
      return { status: "rejected", feedback: review.output?.feedback };
    }

    // Step 3: Final approval
    const publishToken = await wait.createToken({ timeout: "1h" });
    await sendForPublishApproval(draft, publishToken.id);
    const publish = await wait.forToken<PublishResult>(publishToken.id);

    if (!publish.ok || !publish.output.approved) {
      return { status: "not_published" };
    }

    // Step 4: Publish
    await publishContent(draft);
    return { status: "published" };
  },
});
```

---

## Tips

1. **Set realistic timeouts** - account for human response time
2. **Handle timeouts gracefully** - don't throw, provide default behavior
3. **Use idempotencyKey** - prevent duplicate tokens on retries
4. **Increase maxDuration** - task needs enough time for human + processing
5. **Use publicAccessToken** - for direct frontend completion
