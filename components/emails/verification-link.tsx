import React from "react";

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Section,
  Tailwind,
  Text,
} from "react-email";

const VerificationCodeEmail = ({
  email = "user@example.com",
  code = "45PFSNUDYW",
}: {
  email?: string;
  code?: string;
}) => {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 max-w-[600px] rounded border border-solid border-neutral-200 px-10 py-5">
            <Section className="mt-8">
              <Text className="text-2xl font-bold tracking-tighter">
                Papermark
              </Text>
            </Section>
            <Heading className="mx-0 my-7 p-0 text-xl font-semibold text-black">
              Your login code
            </Heading>
            <Text className="text-sm leading-6 text-neutral-600">
              A login code was requested for Papermark. Use this code to
              continue in Papermark:
            </Text>
            <Section className="my-6">
              <Text
                className="m-0 rounded-lg bg-neutral-100 px-4 py-3 text-center text-xl font-semibold text-black"
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  letterSpacing: "0.15em",
                }}
              >
                {code}
              </Text>
            </Section>
            <Text className="text-sm leading-6 text-neutral-600">
              This code will expire in 15 minutes.
            </Text>
            <Text className="mt-4 text-sm leading-5 text-neutral-500">
              This email was intended for{" "}
              <span className="text-black">{email}</span>. If you didn&apos;t
              request this code, you can safely ignore this email.
            </Text>
            <Hr className="my-6" />
            <Section className="text-gray-400">
              <Text className="text-xs text-neutral-500">
                Papermark, Inc.
                <br />
                1111B S Governors Ave #28117
                <br />
                Dover, DE 19904
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default VerificationCodeEmail;
