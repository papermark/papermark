import { NextRequest, NextResponse } from "next/server";

import { getServerSession } from "next-auth";

import { authOptions } from "@/pages/api/auth/[...nextauth]";

import DataroomFreezeOtp from "@/ee/features/dataroom-freeze/emails/components/dataroom-freeze-otp";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { sendEmail } from "@/lib/resend";
import { CustomUser } from "@/lib/types";
import { generateOTP } from "@/lib/utils/generate-otp";

export async function POST(
  _request: NextRequest,
  { params }: { params: { teamId: string; id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId, id: dataroomId } = params;
  const user = session.user as CustomUser;
  const userId = user.id;

  try {
    const { success } = await ratelimit(3, "1 m").limit(
      `freeze-otp:${userId}`,
    );
    if (!success) {
      return NextResponse.json(
        { message: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const teamAccess = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });

    if (!teamAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
      return NextResponse.json(
        { message: "Only admins and managers can freeze data rooms." },
        { status: 403 },
      );
    }

    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId, teamId },
      select: { id: true, name: true, isFrozen: true },
    });

    if (!dataroom) {
      return NextResponse.json(
        { error: "Dataroom not found" },
        { status: 404 },
      );
    }

    if (dataroom.isFrozen) {
      return NextResponse.json(
        { error: "Dataroom is already frozen" },
        { status: 400 },
      );
    }

    await prisma.verificationToken.deleteMany({
      where: { identifier: `freeze-otp:${dataroomId}:${userId}` },
    });

    const otpCode = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    await prisma.verificationToken.create({
      data: {
        token: otpCode,
        identifier: `freeze-otp:${dataroomId}:${userId}`,
        expires: expiresAt,
      },
    });

    await sendEmail({
      to: user.email!,
      subject: `${otpCode} — Confirm data room freeze`,
      react: DataroomFreezeOtp({
        userName: user.name || user.email!,
        dataroomName: dataroom.name,
        code: otpCode,
      }),
      system: true,
      test: process.env.NODE_ENV === "development",
    });

    return NextResponse.json({ message: "Verification code sent" });
  } catch (error) {
    console.error("Error sending freeze OTP:", error);
    return NextResponse.json(
      {
        message: "Internal Server Error",
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
