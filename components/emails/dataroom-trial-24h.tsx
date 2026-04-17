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
} from "@react-email/components";

import { Footer } from "./shared/footer";

interface TrialEndReminderEmail {
  name: string | null | undefined;
}

const DataroomTrial24hReminderEmail = ({ name }: TrialEndReminderEmail) => {
  return (
    <Html>
      <Head />
      <Preview>Upgrade to Papermark Data Rooms Plus Plan</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="font-seminbold mx-0 mb-8 mt-4 p-0 text-center text-xl">
              Your Data Room Plus plan trial expires in 24 hours
            </Text>
            <Text className="text-sm leading-6 text-black">
              Hey{name && ` ${name}`}!
            </Text>
            <Text className="text-sm leading-6 text-black">
              Your Papermark Data Room Plus plan trial expires in 24 hours.
              Don&apos;t lose access to these features -{" "}
              <Link href={`https://app.papermark.com/settings/billing`}>
                upgrade today
              </Link>
              :
            </Text>
            <ul className="list-inside list-disc text-sm">
              <li>
                Build unlimited <strong>data rooms</strong>
              </li>
              <li>
                Upload files of any <strong>size</strong>
              </li>
              <li>
                Collaborate with your <strong>team</strong>
              </li>
              <li>
                Set up <strong>secure link permissions</strong> and controls
              </li>
              <li>
                Brand everything with your <strong>custom domain</strong>
              </li>
              <li>
                Track detailed <strong>analytics</strong> and user activity
              </li>
            </ul>
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/settings/billing`}
                style={{ padding: "12px 20px" }}
              >
                Upgrade now
              </Button>
            </Section>
            <Text className="text-sm font-semibold">
              <span className="text-red-500">⚠️</span> Dataroom links and links
              with advanced access controls will be{" "}
              <span className="text-red-500 underline">disabled</span> in 24
              hours.
            </Text>
            <Text className="text-sm text-gray-400">Marc from Papermark</Text>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default DataroomTrial24hReminderEmail;
