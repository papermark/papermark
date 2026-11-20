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
} from "react-email";

import { Footer } from "./shared/footer";

export default function ViewedDocumentPausedEmail({
  documentName = "Example Document",
  linkName = "Example Link",
}: {
  documentName?: string;
  linkName?: string;
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
              viewed by <span className="font-semibold">someone</span>
              from the link <span className="font-semibold">{linkName}</span>.
            </Text>
            <Text className="text-sm leading-6 text-black">
              Your team is currently paused, so detailed visitor information is
              not available. To see who visited your documents and access full
              analytics, please unpause your subscription.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`${process.env.NEXT_PUBLIC_MARKETING_URL}/settings/billing`}
                style={{ padding: "12px 20px" }}
              >
                Manage Subscription
              </Button>
            </Section>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
