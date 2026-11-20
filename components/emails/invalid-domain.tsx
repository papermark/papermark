import React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email";

import { Footer } from "./shared/footer";

export default function InvalidDomain({
  domain = "papermark.com",
  invalidDays = 14,
}: {
  domain: string;
  invalidDays: number;
}) {
  return (
    <Html>
      <Head />
      <Preview>Invalid Domain Configuration</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 my-7 p-0 text-center text-xl font-semibold text-black">
              {invalidDays >= 14
                ? `Invalid Domain Configuration`
                : `Finish configuring your domain`}
            </Text>
            <Text className="text-sm leading-6 text-black">
              Your domain <code className="text-purple-600">{domain}</code> for
              your Papermark account{" "}
              {invalidDays >= 14
                ? `has been invalid for ${invalidDays} days.`
                : `is still unconfigured.`}
            </Text>
            <Text className="text-sm leading-6 text-black">
              If your domain remains unconfigured for 30 days, it will be
              automatically deleted from Papermark. Please click the link below
              to configure your domain.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/settings/domains`}
                style={{ padding: "12px 20px" }}
              >
                Configure domain
              </Button>
            </Section>
            <Text className="text-sm leading-6 text-black">
              If you do not want to keep this domain on Papermark, you can{" "}
              <Link
                href={`https://app.papermark.com/settings/domains`}
                className="font-medium text-blue-600 no-underline"
              >
                delete it
              </Link>{" "}
              or simply ignore this email.{" "}
              {invalidDays >= 14
                ? `To respect your inbox,${" "} 
                  ${
                    invalidDays < 28
                      ? `we will only send you one more email about this in ${
                          28 - invalidDays
                        } days.`
                      : `this will be the last time we will email you about this.`
                  }`
                : ""}
            </Text>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
