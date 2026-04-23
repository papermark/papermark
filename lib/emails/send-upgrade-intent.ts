import { sendEmail } from "@/lib/resend";

import UpgradeIntentEmail from "@/components/emails/upgrade-intent";

interface SendUpgradeIntentEmailProps {
  user: {
    name: string | null | undefined;
    email: string | null | undefined;
  };
  triggers?: string[];
}

export const sendUpgradeIntentEmail = async (
  params: SendUpgradeIntentEmailProps,
) => {
  const { name, email } = params.user;
  const triggers = params.triggers || [];

  // Get the first name from the full name
  const firstName = name ? name.split(" ")[0] : null;

  const emailTemplate = UpgradeIntentEmail({
    name: firstName,
    triggers,
  });

  try {
    await sendEmail({
      to: email as string,
      subject: "Need help with your upgrade?",
      from: "Marc Seitz <marc@papermark.com>",
      react: emailTemplate,
      test: process.env.NODE_ENV === "development",
    });
  } catch (e) {
    console.error(e);
  }
};
