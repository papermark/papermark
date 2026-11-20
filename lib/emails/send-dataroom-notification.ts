import DataroomNotification from "@/components/emails/dataroom-notification";

import { sendEmail } from "@/lib/resend";

export const sendDataroomNotification = async ({
  dataroomName,
  documentName,
  senderEmail,
  to,
  url,
  unsubscribeUrl,
}: {
  dataroomName: string;
  documentName: string | undefined;
  senderEmail: string | null;
  to: string;
  url: string;
  unsubscribeUrl: string;
}) => {
  try {
    await sendEmail({
      to: to,
      subject: `New document available in ${dataroomName}`,
      react: DataroomNotification({
        senderEmail,
        dataroomName,
        documentName,
        url,
        unsubscribeUrl,
      }),
      test: process.env.NODE_ENV === "development",
      system: true,
      unsubscribeUrl,
    });
  } catch (e) {
    console.error(e);
  }
};
