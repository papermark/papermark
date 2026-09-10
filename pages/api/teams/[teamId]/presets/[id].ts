import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";

import { errorhandler } from "@/lib/errorHandler";
import { newId } from "@/lib/id-helper";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { presetDataSchema } from "@/lib/zod/schemas/presets";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId, id: presetId } = req.query as { teamId: string; id: string };

  try {
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
      },
      select: {
        id: true,
        users: { select: { userId: true } },
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
  } catch (error) {
    errorhandler(error, res);
    return;
  }

  if (req.method === "GET") {
    // GET /api/teams/:teamId/presets/:id
    try {
      const preset = await prisma.linkPreset.findFirst({
        where: {
          id: presetId,
          teamId: teamId,
        },
      });

      if (!preset) {
        return res.status(404).json({ message: "Preset not found" });
      }

      return res.status(200).json(preset);
    } catch (error) {
      errorhandler(error, res);
    }
  } else if (req.method === "PUT") {
    // PUT /api/teams/:teamId/presets/:id
    try {
      // Validate request body with Zod schema
      const validatedData = presetDataSchema.parse(req.body);

      // Check if preset exists and belongs to the team
      const existingPreset = await prisma.linkPreset.findUnique({
        where: {
          id: presetId,
          teamId: teamId,
        },
      });

      if (!existingPreset) {
        return res.status(404).json({ message: "Preset not found" });
      }

      // Update the preset
      const updatedPreset = await prisma.linkPreset.update({
        where: {
          id: presetId,
        },
        data: {
          ...validatedData,
          ...(!existingPreset.pId && { pId: newId("preset") }),
          // Convert objects to JSON strings for storage
          watermarkConfig: validatedData.watermarkConfig
            ? JSON.stringify(validatedData.watermarkConfig)
            : Prisma.JsonNull,
          customFields: validatedData.customFields
            ? validatedData.customFields
            : Prisma.JsonNull,
        },
      });

      return res.status(200).json({
        message: "Preset updated successfully",
        preset: updatedPreset,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          message: "Invalid preset data",
          errors: error.errors,
        });
      }
      errorhandler(error, res);
    }
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/presets/:id
    try {
      // Check if preset exists and belongs to the team
      const existingPreset = await prisma.linkPreset.findFirst({
        where: {
          id: presetId,
          teamId: teamId,
        },
      });

      if (!existingPreset) {
        return res.status(404).json({ message: "Preset not found" });
      }

      await prisma.linkPreset.delete({
        where: {
          id: presetId,
        },
      });

      return res.status(204).end();
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow GET, PUT, and DELETE requests
    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
