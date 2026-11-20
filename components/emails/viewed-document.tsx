import React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email";

import { Footer } from "./shared/footer";

export default function ViewedDocument({
  documentId = "123",
  documentName = "Pitchdeck",
  linkName = "Pitchdeck",
  viewerEmail,
  locationString,
}: {
  documentId: string;
  documentName: string;
  linkName: string;
  viewerEmail: string | null;
  locationString?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>See who visited your document</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 my-7 p-0 text-center text-xl font-semibold text-black">
              New Document Visitor
            </Text>
            <Text className="text-sm leading-6 text-black">
              Your document{" "}
              <span className="font-semibold">{documentName}</span> was just
              viewed by{" "}
              <span className="font-semibold">
                {viewerEmail ? `${viewerEmail}` : `someone`}
              </span>
              {locationString ? (
                <span>
                  {" "}
                  in <span className="font-semibold">{locationString}</span>
                </span>
              ) : null}{" "}
              from the link <span className="font-semibold">{linkName}</span>.
            </Text>
            <Text className="text-sm leading-6 text-black">
              You can get the detailed engagement insights like time-spent per
              page and total duration for this document on Papermark.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/documents/${documentId}`}
                style={{ padding: "12px 20px" }}
              >
                See my document insights
              </Button>
            </Section>
            <Footer
              footerText={
                <>
                  If you have any feedback or questions about this email, simply
                  reply to it. I&apos;d love to hear from you!
                  <br />
                  <br />
                  To stop email notifications for this link, edit the link and
                  uncheck &quot;Receive email notification&quot;.
                </>
              }
            />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
