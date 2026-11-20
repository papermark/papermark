import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { mergeGroupDomains } from "@/lib/utils/email-domain";

const GROUP_MISSING = Symbol("group-missing");
const DOMAIN_WRITE_ATTEMPTS = 3;

type MembersBody =
  | { ok: true; emails: string[]; domains: string[]; allowAll?: boolean }
  | { ok: false; error: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseMembersBody(body: unknown): MembersBody {
  if (body == null) {
    return { ok: true, emails: [], domains: [] };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }

  const emails = Reflect.get(body, "emails");
  const domains = Reflect.get(body, "domains");
  const allowAll = Reflect.get(body, "allowAll");

  if (emails !== undefined && !isStringArray(emails)) {
    return { ok: false, error: "emails must be an array of strings." };
  }
  if (domains !== undefined && !isStringArray(domains)) {
    return { ok: false, error: "domains must be an array of strings." };
  }
  if (allowAll !== undefined && typeof allowAll !== "boolean") {
    return { ok: false, error: "allowAll must be a boolean." };
  }

  return {
    ok: true,
    emails: isStringArray(emails) ? emails : [],
    domains: isStringArray(domains) ? domains : [],
    ...(typeof allowAll === "boolean" ? { allowAll } : {}),
  };
}

async function writeMergedGroupDomains(
  groupId: string,
  dataroomId: string,
  incomingDomains: string[],
  allowAll?: boolean,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOMAIN_WRITE_ATTEMPTS; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const current = await tx.viewerGroup.findUnique({
            where: { id: groupId, dataroomId },
            select: { domains: true },
          });
          if (!current) {
            throw GROUP_MISSING;
          }
          await tx.viewerGroup.update({
            where: { id: groupId },
            data: {
              domains: mergeGroupDomains(current.domains ?? [], incomingDomains),
              ...(typeof allowAll === "boolean" ? { allowAll } : {}),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (error) {
      if (error === GROUP_MISSING) {
        throw error;
      }
      lastError = error;
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === DOMAIN_WRITE_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw lastError;
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/:id/groups/:groupId/members
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const {
      teamId,
      id: dataroomId,
      groupId,
    } = req.query as {
      teamId: string;
      id: string;
      groupId: string;
    };

    const parsed = parseMembersBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const { emails, domains, allowAll } = parsed;

    try {
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Check if the group belongs to the dataroom
      const group = await prisma.viewerGroup.findUnique({
        where: {
          id: groupId,
          dataroomId: dataroomId,
        },
      });

      if (!group) {
        return res.status(404).end("Group not found");
      }

      let members = { count: 0 };
      if (emails.length > 0) {
        await prisma.viewer.createMany({
          data: emails.map((email) => ({
            email,
            teamId,
          })),
          skipDuplicates: true,
        });

        const viewers = await prisma.viewer.findMany({
          where: {
            teamId: teamId,
            email: {
              in: emails,
            },
          },
          select: { id: true },
        });

        members = await prisma.viewerGroupMembership.createMany({
          data: viewers.map((viewer) => ({
            groupId: groupId,
            viewerId: viewer.id,
          })),
          skipDuplicates: true,
        });
      }

      await writeMergedGroupDomains(groupId, dataroomId, domains, allowAll);

      res.status(201).json(members);
    } catch (error) {
      if (error === GROUP_MISSING) {
        return res.status(404).end("Group not found");
      }
      console.error("Request error", error);
      res.status(500).json({ error: "Error creating folder" });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
