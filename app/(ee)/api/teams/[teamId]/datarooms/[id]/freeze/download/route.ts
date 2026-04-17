import { NextRequest, NextResponse } from "next/server";

import { getFreezeArchiveConfig } from "@/ee/features/storage/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/auth-options";

import { ONE_MINUTE, ONE_SECOND } from "@/lib/constants";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

const FIVE_MINUTES = 5 * ONE_MINUTE;

export async function GET(
  _request: NextRequest,
  { params }: { params: { teamId: string; id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId, id: dataroomId } = params;
  const userId = (session.user as CustomUser).id;

  try {
    const [teamAccess, dataroom] = await Promise.all([
      prisma.userTeam.findUnique({
        where: { userId_teamId: { userId, teamId } },
        select: { role: true },
      }),
      prisma.dataroom.findUnique({
        where: { id: dataroomId, teamId },
        select: { freezeArchiveUrl: true, isFrozen: true },
      }),
    ]);

    if (!teamAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
      return NextResponse.json(
        { message: "Only admins and managers can download freeze archives." },
        { status: 403 },
      );
    }

    if (!dataroom) {
      return NextResponse.json(
        { error: "Dataroom not found" },
        { status: 404 },
      );
    }

    if (!dataroom.isFrozen || !dataroom.freezeArchiveUrl) {
      return NextResponse.json(
        { error: "No freeze archive available for this dataroom" },
        { status: 400 },
      );
    }

    const archiveConfig = getFreezeArchiveConfig();
    const s3Client = new S3Client({
      region: archiveConfig.region,
      credentials: {
        accessKeyId: archiveConfig.accessKeyId,
        secretAccessKey: archiveConfig.secretAccessKey,
      },
    });

    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: archiveConfig.bucket,
        Key: dataroom.freezeArchiveUrl,
      }),
      { expiresIn: FIVE_MINUTES / ONE_SECOND },
    );

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error generating freeze archive download URL:", error);
    return NextResponse.json(
      {
        message: "Internal Server Error",
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
