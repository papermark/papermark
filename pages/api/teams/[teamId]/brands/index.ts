import { NextApiRequest, NextApiResponse } from "next";

import { prepareBrandWrite } from "@/ee/features/branding/lib/prepare-brand-write";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import prisma from "@/lib/prisma";
import { writeCachedBrandLogo } from "@/lib/redis/brand-logo-cache";

const getHandler = withTeamApi(
  async ({ res, teamId }) => {
    const [brands, team] = await Promise.all([
      prisma.brand.findMany({
        where: { teamId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.team.findUnique({
        where: { id: teamId },
        select: { defaultBrandId: true },
      }),
    ]);

    return res.status(200).json({
      brands,
      defaultBrandId: team?.defaultBrandId ?? brands[0]?.id ?? null,
    });
  },
  { requiredPermissions: ["branding.read"] },
);

const postHandler = withTeamApi(
  async ({ req, res, teamId, team }) => {
    const prepared = await prepareBrandWrite({
      body: req.body,
      teamId,
      plan: team.plan,
      nameRequired: true,
    });
    if (!prepared.ok) {
      return res.status(prepared.status).json({
        message: prepared.message,
        errors: prepared.errors,
      });
    }

    try {
      const { brand, becameDefault } = await prisma.$transaction(async (tx) => {
        const existingBrand = await tx.brand.findFirst({
          where: { teamId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

        const created = await tx.brand.create({
          data: {
            teamId,
            ...prepared.data,
            name: prepared.data.name,
          },
        });

        const shouldDefault = !existingBrand;
        if (shouldDefault) {
          await tx.team.update({
            where: { id: teamId },
            data: { defaultBrandId: created.id },
          });
        }

        return { brand: created, becameDefault: shouldDefault };
      });

      if (becameDefault) {
        await writeCachedBrandLogo(teamId, brand);
      }

      return res.status(201).json(brand);
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return res
          .status(409)
          .json({ message: "A brand with this name already exists" });
      }
      throw error;
    }
  },
  { requiredPermissions: ["branding.write"] },
);

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    return getHandler(req, res);
  }
  if (req.method === "POST") {
    return postHandler(req, res);
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
