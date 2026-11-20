import { NextApiRequest, NextApiResponse } from "next";

import { cancelSubscription } from "@/ee/stripe";
import { isOldAccount } from "@/ee/stripe/utils";
import { DocumentStorageType } from "@prisma/client";
import { getServerSession } from "next-auth";

import { deleteDomainRedirectUrl } from "@/lib/api/domains/redis";
import { removeDomainFromVercelProject } from "@/lib/domains";
import { errorhandler } from "@/lib/errorHandler";
import { deleteFiles } from "@/lib/files/delete-team-files-server";
import prisma from "@/lib/prisma";
import { clearCachedBrandLogo } from "@/lib/redis/brand-logo-cache";

import { CustomUser } from "@/lib/types";
import { unsubscribe } from "@/lib/resend";

import { authOptions } from "../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId } = req.query as { teamId: string };

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
        },
        select: {
          id: true,
          name: true,
          users: {
            select: {
              role: true,
              teamId: true,
              userId: true,
              status: true,
              user: {
                select: {
                  email: true,
                  name: true,
                },
              },
            },
          },
          documents: {
            select: {
              owner: {
                select: {
                  name: true,
                  id: true,
                },
              },
            },
          },
        },
      });

      // check that the user is member of the team, otherwise return 403
      const teamUsers = team?.users;
      const isUserPartOfTeam = teamUsers?.some(
        (user) => user.userId === (session.user as CustomUser).id,
      );
      if (!isUserPartOfTeam) {
        return res.status(403).end("Unauthorized to access this team");
      }

      // Attach per-member dataroom assignments so the client can render the
      // scoped-member editor and derive the current user's allowed rooms.
      const userDatarooms = await prisma.userDataroom.findMany({
        where: { teamId },
        select: { userId: true, dataroomId: true },
      });

      return res.status(200).json({ ...team, userDatarooms });
    } catch (error) {
      errorhandler(error, res);
    }
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const { teamId } = req.query as { teamId: string };

    try {
      // check if the team exists
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
        },
        include: {
          users: true,
          domains: true,
        },
      });
      if (!team) {
        return res.status(400).json("Team doesn't exists");
      }

      // check if current user is admin of the team
      const isUserAdmin = team.users.some(
        (user) =>
          user.role === "ADMIN" &&
          user.userId === (session.user as CustomUser).id,
      );
      if (!isUserAdmin) {
        return res
          .status(403)
          .json({ message: "You are not permitted to perform this action" });
      }

      // get all documents using Vercel Blob storage
      const documentsUsingBlob = await prisma.document.findMany({
        where: {
          teamId: teamId,
          storageType: DocumentStorageType.VERCEL_BLOB,
        },
        select: {
          file: true,
          versions: {
            select: {
              file: true,
              pages: {
                select: {
                  file: true,
                },
              },
            },
          },
        },
      });

      // get all branding files
      const brandingFiles = await prisma.brand.findMany({
        where: {
          teamId,
        },
        select: {
          logo: true,
        },
      });

      // get all dataroom branding files
      const dataroomBrandingFiles = await prisma.dataroomBrand.findMany({
        where: {
          dataroom: {
            teamId: teamId,
          },
        },
        select: {
          logo: true,
          banner: true,
        },
      });

      let files: string[] = [];
      let hasBlobDocuments = false;

      if (documentsUsingBlob) {
        hasBlobDocuments = true;
        files = documentsUsingBlob.flatMap((doc) => [
          doc.file,
          ...doc.versions.flatMap((version) => [
            version.file,
            ...version.pages.map((page) => page.file),
          ]),
        ]);
      }

      if (brandingFiles) {
        files = [
          ...files,
          ...brandingFiles
            .map((brand) => brand.logo)
            .filter((logo): logo is string => logo !== null),
        ];
      }

      if (dataroomBrandingFiles) {
        files = [
          ...files,
          ...dataroomBrandingFiles
            .flatMap((brand) => [brand.logo, brand.banner])
            .filter((item): item is string => item !== null),
        ];
      }

      // delete all files from storage
      await deleteFiles({ teamId, data: hasBlobDocuments ? files : undefined });

      // if user doesn't have other teams, delete the user
      const userTeams = await prisma.team.findMany({
        where: {
          users: {
            some: {
              userId: (session.user as CustomUser).id,
            },
          },
        },
      });

      // prepare a list of promises to delete domains and their Redis redirect entries
      let domainPromises: Promise<unknown>[] = [];
      if (team.domains) {
        domainPromises = team.domains.flatMap((domain) => [
          removeDomainFromVercelProject(domain.slug),
          deleteDomainRedirectUrl(domain.slug),
        ]);
      }

      await Promise.all([
        // delete domains, if exists on team
        team.domains && domainPromises,
        // delete subscription, if exists on team
        team.stripeId &&
        cancelSubscription(team.stripeId, isOldAccount(team.plan)),
        // delete user from contact book
        unsubscribe((session.user as CustomUser).email ?? ""),
        // delete user, if no other teams
        userTeams.length === 1 &&
        prisma.user.delete({
          where: {
            id: (session.user as CustomUser).id,
          },
        }),
        // delete team branding from redis
        clearCachedBrandLogo(teamId),

        // delete team
        prisma.team.delete({
          where: {
            id: teamId,
          },
        }),
      ]);

      return res.status(204).end();
    } catch (error) {
      return res.status(500).json((error as Error).message);
    }
  } else {
    // We only allow GET and DELETE requests
    res.setHeader("Allow", ["GET", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
