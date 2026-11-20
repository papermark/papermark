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

export default function TeamInvitation({
  senderName,
  senderEmail,
  teamName,
  url = "https://app.papermark.com",
}: {
  senderName: string;
  senderEmail: string;
  teamName: string;
  url: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>Join the team on Papermark</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-xl">
              {`Join ${teamName} on Papermark`}
            </Text>
            <Text className="text-sm leading-6 text-black">Hey!</Text>
            <Text className="text-sm leading-6 text-black">
              <span className="font-semibold">{senderName}</span> ({senderEmail}
              ) has invited you to the{" "}
              <span className="font-semibold">{teamName}</span> team on{" "}
              <span className="font-semibold">Papermark</span>.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={url}
                style={{ padding: "12px 20px" }}
              >
                Join the team
              </Button>
            </Section>
            <Text className="text-sm leading-6 text-black">
              or copy and paste this URL into your browser:
            </Text>
            <Text className="max-w-sm flex-wrap break-words font-medium text-purple-600 no-underline">
              {url.replace(/^https?:\/\//, "")}
            </Text>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
