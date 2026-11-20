import React from "react";

import type { ResolvedBrandLogo } from "@/ee/features/branding/lib/brand-logo";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Section,
  Tailwind,
  Text,
} from "react-email";

export default function OtpEmailVerification({
  email = "test@example.co",
  code = "123456",
  isDataroom = false,
  logo = { kind: "papermark" },
}: {
  email: string;
  code: string;
  isDataroom: boolean;
  logo?: ResolvedBrandLogo;
}) {
  const resourceLabel = isDataroom ? "dataroom" : "document";
  const logoSection = (() => {
    switch (logo.kind) {
      case "custom":
        return (
          <Section className="mt-8">
            <Img src={logo.src} alt="Logo" width="120" height="36" />
          </Section>
        );
      case "papermark":
        return (
          <Section className="mt-8">
            <Text className="text-2xl font-bold tracking-tighter">
              Papermark
            </Text>
          </Section>
        );
      case "none":
        return null;
      default: {
        const _exhaustive: never = logo;
        return _exhaustive;
      }
    }
  })();

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 max-w-[600px] rounded border border-solid border-neutral-200 px-10 py-5">
            {logoSection}
            <Text className="mx-0 my-7 p-0 text-xl font-semibold text-black">
              Your verification code
            </Text>
            <Text className="text-sm leading-6 text-neutral-600">
              A verification code was requested to view the {resourceLabel}{" "}
              shared with you on Papermark. Use this code to continue:
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
              This code will expire in 10 minutes.
            </Text>
            <Text className="mt-4 text-sm leading-5 text-neutral-500">
              This email was intended for{" "}
              <span className="text-black">{email}</span>. If you were not
              expecting this email, you can safely ignore it.
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
}
