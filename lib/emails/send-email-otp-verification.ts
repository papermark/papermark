import { getCustomEmail } from "@/lib/edge-config/custom-email";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { sendEmail } from "@/lib/resend";

import OtpEmailVerification from "@/components/emails/otp-verification";

export const sendOtpVerificationEmail = async (
  email: string,
  code: string,
  isDataroom: boolean = false,
  teamId: string,
) => {
  let logo: string | null = null;
  let from: string | undefined;

  const customEmail = await getCustomEmail(teamId);

  if (customEmail && teamId) {
    from = customEmail;
    logo = await redis.get(`brand:logo:${teamId}`);
  }

  const emailTemplate = OtpEmailVerification({
    email,
    code,
    isDataroom,
    logo: logo ?? undefined,
  });

  try {
    await sendEmail({
      from,
      to: email,
      subject: `${code} is your verification code`,
      react: emailTemplate,
      test: process.env.NODE_ENV === "development",
      verify: true,
    });
  } catch (e) {
    console.error(e);
  }
};
