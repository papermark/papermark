import { NextApiRequest, NextApiResponse } from "next";

import { sendDataroomDigestNotification } from "@/lib/emails/send-dataroom-digest-notification";
import { sendDataroomNotification } from "@/lib/emails/send-dataroom-notification";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";
import { generateUnsubscribeUrl } from "@/lib/utils/unsubscribe";

export const config = {
  maxDuration: 120,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method Not Allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (token !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const {
    linkUrl,
    dataroomId,
    dataroomDocumentId,
    dataroomDocumentIds,
    viewerId,
    senderUserId,
    teamId,
  } = req.body as {
    linkUrl: string;
    dataroomId: string;
    dataroomDocumentId?: string;
    dataroomDocumentIds?: string[];
    viewerId: string;
    senderUserId: string | null;
    teamId: string;
  };

  const docIds =
    dataroomDocumentIds ??
    (dataroomDocumentId ? [dataroomDocumentId] : []);

  if (docIds.length === 0) {
    res.status(400).json({ message: "No document IDs provided" });
    return;
  }

  let viewer: { email: string } | null = null;

  try {
    viewer = await prisma.viewer.findUnique({
      where: {
        id: viewerId,
        teamId,
      },
      select: {
        email: true,
      },
    });

    if (!viewer) {
      res.status(404).json({ message: "Viewer not found." });
      return;
    }
  } catch (error) {
    log({
      message: `Failed to find viewer for viewerId: ${viewerId}. \n\n Error: ${error}`,
      type: "error",
      mention: true,
    });
    res.status(500).json({ message: (error as Error).message });
    return;
  }

  try {
    const documents = await prisma.dataroomDocument.findMany({
      where: {
        id: { in: docIds },
        dataroomId: dataroomId,
      },
      select: {
        document: {
          select: {
            name: true,
          },
        },
        dataroom: {
          select: {
            name: true,
          },
        },
      },
    });

    if (documents.length === 0) {
      res.status(404).json({ message: "No documents found." });
      return;
    }

    let senderEmail: string | null = null;
    if (senderUserId) {
      const user = await prisma.user.findUnique({
        where: { id: senderUserId },
        select: { email: true },
      });

      if (!user) {
        res.status(404).json({ message: "Sender not found." });
        return;
      }
      senderEmail = user.email!;
    }

    const unsubscribeUrl = generateUnsubscribeUrl({
      viewerId,
      dataroomId,
      teamId,
    });

    const dataroomName = documents[0]?.dataroom?.name || "";

    if (documents.length === 1) {
      await sendDataroomNotification({
        dataroomName,
        documentName: documents[0]?.document?.name || "",
        senderEmail,
        to: viewer.email!,
        url: linkUrl,
        unsubscribeUrl,
      });
    } else {
      await sendDataroomDigestNotification({
        dataroomName,
        documents: documents.map((doc) => ({
          documentName: doc.document?.name || "Untitled",
        })),
        senderEmail,
        to: viewer.email!,
        url: linkUrl,
        preferencesUrl: unsubscribeUrl,
        frequency: "instant",
      });
    }

    res.status(200).json({
      message: "Successfully sent dataroom change notification",
      viewerId,
      documentCount: documents.length,
    });
    return;
  } catch (error) {
    log({
      message: `Failed to send notification for dataroom ${dataroomId} to viewer: ${viewerId}. \n\n Error: ${error} \n\n*Metadata*: \`{dataroomId: ${dataroomId}, viewerId: ${viewerId}, docCount: ${docIds.length}}\``,
      type: "error",
      mention: true,
    });
    return res.status(500).json({ message: (error as Error).message });
  }
}
