import { NextApiRequest, NextApiResponse } from "next";

import { getDataroomSessionByLinkIdInPagesRouter } from "@/lib/auth/dataroom-auth";
import prisma from "@/lib/prisma";
import { downloadJobStore } from "@/lib/redis-download-job-store";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const linkId = req.query.linkId as string;
  if (!linkId) {
    return res.status(400).json({ error: "linkId is required" });
  }

  const session = await getDataroomSessionByLinkIdInPagesRouter(req, linkId);
  if (!session) {
    return res.status(401).json({ error: "Session required" });
  }

  const view = await prisma.view.findUnique({
    where: { id: session.viewId },
    select: { viewerEmail: true },
  });
  if (!view?.viewerEmail) {
    return res.status(200).json([]);
  }

  const jobs = await downloadJobStore.getViewerJobs(
    linkId,
    view.viewerEmail,
    20,
  );

  // Replace raw S3 presigned URLs with relative proxy URLs so the browser
  // routes through the current origin (where the session cookie lives).
  const sanitisedJobs = jobs.map((job) => {
    const partCount = job.downloadUrls?.length ?? 0;
    const proxyUrls =
      job.status === "COMPLETED" && partCount > 0
        ? Array.from(
            { length: partCount },
            (_, i) =>
              `/api/links/download/file/${job.id}/${i}?linkId=${encodeURIComponent(linkId)}`,
          )
        : undefined;

    return {
      id: job.id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      totalFiles: job.totalFiles,
      processedFiles: job.processedFiles,
      downloadUrls: proxyUrls,
      error: job.status === "FAILED" ? job.error : undefined,
      dataroomName: job.dataroomName,
      type: job.type,
      folderName: job.folderName,
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
    };
  });

  return res.status(200).json(sanitisedJobs);
}
