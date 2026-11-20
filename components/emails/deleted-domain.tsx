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

export default function DomainDeleted({
  domain = "papermark.com",
}: {
  domain: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>Domain Deleted</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-xl">
              Domain Deleted
            </Text>
            <Text className="text-sm leading-6 text-black">
              Your domain <code className="text-purple-600">{domain}</code> for
              your Papermark account has been invalid for 30 days. As a result,
              it has been deleted from Papermark.
            </Text>
            <Text className="text-sm leading-6 text-black">
              If you would like to restore the domain, you can easily create it
              again on Papermark with the link below.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/settings/domains`}
                style={{ padding: "12px 20px" }}
              >
                Set up your custom domain
              </Button>
            </Section>
            <Text className="text-sm leading-6 text-black">
              If you did not want to keep using this domain on Papermark anyway,
              you can simply ignore this email.
            </Text>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
