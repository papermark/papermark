import { sendEmail } from "@/lib/resend";

import UpgradePersonalEmail from "@/components/emails/upgrade-personal-welcome";

import { CreateUserEmailProps } from "../types";

const PLAN_TYPE_MAP = {
  pro: "Pro",
  business: "Business",
  datarooms: "Data Rooms",
  "datarooms-plus": "Data Rooms Plus",
  "datarooms-premium": "Data Rooms Premium",
  "datarooms-unlimited": "Data Rooms Unlimited",
};

export const sendUpgradePersonalEmail = async (
  params: CreateUserEmailProps & { planSlug?: string },
) => {
  const { name, email } = params.user;
  const { planSlug = "pro" } = params;

  // Schedule the email to be sent 6 minutes from now
  const sixMinuteFromNow = new Date(Date.now() + 1000 * 60 * 6).toISOString();

  // Get the first name from the full name
  const firstName = name ? name.split(" ")[0] : null;
  const planName = PLAN_TYPE_MAP[planSlug as keyof typeof PLAN_TYPE_MAP];

  const emailTemplate = UpgradePersonalEmail({ name: firstName, planName });
  try {
    await sendEmail({
      to: email as string,
      from: "Iuliia Shnai <iuliia@papermark.com>",
      subject: "Your Papermark account is ready",
      react: emailTemplate,
      test: process.env.NODE_ENV === "development",
      scheduledAt: sixMinuteFromNow,
    });
  } catch (e) {
    console.error(e);
  }
};
