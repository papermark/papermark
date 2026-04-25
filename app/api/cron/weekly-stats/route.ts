import { NextResponse } from "next/server";

import { receiver } from "@/lib/cron";
import { processWeeklyStats } from "@/lib/emails/process-weekly-stats";
import { log } from "@/lib/utils";

// Runs weekly on Tuesday at 9 AM UTC (0 9 * * 2)
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  if (process.env.VERCEL === "1") {
    const isValid = await receiver.verify({
      signature: req.headers.get("Upstash-Signature") || "",
      body: JSON.stringify(body),
    });
    if (!isValid) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    const result = await processWeeklyStats();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    await log({
      message: `Weekly stats email cron failed. \n\nError: ${(error as Error).message}`,
      type: "cron",
      mention: true,
    });
    return NextResponse.json({ error: (error as Error).message });
  }
}
