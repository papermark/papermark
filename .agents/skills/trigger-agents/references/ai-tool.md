# ai.tool Integration

Convert Trigger.dev tasks to Vercel AI SDK tools. Let LLMs call your tasks autonomously.

## Basic Usage

```typescript
import { schemaTask, ai } from "@trigger.dev/sdk";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// 1. Define task with schema
const lookupWeather = schemaTask({
  id: "lookup-weather",
  schema: z.object({
    location: z.string().describe("City name"),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }),
  run: async ({ location, units }) => {
    const weather = await fetchWeather(location, units);
    return { temperature: weather.temp, conditions: weather.conditions };
  },
});

// 2. Convert to AI tool
const weatherTool = ai.tool(lookupWeather);

// 3. Use with AI SDK
export const weatherAgent = schemaTask({
  id: "weather-agent",
  schema: z.object({ question: z.string() }),
  run: async ({ question }) => {
    const result = await generateText({
      model: openai("gpt-4o"),
      prompt: question,
      tools: {
        lookupWeather: weatherTool,
      },
    });

    return { answer: result.text };
  },
});
```

---

## Schema Requirements

The task **must** use `schemaTask` with a Zod schema:

```typescript
// ✅ Works - has schema
const myTask = schemaTask({
  id: "my-task",
  schema: z.object({
    query: z.string(),
  }),
  run: async (payload) => { ... },
});

// ❌ Won't work - no schema
const myTask = task({
  id: "my-task",
  run: async (payload: { query: string }) => { ... },
});
```

**Supported schema libraries:**
- Zod
- ArkType
- Any schema with `.toJsonSchema()` method

---

## Tool Result Customization

Customize how results are sent back to the LLM:

```typescript
const searchTool = ai.tool(searchDatabase, {
  experimental_toToolResultContent: (result) => {
    // Return structured content for the LLM
    return [
      {
        type: "text",
        text: `Found ${result.count} results:\n${result.items.map(i => i.title).join("\n")}`,
      },
    ];
  },
});
```

---

## Accessing Tool Options

Get execution context inside the task:

```typescript
const myToolTask = schemaTask({
  id: "my-tool-task",
  schema: z.object({ input: z.string() }),
  run: async (payload) => {
    // Access AI SDK tool execution options
    const toolOptions = ai.currentToolOptions();

    console.log(toolOptions);
    // { toolCallId: "...", messages: [...], ... }

    return processInput(payload.input);
  },
});
```

---

## Multiple Tools

```typescript
const searchTool = ai.tool(searchDatabase);
const calculateTool = ai.tool(calculate);
const summarizeTool = ai.tool(summarize);

export const agentTask = schemaTask({
  id: "agent",
  schema: z.object({ task: z.string() }),
  run: async ({ task }) => {
    const result = await generateText({
      model: openai("gpt-4o"),
      prompt: task,
      tools: {
        search: searchTool,
        calculate: calculateTool,
        summarize: summarizeTool,
      },
      maxSteps: 10,  // Allow multiple tool calls
    });

    return { result: result.text };
  },
});
```

---

## With Tool Choice

```typescript
const result = await generateText({
  model: openai("gpt-4o"),
  prompt: "What's the weather in Tokyo?",
  tools: {
    weather: weatherTool,
    news: newsTool,
  },
  toolChoice: "required",  // Force tool use
  // or: toolChoice: { type: "tool", toolName: "weather" }
});
```

---

## Description from Schema

Add descriptions for better LLM understanding:

```typescript
const searchTask = schemaTask({
  id: "search-database",
  description: "Search the product database for items matching a query",
  schema: z.object({
    query: z.string().describe("Search terms"),
    limit: z.number().min(1).max(100).describe("Max results to return"),
    category: z.enum(["electronics", "clothing", "books"]).optional()
      .describe("Filter by product category"),
  }),
  run: async (payload) => { ... },
});
```

---

## Common Pattern: Research Agent

```typescript
const webSearch = schemaTask({
  id: "web-search",
  schema: z.object({
    query: z.string(),
    maxResults: z.number().default(5),
  }),
  run: async ({ query, maxResults }) => {
    return await searchWeb(query, maxResults);
  },
});

const readUrl = schemaTask({
  id: "read-url",
  schema: z.object({
    url: z.string().url(),
  }),
  run: async ({ url }) => {
    return await fetchAndParse(url);
  },
});

export const researchAgent = schemaTask({
  id: "research-agent",
  schema: z.object({ topic: z.string() }),
  run: async ({ topic }) => {
    const result = await generateText({
      model: openai("gpt-4o"),
      system: "Research the topic thoroughly using available tools.",
      prompt: topic,
      tools: {
        search: ai.tool(webSearch),
        read: ai.tool(readUrl),
      },
      maxSteps: 20,
    });

    return { research: result.text };
  },
});
```

---

## Tips

1. **Always use schemaTask** - regular `task` won't work
2. **Add descriptions** - helps LLM understand when to use the tool
3. **Use `.describe()`** - on schema fields for parameter hints
4. **Set maxSteps** - allow multiple tool calls for complex tasks
5. **Customize results** - use `experimental_toToolResultContent` for better LLM context
