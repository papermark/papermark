import { NextApiRequest, NextApiResponse } from "next";

import { deleteTeamBrand } from "@/ee/features/branding/lib/delete-team-brand";
import { prepareBrandWrite } from "@/ee/features/branding/lib/prepare-brand-write";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { writeCachedBrandLogo } from "@/lib/redis/brand-logo-cache";

async function findOwnedBrand(teamId: string, brandId: string) {
  return prisma.brand.findFirst({
    where: { id: brandId, teamId },
  });
}

const getHandler = withTeamApi(
  async ({ req, res, teamId }) => {
    const { brandId } = req.query as { brandId: string };
    const brand = await findOwnedBrand(teamId, brandId);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }
    return res.status(200).json(brand);
  },
  { requiredPermissions: ["branding.read"] },
);

const putHandler = withTeamApi(
  async ({ req, res, teamId, team }) => {
    const { brandId } = req.query as { brandId: string };
    const brand = await findOwnedBrand(teamId, brandId);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    const prepared = await prepareBrandWrite({
      body: req.body,
      teamId,
      plan: team.plan,
    });
    if (!prepared.ok) {
      return res.status(prepared.status).json({
        message: prepared.message,
        errors: prepared.errors,
      });
    }

    try {
      const [updated, teamMeta] = await Promise.all([
        prisma.brand.update({
          where: { id: brand.id },
          data: prepared.data,
        }),
        prisma.team.findUnique({
          where: { id: teamId },
          select: { defaultBrandId: true },
        }),
      ]);

      if (teamMeta?.defaultBrandId === updated.id) {
        await writeCachedBrandLogo(teamId, updated);
      }

      return res.status(200).json(updated);
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

const deleteHandler = withTeamApi(
  async ({ req, res, teamId }) => {
    const { brandId } = req.query as { brandId: string };
    const brand = await findOwnedBrand(teamId, brandId);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    try {
      await deleteTeamBrand({ teamId, brand });
      return res.status(204).end();
    } catch (error) {
      errorhandler(error, res);
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
  if (req.method === "PUT") {
    return putHandler(req, res);
  }
  if (req.method === "DELETE") {
    return deleteHandler(req, res);
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
