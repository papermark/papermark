import { NextApiRequest, NextApiResponse } from "next";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSession } from "next-auth";
import path from "node:path";

import { ONE_HOUR, ONE_SECOND } from "@/lib/constants";
import { getTeamS3ClientAndConfig } from "@/lib/files/aws-client";
import { buildContentDisposition, safeSlugify } from "@/lib/utils";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../auth/[...nextauth]";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  const { fileName, contentType, teamId, docId } = req.body as {
    fileName: string;
    contentType: string;
    teamId: string;
    docId: string;
  };

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const team = await prisma.team.findUnique({
    where: {
      id: teamId,
      users: {
        some: {
          userId: (session.user as CustomUser).id,
        },
      },
    },
    select: { id: true },
  });

  if (!team) {
    return res.status(403).end("Unauthorized to access this team");
  }

  try {
    // Get the basename and extension for the file
    const { name, ext } = path.parse(fileName);

    const slugifiedName = safeSlugify(name) + ext;
    const originalFileName = `${name}${ext}`;
    const key = `${team.id}/${docId}/${slugifiedName}`;
    const contentDisposition = buildContentDisposition(
      originalFileName,
      slugifiedName,
    );

    const { client, config } = await getTeamS3ClientAndConfig(team.id);

    const putObjectCommand = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
      ContentDisposition: contentDisposition,
    });

    const url = await getSignedUrl(client, putObjectCommand, {
      expiresIn: ONE_HOUR / ONE_SECOND,
    });

    return res
      .status(200)
      .json({ url, key, docId, fileName: slugifiedName, contentDisposition });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
