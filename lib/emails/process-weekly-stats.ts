import prisma from "@/lib/prisma";
import { getTotalTeamDuration } from "@/lib/tinybird/pipes";
import { log } from "@/lib/utils";

import { sendWeeklyStats } from "./send-weekly-stats";

interface DataroomStats {
  name: string;
  timeSpentMinutes: number;
  completionPercent: number;
  visitorCount: number;
  documentsViewed: number;
}

function getWeekRange(): {
  since: number;
  until: number;
  weekLabel: string;
} {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  // Go back to previous Tuesday (start of the recap week)
  const daysToLastTuesday = ((dayOfWeek + 7 - 2) % 7) || 7;
  const weekEnd = new Date(now);
  weekEnd.setUTCDate(now.getUTCDate() - daysToLastTuesday + 7);
  weekEnd.setUTCHours(0, 0, 0, 0);

  const weekStart = new Date(weekEnd);
  weekStart.setUTCDate(weekEnd.getUTCDate() - 7);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return {
    since: weekStart.getTime(),
    until: weekEnd.getTime(),
    weekLabel: `${fmt(weekStart)} – ${fmt(new Date(weekEnd.getTime() - 1))}, ${weekEnd.getUTCFullYear()}`,
  };
}

export async function processWeeklyStats() {
  const { since, until, weekLabel } = getWeekRange();

  // Find teams with views in the past week
  const teamsWithViews = await prisma.view.groupBy({
    by: ["teamId"],
    where: {
      viewedAt: { gte: new Date(since), lt: new Date(until) },
      teamId: { not: null },
      isArchived: false,
    },
    _count: { id: true },
  });

  const activeTeamIds = teamsWithViews
    .filter((t) => t.teamId !== null && t._count.id > 0)
    .map((t) => t.teamId as string);

  if (activeTeamIds.length === 0) {
    return { processed: 0 };
  }

  let processed = 0;

  for (const teamId of activeTeamIds) {
    try {
      await processTeamWeeklyStats(teamId, since, until, weekLabel);
      processed++;
    } catch (error) {
      await log({
        message: `Failed to process weekly stats for team ${teamId}. Error: ${(error as Error).message}`,
        type: "error",
        mention: false,
      });
    }
  }

  return { processed };
}

async function processTeamWeeklyStats(
  teamId: string,
  since: number,
  until: number,
  weekLabel: string,
) {
  const [team, weekViews, weekDocuments, weekDatarooms] = await Promise.all([
    prisma.team.findUnique({
      where: { id: teamId },
      select: {
        name: true,
        users: {
          where: {
            role: { in: ["ADMIN", "MANAGER"] },
            status: "ACTIVE",
          },
          select: {
            user: { select: { email: true, name: true } },
          },
        },
      },
    }),
    prisma.view.findMany({
      where: {
        teamId,
        viewedAt: { gte: new Date(since), lt: new Date(until) },
        isArchived: false,
        viewType: "DOCUMENT_VIEW",
      },
      select: {
        id: true,
        documentId: true,
        dataroomId: true,
      },
    }),
    prisma.document.findMany({
      where: {
        teamId,
        createdAt: { gte: new Date(since), lt: new Date(until) },
      },
      select: { id: true },
    }),
    prisma.dataroom.findMany({
      where: {
        teamId,
        createdAt: { gte: new Date(since), lt: new Date(until) },
      },
      select: { id: true },
    }),
  ]);

  if (!team) return;

  const hasActivity =
    weekViews.length > 0 ||
    weekDocuments.length > 0 ||
    weekDatarooms.length > 0;

  if (!hasActivity) return;

  const recipients = team.users
    .map((ut) => ({ email: ut.user.email, name: ut.user.name }))
    .filter(
      (r): r is { email: string; name: string | null } => !!r.email,
    );

  if (recipients.length === 0) return;

  // --- Compute stats ---

  // Distinct documents viewed
  const viewedDocIds = [
    ...new Set(weekViews.map((v) => v.documentId).filter(Boolean)),
  ] as string[];
  const documentsViewedCount = viewedDocIds.length;

  // Views per document for "most viewed"
  const docViewCounts = new Map<string, number>();
  for (const v of weekViews) {
    if (v.documentId) {
      docViewCounts.set(v.documentId, (docViewCounts.get(v.documentId) || 0) + 1);
    }
  }

  let mostViewedDocId: string | null = null;
  let mostViewedDocViewCount = 0;
  for (const [docId, count] of docViewCounts) {
    if (count > mostViewedDocViewCount) {
      mostViewedDocViewCount = count;
      mostViewedDocId = docId;
    }
  }

  // Views per dataroom for "most viewed dataroom"
  const dataroomViewCounts = new Map<string, number>();
  for (const v of weekViews) {
    if (v.dataroomId) {
      dataroomViewCounts.set(
        v.dataroomId,
        (dataroomViewCounts.get(v.dataroomId) || 0) + 1,
      );
    }
  }

  let topDataroomId: string | null = null;
  let topDataroomViewCount = 0;
  for (const [drId, count] of dataroomViewCounts) {
    if (count > topDataroomViewCount) {
      topDataroomViewCount = count;
      topDataroomId = drId;
    }
  }

  // Get total duration from Tinybird
  let totalDurationMs = 0;
  if (viewedDocIds.length > 0) {
    try {
      const durationResult = await getTotalTeamDuration({
        documentIds: viewedDocIds.join(","),
        since,
        until,
      });
      totalDurationMs = durationResult.data[0]?.total_duration ?? 0;
    } catch {
      // Tinybird may be unavailable, fall back to 0
    }
  }
  const totalMinutes = Math.round(totalDurationMs / 60000);

  // Completion % of most viewed document
  let mostViewedDocCompletionPercent = 0;
  let mostViewedDocName = "Unknown";
  if (mostViewedDocId) {
    const docWithVersion = await prisma.document.findUnique({
      where: { id: mostViewedDocId },
      select: {
        name: true,
        versions: {
          where: { isPrimary: true },
          select: { numPages: true },
          take: 1,
        },
      },
    });

    if (docWithVersion) {
      mostViewedDocName = docWithVersion.name;
      const numPages = docWithVersion.versions[0]?.numPages;

      if (numPages && numPages > 0) {
        // Get the view IDs for this document within this week
        const docViewIds = weekViews
          .filter((v) => v.documentId === mostViewedDocId)
          .map((v) => v.id);

        if (docViewIds.length > 0) {
          try {
            const { getViewCompletionStats } = await import(
              "@/lib/tinybird/pipes"
            );
            const completionResult = await getViewCompletionStats({
              documentId: mostViewedDocId,
              excludedViewIds: "",
              since,
            });

            // Filter to only views in this week, compute average completion
            const relevantCompletions = completionResult.data.filter((c) =>
              docViewIds.includes(c.viewId),
            );

            if (relevantCompletions.length > 0) {
              const avgPagesViewed =
                relevantCompletions.reduce(
                  (sum, c) => sum + c.pages_viewed,
                  0,
                ) / relevantCompletions.length;
              mostViewedDocCompletionPercent = Math.round(
                (avgPagesViewed / numPages) * 100,
              );
              mostViewedDocCompletionPercent = Math.min(
                100,
                mostViewedDocCompletionPercent,
              );
            }
          } catch {
            // Tinybird unavailable
          }
        }
      }
    }
  }

  // Top item (data room or document)
  let topItemName = mostViewedDocName;
  let topItemIsDataroom = false;

  // Build dataroom stats if exists
  let dataroomStats: DataroomStats | null = null;

  if (topDataroomId) {
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: topDataroomId },
      select: {
        name: true,
        documents: {
          select: {
            documentId: true,
            document: {
              select: {
                versions: {
                  where: { isPrimary: true },
                  select: { numPages: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (dataroom) {
      topItemName = dataroom.name;
      topItemIsDataroom = true;

      // Dataroom views this week
      const dataroomViews = weekViews.filter(
        (v) => v.dataroomId === topDataroomId,
      );
      const dataroomViewIds = dataroomViews.map((v) => v.id);

      // Unique visitors (distinct viewerEmail-like identity via view count)
      const drVisitorCount = dataroomViews.length;

      // Distinct documents viewed in this dataroom
      const drDocIds = [
        ...new Set(
          dataroomViews.map((v) => v.documentId).filter(Boolean),
        ),
      ];

      // Duration for dataroom
      let drDurationMs = 0;
      if (drDocIds.length > 0) {
        try {
          const drDurationResult = await getTotalTeamDuration({
            documentIds: (drDocIds as string[]).join(","),
            since,
            until,
          });
          drDurationMs = drDurationResult.data[0]?.total_duration ?? 0;
        } catch {
          // fallback
        }
      }

      // Completion for dataroom (avg across all doc views in this DR)
      let drCompletionPercent = 0;
      const totalDocPages = dataroom.documents.reduce((sum, dd) => {
        return sum + (dd.document.versions[0]?.numPages ?? 0);
      }, 0);

      if (totalDocPages > 0 && dataroomViewIds.length > 0) {
        try {
          const { getDataroomViewDocumentStats } = await import(
            "@/lib/tinybird/pipes"
          );
          const drStats = await getDataroomViewDocumentStats({
            viewIds: dataroomViewIds.join(","),
          });

          const totalPagesViewed = drStats.data.reduce(
            (sum, s) => sum + s.pages_viewed,
            0,
          );
          drCompletionPercent = Math.min(
            100,
            Math.round((totalPagesViewed / totalDocPages) * 100),
          );
        } catch {
          // fallback
        }
      }

      dataroomStats = {
        name: dataroom.name,
        timeSpentMinutes: Math.round(drDurationMs / 60000),
        completionPercent: drCompletionPercent,
        visitorCount: drVisitorCount,
        documentsViewed: drDocIds.length,
      };
    }
  }

  for (const recipient of recipients) {
    try {
      await sendWeeklyStats({
        to: recipient.email,
        userName: recipient.name ?? recipient.email.split("@")[0],
        teamName: team.name ?? "Your Team",
        weekLabel,
        totalMinutes,
        mostViewedDocCompletionPercent,
        documentsViewedCount,
        topItemName,
        topItemIsDataroom,
        dataroomStats,
      });
    } catch (error) {
      await log({
        message: `Failed to send weekly stats email to ${recipient.email} for team ${teamId}. Error: ${(error as Error).message}`,
        type: "error",
        mention: false,
      });
    }
  }
}
