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

export default function DataroomNotification({
  dataroomName = "Example Data Room",
  documentName = "Example Document",
  senderEmail,
  url = "https://app.papermark.com/datarooms/123",
  unsubscribeUrl = "https://app.papermark.com/datarooms/123/unsubscribe",
}: {
  dataroomName: string;
  documentName: string | undefined;
  senderEmail: string | null;
  url: string;
  unsubscribeUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>Dataroom update available</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mb-8 mt-4 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="font-seminbold mb-8 mt-4 text-center text-xl">
              {`New document available for ${dataroomName}`}
            </Text>
            <Text className="text-sm leading-6 text-black">
              A new document{" "}
              <span className="font-semibold">{documentName}</span> has been
              added to <span className="font-semibold">{dataroomName}</span>{" "}
              dataroom on Papermark.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`${url}`}
                style={{ padding: "12px 20px" }}
              >
                View the dataroom
              </Button>
            </Section>
            <Text className="text-sm text-black">
              or copy and paste this URL into your browser: <br />
              {`${url}`}
            </Text>
            <Text className="text-sm text-gray-400">Papermark</Text>

            <Hr />
            <Section className="text-gray-400">
              <Text className="text-xs">
                © {new Date().getFullYear()} Papermark, Inc. All rights
                reserved.
              </Text>
              <Text className="text-xs">
                You received this email{" "}
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
                  href={unsubscribeUrl}
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
