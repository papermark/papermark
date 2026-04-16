import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";

/**
 * Common result type for the team-member auth + feature-flag check used by
 * every redaction API route.
 */
export type RedactionAccess =
  | { ok: true; teamId: string; userId: string }
  | { ok: false; status: 401 | 403 | 404; message: string };

/**
 * Verify the caller is a member of the team that owns `documentId` and that
 * the redaction feature is enabled for that team. Returns the teamId on
 * success so callers can use it in follow-up queries.
 */
export async function verifyRedactionAccess({
  userId,
  documentId,
}: {
  userId: string;
  documentId: string;
}): Promise<RedactionAccess> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { teamId: true },
  });

  if (!document) {
    return { ok: false, status: 404, message: "Document not found" };
  }

  const teamId = document.teamId;

  const membership = await prisma.userTeam.findUnique({
    where: {
      userId_teamId: { userId, teamId },
    },
    select: { role: true },
  });

  if (!membership) {
    return {
      ok: false,
      status: 401,
      message: "Not a member of this team",
    };
  }

  const features = await getFeatureFlags({ teamId });
  if (!features.redaction) {
    return {
      ok: false,
      status: 403,
      message: "Redaction is not enabled for this team",
    };
  }

  return { ok: true, teamId, userId };
}

/**
 * Variant of {@link verifyRedactionAccess} that resolves a job id to its
 * document (and therefore its team) before running the checks.
 */
export async function verifyRedactionJobAccess({
  userId,
  jobId,
}: {
  userId: string;
  jobId: string;
}): Promise<
  | { ok: true; teamId: string; userId: string; documentId: string; jobId: string }
  | { ok: false; status: 401 | 403 | 404; message: string }
> {
  const job = await prisma.documentRedactionJob.findUnique({
    where: { id: jobId },
    select: { id: true, documentId: true, teamId: true },
  });

  if (!job) {
    return { ok: false, status: 404, message: "Redaction job not found" };
  }

  const membership = await prisma.userTeam.findUnique({
    where: {
      userId_teamId: { userId, teamId: job.teamId },
    },
    select: { role: true },
  });

  if (!membership) {
    return {
      ok: false,
      status: 401,
      message: "Not a member of this team",
    };
  }

  const features = await getFeatureFlags({ teamId: job.teamId });
  if (!features.redaction) {
    return {
      ok: false,
      status: 403,
      message: "Redaction is not enabled for this team",
    };
  }

  return {
    ok: true,
    teamId: job.teamId,
    userId,
    documentId: job.documentId,
    jobId: job.id,
  };
}
