import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { key, expiresIn, responseContentDisposition } = req.body as {
    key: string;
    expiresIn?: number;
    responseContentDisposition?: string;
  };

  if (!key) {
    return res.status(400).json({ message: "Key is required" });
  }

  // Extract teamId from key (format: teamId/docId/filename)
  const teamId = key.split("/")[0];
  if (!teamId) {
    return res.status(400).json({ message: "Invalid key format" });
  }

  // Check if user belongs to the team that owns the file
  try {
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId: (session.user as CustomUser).id,
          },
        },
      },
    });

    if (!team) {
      return res
        .status(403)
        .json({ message: "Forbidden: You are not a member of this team" });
    }
  } catch (error) {
    return errorhandler(error, res);
  }

  try {
    const response = await fetch(
      `${process.env.NEXTAUTH_URL}/api/file/s3/get-presigned-get-url`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({
          key,
          ...(expiresIn ? { expiresIn } : {}),
          ...(responseContentDisposition ? { responseContentDisposition } : {}),
        }),
      },
    );

    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      let error: any;

      if (contentType && contentType.includes("application/json")) {
        try {
          error = await response.json();
        } catch (parseError) {
          error = {
            message:
              (await response.text()) ||
              `Request failed with status ${response.status}`,
          };
        }
      } else {
        const textError = await response.text();
        error = {
          message: textError || `Request failed with status ${response.status}`,
        };
      }

      return res.status(response.status).json(error);
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Proxy error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
