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

  const { linkId, jobId } = req.query as { linkId: string; jobId: string };
  if (!linkId || !jobId) {
    return res.status(400).json({ error: "linkId and jobId are required" });
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
    return res.status(403).json({ error: "Viewer email not found" });
  }

  const job = await downloadJobStore.getJob(jobId);
  if (!job) {
    return res
      .status(404)
      .json({ error: "Download job not found or expired" });
  }

  if (
    job.linkId !== linkId ||
    job.viewerEmail?.toLowerCase().trim() !==
      view.viewerEmail?.toLowerCase().trim()
  ) {
    return res.status(403).json({ error: "Job does not belong to this viewer" });
  }

  // Use relative URLs so the browser resolves them against the current page origin,
  // ensuring the session cookie (scoped to the page host) is always sent.
  const partCount = job.downloadUrls?.length ?? 0;
  const proxyDownloadUrls =
    job.status === "COMPLETED" && partCount > 0
      ? Array.from({ length: partCount }, (_, i) =>
          `/api/links/download/file/${jobId}/${i}?linkId=${encodeURIComponent(linkId)}`,
        )
      : undefined;

  return res.status(200).json({
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    downloadUrls: proxyDownloadUrls,
    error: job.status === "FAILED" ? job.error : undefined,
    isReady: job.status === "COMPLETED" && !!job.downloadUrls?.length,
    dataroomName: job.dataroomName,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
  });
}
