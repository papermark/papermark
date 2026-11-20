import { NextApiRequest, NextApiResponse } from "next";

import { ViewType } from "@prisma/client";

import { getDataroomSessionByLinkIdInPagesRouter } from "@/lib/auth/dataroom-auth";
import prisma from "@/lib/prisma";
import { downloadJobStore } from "@/lib/redis-download-job-store";
import { bulkDownloadTask } from "@/lib/trigger/bulk-download";
import { getIpAddress } from "@/lib/utils/ip";

export const config = {
  // Lightweight handler: validate access + create job + trigger task. The
  // heavy folder/document/permission queries and view inserts run inside the
  // trigger task so the viewer never sees a request timeout.
  maxDuration: 60,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { linkId, emailNotification } = req.body as {
    linkId: string;
    emailNotification?: boolean;
  };

  if (typeof linkId !== "string" || !linkId.trim()) {
    return res.status(400).json({ error: "linkId is required" });
  }

  try {
    const session = await getDataroomSessionByLinkIdInPagesRouter(req, linkId);
    if (!session) {
      return res.status(401).json({ error: "Session required to download" });
    }

    const view = await prisma.view.findUnique({
      where: {
        id: session.viewId,
        linkId: linkId,
        viewType: { equals: ViewType.DATAROOM_VIEW },
      },
      select: {
        id: true,
        viewedAt: true,
        viewerEmail: true,
        viewerId: true,
        verified: true,
        link: {
          select: {
            allowDownload: true,
            expiresAt: true,
            isArchived: true,
            deletedAt: true,
            enableWatermark: true,
            watermarkConfig: true,
            name: true,
            permissionGroupId: true,
          },
        },
        groupId: true,
        dataroom: {
          select: {
            id: true,
            name: true,
            teamId: true,
            allowBulkDownload: true,
          },
        },
      },
    });

    if (!view) {
      return res.status(404).json({ error: "Error downloading" });
    }

    const dataroomId = view.dataroom?.id;
    if (!dataroomId || session.dataroomId !== dataroomId) {
      return res.status(403).json({ error: "Error downloading" });
    }

    if (emailNotification) {
      if (!view.viewerEmail) {
        return res.status(400).json({
          error:
            "Email is required to receive download notifications. Enter your email in the dataroom.",
        });
      }
      if (!session.verified) {
        return res.status(403).json({
          error:
            "Verify your email with the one-time code to receive a notification when the download is ready.",
        });
      }
    }

    if (!view.link.allowDownload) {
      return res.status(403).json({ error: "Error downloading" });
    }

    if (view.link.isArchived) {
      return res.status(403).json({ error: "Error downloading" });
    }

    if (view.link.deletedAt) {
      return res.status(403).json({ error: "Error downloading" });
    }

    if (view.link.expiresAt && view.link.expiresAt < new Date()) {
      return res.status(403).json({ error: "Error downloading" });
    }

    if (!view.dataroom) {
      return res.status(404).json({ error: "Error downloading" });
    }

    if (!view.dataroom.allowBulkDownload) {
      return res
        .status(403)
        .json({ error: "Bulk download is disabled for this dataroom" });
    }

    if (
      view.viewedAt &&
      view.viewedAt < new Date(Date.now() - 23 * 60 * 60 * 1000)
    ) {
      return res.status(403).json({ error: "Error downloading" });
    }

    const teamId = view.dataroom.teamId;
    const sendEmail =
      !!emailNotification && !!view.viewerEmail && !!session.verified;

    const job = await downloadJobStore.createJob({
      type: "bulk",
      status: "PENDING",
      dataroomId: view.dataroom.id,
      dataroomName: view.dataroom.name,
      // The task fills in the real total once it builds the folder
      // structure; computing it here would defeat the purpose of moving the
      // heavy queries off of the request path.
      totalFiles: 0,
      processedFiles: 0,
      progress: 0,
      teamId,
      userId: view.viewerId ?? view.viewerEmail ?? "viewer",
      linkId,
      viewerId: view.viewerId ?? undefined,
      viewerEmail: view.viewerEmail ?? undefined,
      emailNotification: sendEmail,
      emailAddress: sendEmail ? (view.viewerEmail ?? undefined) : undefined,
    });

    const handle = await bulkDownloadTask.trigger(
      {
        jobId: job.id,
        dataroomId: view.dataroom.id,
        dataroomName: view.dataroom.name,
        teamId,
        watermarkConfig: view.link.enableWatermark
          ? {
              enabled: true,
              config: view.link.watermarkConfig,
              viewerData: {
                email: view.viewerEmail,
                date: (view.viewedAt
                  ? new Date(view.viewedAt)
                  : new Date()
                ).toLocaleDateString(),
                time: (view.viewedAt
                  ? new Date(view.viewedAt)
                  : new Date()
                ).toLocaleTimeString(),
                link: view.link.name,
                ipAddress: getIpAddress(req.headers),
              },
            }
          : { enabled: false },
        viewId: view.id,
        viewerId: view.viewerId ?? undefined,
        viewerEmail: view.viewerEmail ?? undefined,
        linkId,
        emailNotification: sendEmail,
        emailAddress: sendEmail ? (view.viewerEmail ?? undefined) : undefined,
        sourceContext: {
          type: "bulk",
          linkId,
          viewId: view.id,
          viewerId: view.viewerId ?? undefined,
          viewerEmail: view.viewerEmail ?? undefined,
          groupId: view.groupId ?? undefined,
          permissionGroupId: view.link.permissionGroupId ?? undefined,
          verified: view.verified ?? false,
          enableWatermark: !!view.link.enableWatermark,
          notifySlack: true,
        },
      },
      {
        idempotencyKey: job.id,
        tags: [
          `team_${teamId}`,
          `dataroom_${view.dataroom.id}`,
          `job_${job.id}`,
          `link_${linkId}`,
        ],
      },
    );

    await downloadJobStore.updateJob(job.id, { triggerRunId: handle.id });

    return res.status(202).json({
      jobId: job.id,
      status: "PENDING",
      message: sendEmail
        ? "Download started. We'll email you when it's ready."
        : "Download started. You can check status on the downloads page.",
    });
  } catch (error) {
    console.error("Error starting bulk download:", error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
