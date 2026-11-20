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

const Onboarding3Email = () => {
  return (
    <Html>
      <Head />
      <Preview>The document sharing infrastructure for the modern web</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              Watch the views come in real-time
            </Text>
            <Text className="text-sm">
              You need to know who viewed your documents!
            </Text>
            <Text className="text-sm">
              With Papermark you can track progress on each page of your
              document and other analytics:
            </Text>
            <ul className="list-inside list-disc text-sm">
              <li>
                Track time on{" "}
                <span className="font-semibold">each page 💫</span>
              </li>
              <li>See who viewed your documents</li>
              <li>Capture email </li>
              <li>Receive feedback</li>
              <li>Ask questions and get answers</li>
            </ul>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/documents?utm_source=onboarding&utm_medium=email&utm_campaign=20240723&utm_content=upload_documents`}
                style={{ padding: "12px 20px" }}
              >
                View your document activity
              </Button>
            </Section>
            <Text className="text-sm">
              Get instant notifications on who viewed your documents
            </Text>
            <Hr />
            <Section className="mt-8 text-gray-400">
              <Text className="text-xs">
                © {new Date().getFullYear()} Papermark, Inc. All rights
                reserved.
              </Text>
              <Text className="text-xs">
                If you have any feedback or questions about this email, simply
                reply to it. I&apos;d love to hear from you!{" "}
              </Text>

              <Text className="text-xs">Stop this onboarding sequence</Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default Onboarding3Email;
