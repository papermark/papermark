import { render, toPlainText } from "react-email";
import { nanoid } from "nanoid";

import prisma from "@/lib/prisma";
import { resend } from "@/lib/resend";
import { log } from "@/lib/utils";
import { generateUnsubscribeUrl } from "@/lib/utils/unsubscribe";

import YearInReviewEmail from "@/components/emails/year-in-review-papermark";

const BATCH_SIZE = 100; // Maximum number of emails Resend supports in one batch
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_DELAY = 10000; // 10 seconds

type YearReviewStats = {
  totalDocuments: number;
  totalLinks: number;
  totalViews: number;
  mostViewedDocument: {
    documentId: string;
    documentName: string;
    viewCount: number;
  };
  mostActiveMonth: {
    month: string;
    viewCount: number;
  };
  totalDuration: number;
  uniqueCountries: string[];
  sharerPercentile: number;
};

type EmailWithMetadata = {
  email: {
    from: string;
    to: string;
    subject: string;
    react: React.ReactElement;
    text: string;
    headers: {
      "X-Entity-Ref-ID": string;
      "List-Unsubscribe": string;
    };
  };
  jobId: string;
  teamId: string;
  userId: string;
};

function msToMinutes(ms: number): number {
  return Math.ceil(ms / 60000);
}

export async function processEmailQueue() {
  if (!resend) {
    console.log("❌ Resend client not initialized");
    return;
  }

  const jobs = await prisma.yearInReview.findMany({
    where: {
      AND: [
        { status: "pending" },
        { attempts: { lt: MAX_ATTEMPTS } },
        { stats: { path: ["totalViews"], gt: 1 } },
      ],
    },
    take: BATCH_SIZE,
    orderBy: { createdAt: "asc" },
  });

  if (jobs.length === 0) {
    console.log("ℹ️ No jobs to process");
    return;
  }

  console.log(
    `📬 Processing ${jobs.length} jobs:`,
    jobs.map((job) => job.id),
  );

  try {
    // Fetch team data for all jobs
    const teamsData = await prisma.$transaction(async (tx) => {
      return Promise.all(
        jobs.map(async (job) => {
          const team = await tx.team.findUnique({
            where: { id: job.teamId },
            include: {
              users: {
                where: { role: { in: ["ADMIN", "MANAGER"] } },
                include: {
                  user: {
                    select: {
                      email: true,
                    },
                  },
                },
              },
            },
          });

          return {
            job,
            team,
          };
        }),
      );
    });
    console.log(`📋 Found ${teamsData.length} teams with valid data`);

    // Prepare batch of emails
    const emailsWithMetadata: EmailWithMetadata[] = (
      await Promise.all(
        teamsData
          .filter(({ team }) => team !== null) // Filter out teams that weren't found
          .flatMap(async ({ job, team }) => {
            const stats = job.stats as YearReviewStats;

            return Promise.all(
              team!.users
                .filter((userTeam) => userTeam.user.email)
                .map(async (userTeam) => {
                  const unsubscribeUrl = generateUnsubscribeUrl({
                    viewerId: userTeam.userId,
                    teamId: team!.id,
                  });

                  const react = YearInReviewEmail({
                    year: 2024,
                    minutesSpentOnDocs: msToMinutes(stats.totalDuration),
                    uploadedDocuments: stats.totalDocuments,
                    sharedLinks: stats.totalLinks,
                    receivedViews: stats.totalViews,
                    topDocumentName: stats.mostViewedDocument.documentName,
                    topDocumentViews: stats.mostViewedDocument.viewCount,
                    mostActiveMonth: stats.mostActiveMonth.month,
                    mostActiveMonthViews: stats.mostActiveMonth.viewCount,
                    sharerPercentile: stats.sharerPercentile,
                    viewingLocations: stats.uniqueCountries,
                    unsubscribeUrl,
                  });

                  const html = await render(react);
                  const plainText = toPlainText(html);

                  return {
                    email: {
                      from: "Papermark <system@papermark.com>",
                      to: userTeam.user.email || "delivered@resend.dev",
                      subject: "2024 in Review: Your Year with Papermark",
                      react,
                      text: plainText,
                      headers: {
                        "X-Entity-Ref-ID": nanoid(),
                        "List-Unsubscribe": unsubscribeUrl,
                      },
                    },
                    jobId: job.id,
                    teamId: team!.id,
                    userId: userTeam.userId,
                  };
                }),
            );
          }),
      )
    ).flat();
    console.log(`📧 Preparing to send ${emailsWithMetadata.length} emails`);

    // Process emails in batches
    for (let i = 0; i < emailsWithMetadata.length; i += BATCH_SIZE) {
      const batch = emailsWithMetadata.slice(i, i + BATCH_SIZE);
      console.log(
        `\n🚀 Sending batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(emailsWithMetadata.length / BATCH_SIZE)}`,
      );
      console.log(
        `📨 Recipients:`,
        batch.map((b) => b.email.to),
      );

      try {
        const emailBatch = batch.map((item) => item.email);
        const { data, error } = await resend.batch.send(emailBatch);

        if (error) {
          console.log(`❌ Batch send failed:`, error);
        } else {
          console.log(`✅ Batch sent successfully:`, {
            sent: data?.data.length,
            total: batch.length,
          });
        }

        // Track success/failure counts by job
        const jobCounts = new Map<
          string,
          { success: number; failed: number }
        >();

        // Match results with metadata using array indices
        if (data) {
          data.data.forEach((result, index) => {
            const metadata = batch[index];
            const counts = jobCounts.get(metadata.jobId) || {
              success: 0,
              failed: 0,
            };
            counts.success++;
            jobCounts.set(metadata.jobId, counts);
          });
        } else if (error) {
          batch.forEach((metadata) => {
            const counts = jobCounts.get(metadata.jobId) || {
              success: 0,
              failed: 0,
            };
            counts.failed++;
            log({
              message: `Failed to send email to ${metadata.email.to}: ${error.message}`,
              type: "error",
              mention: true,
            });
            jobCounts.set(metadata.jobId, counts);
          });
        }

        // Update job statuses
        for (const [jobId, counts] of jobCounts.entries()) {
          const totalExpectedEmails =
            teamsData
              .find(({ job }) => job.id === jobId)
              ?.team?.users.filter((ut) => ut.user.email).length || 0;

          const job = jobs.find((j) => j.id === jobId);
          if (!job) continue;

          const status =
            counts.failed === 0 && counts.success === totalExpectedEmails
              ? "completed"
              : job.attempts >= MAX_ATTEMPTS - 1
                ? "failed"
                : "pending";

          await prisma.yearInReview.update({
            where: { id: jobId },
            data: {
              status,
              error:
                counts.failed > 0
                  ? `Failed to send ${counts.failed} out of ${totalExpectedEmails} emails`
                  : null,
            },
          });
        }

        // Respect rate limit between batches
        if (i + BATCH_SIZE < emailsWithMetadata.length) {
          console.log(
            `⏳ Waiting ${RATE_LIMIT_DELAY / 1000}s before next batch...`,
          );
          await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
        }
      } catch (error) {
        console.log(`❌ Error processing batch:`, error);
      }
    }
  } catch (error) {
    console.log(`❌ Fatal error processing email queue:`, error);
  }
}
