import DataroomDigestNotification from "@/components/emails/dataroom-digest-notification";

import { sendEmail } from "@/lib/resend";

export const sendDataroomDigestNotification = async ({
  dataroomName,
  documents,
  senderEmail,
  to,
  url,
  preferencesUrl,
  frequency,
}: {
  dataroomName: string;
  documents: { documentName: string }[];
  senderEmail: string | null;
  to: string;
  url: string;
  preferencesUrl: string;
  frequency: "daily" | "weekly" | "instant";
}) => {
  const count = documents.length;
  const periodLabel =
    frequency === "instant"
      ? "recently"
      : frequency === "daily"
        ? "today"
        : "this week";

  try {
    await sendEmail({
      to,
      subject: `${count} new document${count !== 1 ? "s" : ""} in ${dataroomName} ${periodLabel}`,
      react: DataroomDigestNotification({
        senderEmail,
        dataroomName,
        documents,
        url,
        preferencesUrl,
        frequency,
      }),
      test: process.env.NODE_ENV === "development",
      system: true,
      unsubscribeUrl: preferencesUrl,
    });
  } catch (e) {
    console.error(e);
    throw e;
  }
};
