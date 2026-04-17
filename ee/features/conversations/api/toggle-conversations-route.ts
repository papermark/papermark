import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// Validation schema for the request body
const toggleConversationsSchema = z.object({
  enabled: z.boolean(),
});

export default async function toggleConversationsRoute(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Only allow POST method
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate the session
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = (session.user as CustomUser).id;

  try {
    // Extract query parameters
    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    // Validate request body
    const validationResult = toggleConversationsSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Invalid request data",
        details: validationResult.error.format(),
      });
    }

    const { enabled } = validationResult.data;

    // Check if user has access to this dataroom
    const updatedDataroom = await prisma.dataroom.update({
      where: {
        id: dataroomId,
        team: {
          id: teamId,
          users: {
            some: { userId },
          },
        },
      },
      data: {
        conversationsEnabled: enabled,
      },
    });

    if (!updatedDataroom) {
      return res.status(404).json({ error: "Dataroom not found" });
    }

    return res.status(200).json({ success: true, dataroom: updatedDataroom });
  } catch (error) {
    console.error("Error toggling conversations:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
