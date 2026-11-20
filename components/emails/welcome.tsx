import React from "react";

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email";

import { Footer } from "./shared/footer";

interface WelcomeEmailProps {
  name: string | null | undefined;
}

const WelcomeEmail = ({ name }: WelcomeEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Papermark</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 max-w-[600px] rounded border border-solid border-neutral-200 px-10 py-5">
            <Section className="mt-8">
              <Text className="text-2xl font-bold tracking-tighter">
                Papermark
              </Text>
            </Section>
            <Heading className="mx-0 my-7 p-0 text-xl font-semibold text-black">
              Welcome {name ? name : "to Papermark"}!
            </Heading>
            <Text className="mb-8 text-sm leading-6 text-gray-600">
              Thank you for signing up for Papermark! You can now start sharing
              documents securely, create data rooms, and track engagement in
              real-time.
            </Text>

            <Hr />

            <Heading className="mx-0 my-6 p-0 text-lg font-semibold text-black">
              Getting started
            </Heading>

            <Text className="mb-4 text-sm leading-6 text-gray-600">
              <strong className="font-medium text-black">
                1. Upload your document
              </strong>
              : Simply{" "}
              <Link
                href="https://www.papermark.com/help/article/how-to-upload-document"
                className="font-semibold text-black underline underline-offset-4"
              >
                drag and drop
              </Link>{" "}
              your PDF, spreadsheet, or presentation to create a shareable link.
            </Text>

            <Text className="mb-4 text-sm leading-6 text-gray-600">
              <strong className="font-medium text-black">
                2. Share securely
              </strong>
              : Add{" "}
              <Link
                href="https://www.papermark.com/help/article/require-email-verification"
                className="font-semibold text-black underline underline-offset-4"
              >
                email verification
              </Link>
              ,{" "}
              <Link
                href="https://www.papermark.com/password-protection"
                className="font-semibold text-black underline underline-offset-4"
              >
                password protection
              </Link>
              , or{" "}
              <Link
                href="https://www.papermark.com/help/article/expiration-date"
                className="font-semibold text-black underline underline-offset-4"
              >
                link expiration
              </Link>{" "}
              to control access.
            </Text>

            <Text className="mb-4 text-sm leading-6 text-gray-600">
              <strong className="font-medium text-black">
                3. Track engagement
              </strong>
              : Watch{" "}
              <Link
                href="https://www.papermark.com/help/article/built-in-page-by-page-analytics"
                className="font-semibold text-black underline underline-offset-4"
              >
                page-by-page analytics
              </Link>{" "}
              in real-time to see who&apos;s viewing your documents.
            </Text>

            <Text className="mb-8 text-sm leading-6 text-gray-600">
              <strong className="font-medium text-black">
                4. Create a data room
              </strong>
              :{" "}
              <Link
                href="https://www.papermark.com/help/article/create-data-room"
                className="font-semibold text-black underline underline-offset-4"
              >
                Set up a secure data room
              </Link>{" "}
              for due diligence and enterprise document sharing.
            </Text>

            <Section className="mb-8">
              <Link
                className="rounded-lg bg-black px-6 py-3 text-center text-[12px] font-semibold text-white no-underline"
                href={`${process.env.NEXT_PUBLIC_BASE_URL}/dashboard`}
              >
                Go to your dashboard
              </Link>
            </Section>

            <Footer marketing />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default WelcomeEmail;
