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

export default function SlackIntegrationNotification({
  email = "panic@thedis.co",
  team = {
    name: "Acme, Inc",
  },
  integration = {
    name: "Slack",
    slug: "slack",
  },
}: {
  email: string;
  team: {
    name: string;
  };
  integration: {
    name: string;
    slug: string;
  };
}) {
  return (
    <Html>
      <Head />
      <Preview>An integration has been added to your team</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 my-7 p-0 text-center text-xl font-semibold text-black">
              An integration has been added to your team
            </Text>
            <Text className="text-sm leading-6 text-black">
              The <strong>{integration.name}</strong> integration has been added
              to your team {team.name} on Papermark.
            </Text>
            <Text className="text-sm leading-6 text-black">
              You can now receive notifications about document views, dataroom
              access and downloads directly in your Slack channels.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`${process.env.NEXT_PUBLIC_BASE_URL}/settings/integrations/${integration.slug}`}
                style={{ padding: "12px 20px" }}
              >
                View installed integration
              </Button>
            </Section>

            <Footer
              footerText={
                <>
                  This email was intended for{" "}
                  <span className="text-black">{email}</span>. If you were not
                  expecting this email, you can ignore this email. If you have
                  any feedback or questions about this email, simply reply to
                  it.
                </>
              }
            />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
