import { sendEmail } from "@/lib/resend";

import AbandonedCheckoutEmail from "@/components/emails/abandoned-checkout";

import { CreateUserEmailProps } from "../types";

export const sendAbandonedCheckoutEmail = async (
  params: CreateUserEmailProps,
) => {
  const { name, email } = params.user;

  // Get the first name from the full name
  const firstName = name ? name.split(" ")[0] : null;

  const emailTemplate = AbandonedCheckoutEmail({
    name: firstName,
  });

  try {
    await sendEmail({
      to: email as string,
      subject: "Did something block checkout?",
      from: "Marc Seitz <marc@papermark.com>",
      react: emailTemplate,
      test: process.env.NODE_ENV === "development",
    });
  } catch (e) {
    console.error(e);
  }
};
