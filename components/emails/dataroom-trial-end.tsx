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

interface DataroomTrialEnd {
  name: string | null | undefined;
}

const DataroomTrialEnd = ({ name }: DataroomTrialEnd) => {
  return (
    <Html>
      <Head />
      <Preview>Upgrade to continue using Data Room Plus plan features</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mb-8 mt-4 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="font-seminbold mb-8 mt-4 text-center text-xl">
              Your Data Room Plus plan trial has expired
            </Text>
            <Text className="text-sm leading-6 text-black">
              Hey{name && ` ${name}`}!
            </Text>
            <Text className="text-sm leading-6 text-black">
              Your Papermark Data Room Plus trial has expired.
              <br />
              <Link
                href={`https://app.papermark.com/settings/billing`}
                className="underline"
              >
                Upgrade now
              </Link>{" "}
              to:
            </Text>
            <ul className="list-inside list-disc text-sm">
              <li>Create new datarooms</li>
              <li>
                Upload <strong>large</strong> files
              </li>
              <li>
                Invite your <strong>team members</strong>
              </li>
              <li>
                Protect documents with <strong>advanced access controls</strong>
              </li>
              <li>
                Share documents and data rooms with{" "}
                <strong>custom domain</strong>
              </li>
              <li>Access advanced analytics and audit logs</li>
            </ul>
            <Section className="my-8 text-center">
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
              with advanced access controls have been{" "}
              <span className="underline">disabled</span>.
            </Text>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default DataroomTrialEnd;
