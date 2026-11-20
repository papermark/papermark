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

interface SlackIntegrationEmailProps {
  name: string | null | undefined;
}

const SlackIntegrationEmail = ({ name }: SlackIntegrationEmailProps) => {
  const previewText = `See who viewed your documents in slack in 2 clicks`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              Connect Slack in 2 clicks
            </Text>
            <Text className="text-sm">Hi{name && ` ${name}`}!</Text>
            <Text className="text-sm">
              We offer direct integration to Slack, and it&apos;s free for all
              users for 30 days.
            </Text>
            <Text className="text-sm">
              With our Slack integration, you can get real-time notifications
              about document and data roomviews directly in your Slack channels
              !
            </Text>
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`${process.env.NEXT_PUBLIC_BASE_URL}/settings/integrations`}
                style={{ padding: "12px 20px" }}
              >
                See who viewed your documents in Slack
              </Button>
            </Section>

            <Text className="text-sm">
              If you have any questions or need help setting it up, just respond
              to this email. I&apos;m always happy to help!
            </Text>
            <Text className="text-sm text-gray-400">Marc from Papermark</Text>
            <Hr />
            <Section className="mt-8 text-gray-400">
              <Text className="text-xs">
                © {new Date().getFullYear()}{" "}
                <a
                  href="https://www.papermark.com"
                  className="text-gray-400 no-underline"
                  target="_blank"
                >
                  papermark.com
                </a>
              </Text>
              <Text className="text-xs">
                Feel free to always reach out to me or our support team.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default SlackIntegrationEmail;
