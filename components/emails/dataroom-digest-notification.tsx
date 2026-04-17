import React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

type DocumentChange = {
  documentName: string;
};

export default function DataroomDigestNotification({
  dataroomName = "Example Data Room",
  documents = [
    { documentName: "Document A" },
    { documentName: "Document B" },
    { documentName: "Document C" },
  ],
  senderEmail,
  url = "https://app.papermark.com/datarooms/123",
  preferencesUrl = "https://app.papermark.com/notification-preferences?token=abc",
  frequency = "daily",
}: {
  dataroomName: string;
  documents: DocumentChange[];
  senderEmail: string | null;
  url: string;
  preferencesUrl: string;
  frequency: "daily" | "weekly" | "instant";
}) {
  const count = documents.length;
  const periodLabel =
    frequency === "instant"
      ? "recently"
      : frequency === "daily"
        ? "today"
        : "this week";

  return (
    <Html>
      <Head />
      <Preview>
        {`${count} new document${count !== 1 ? "s" : ""} in ${dataroomName} ${periodLabel}`}
      </Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mb-8 mt-4 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="font-semibold mb-8 mt-4 text-center text-xl">
              {`${count} new document${count !== 1 ? "s" : ""} in ${dataroomName}`}
            </Text>
            <Text className="text-sm leading-6 text-black">
              The following document{count !== 1 ? "s have" : " has"} been added
              to <span className="font-semibold">{dataroomName}</span>{" "}
              {periodLabel}:
            </Text>
            <Section className="my-4">
              {documents.map((doc, i) => (
                <Text
                  key={i}
                  className="my-1 text-sm leading-6 text-black"
                >
                  • <span className="font-semibold">{doc.documentName}</span>
                </Text>
              ))}
            </Section>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={url}
                style={{ padding: "12px 20px" }}
              >
                View the dataroom
              </Button>
            </Section>
            <Text className="text-sm text-black">
              or copy and paste this URL into your browser: <br />
              {url}
            </Text>
            <Text className="text-sm text-gray-400">Papermark</Text>

            <Hr />
            <Section className="text-gray-400">
              <Text className="text-xs">
                © {new Date().getFullYear()} Papermark, Inc. All rights
                reserved.
              </Text>
              <Text className="text-xs">
                You received this{" "}
                {frequency !== "instant" ? `${frequency} digest ` : "notification "}
                {senderEmail ? (
                  <>
                    from{" "}
                    <span className="font-semibold">{senderEmail}</span>{" "}
                  </>
                ) : null}
                because you viewed the dataroom{" "}
                <span className="font-semibold">{dataroomName}</span> on
                Papermark. If you have any feedback or questions about this
                email, simply reply to it.{" "}
                <a
                  href={preferencesUrl}
                  className="text-gray-400 underline underline-offset-2"
                >
                  Manage your notification preferences
                </a>
                .
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
