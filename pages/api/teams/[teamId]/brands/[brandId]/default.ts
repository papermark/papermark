import { NextApiRequest, NextApiResponse } from "next";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { writeCachedBrandLogo } from "@/lib/redis/brand-logo-cache";

const postHandler = withTeamApi(
  async ({ req, res, teamId }) => {
    const { brandId } = req.query as { brandId: string };

    try {
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, teamId },
      });
      if (!brand) {
        return res.status(404).json({ message: "Brand not found" });
      }

      await prisma.team.update({
        where: { id: teamId },
        data: { defaultBrandId: brand.id },
      });
      await writeCachedBrandLogo(teamId, brand);

      return res.status(200).json(brand);
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
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  return postHandler(req, res);
}
