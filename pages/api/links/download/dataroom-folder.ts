import { NextApiRequest, NextApiResponse } from "next";

import { ViewType } from "@prisma/client";

import { verifyDataroomSessionInPagesRouter } from "@/lib/auth/dataroom-auth";
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { folderId, dataroomId, linkId, emailNotification } =
      req.body as {
        folderId: string;
        dataroomId: string;
        linkId: string;
        emailNotification?: boolean;
      };
    if (!folderId) {
      return res
        .status(400)
        .json({ error: "folderId is required in request body" });
    }

    const session = await verifyDataroomSessionInPagesRouter(
      req,
      linkId,
      dataroomId,
    );
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
            teamId: true,
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
      },
    });

    if (!view) {
      return res.status(404).json({ error: "Error downloading" });
    }

    // Verified session and email are only required when the viewer requested email notification
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

    if (
      view.viewedAt &&
      view.viewedAt < new Date(Date.now() - 23 * 60 * 60 * 1000)
    ) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // Cheap existence check: confirm the folder belongs to this dataroom and
    // grab the dataroom name in one round trip. The task will reload the
    // folder hierarchy itself.
    const rootFolder = await prisma.dataroomFolder.findUnique({
      where: { id: folderId, dataroomId },
      select: {
        id: true,
        name: true,
        dataroom: { select: { name: true } },
      },
    });

    if (!rootFolder) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const teamId = view.link.teamId!;
    const dataroomName = rootFolder.dataroom?.name ?? "Dataroom";
    const sendEmail =
      !!emailNotification && !!view.viewerEmail && !!session.verified;

    const job = await downloadJobStore.createJob({
      type: "folder",
      status: "PENDING",
      dataroomId,
      dataroomName,
      folderName: rootFolder.name,
      // The task fills in the real total once it finishes building the
      // folder structure; we don't know it yet without doing the heavy
      // queries the task is meant to perform.
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
        dataroomId,
        dataroomName,
        teamId,
        watermarkConfig: view.link.enableWatermark
          ? {
              enabled: true,
              config: view.link.watermarkConfig,
              viewerData: {
                email: view.viewerEmail,
                date: new Date(
                  view.viewedAt ? view.viewedAt : new Date(),
                ).toLocaleDateString(),
                time: new Date(
                  view.viewedAt ? view.viewedAt : new Date(),
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
        folderName: rootFolder.name,
        sourceContext: {
          type: "folder",
          folderId,
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
          `dataroom_${dataroomId}`,
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
        : "Download started. Check the downloads page for status.",
    });
  } catch (error) {
    console.error("Download error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
