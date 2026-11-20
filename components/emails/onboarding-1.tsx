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

const Onboarding1Email = () => {
  const previewText = `Share documents not attachments`;

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
              Turn your documents into links
            </Text>
            <Text className="text-sm">
              It all starts from sharing your first document!
            </Text>
            <Text className="text-sm">
              With Papermark you can upload different kind of documents and turn
              them into shareable links:
            </Text>
            <ul className="list-inside list-disc text-sm">
              <li>PDFs</li>
              <li>Microsoft Office files</li>
              <li>Excel, CSV files</li>
              <li>Notion via link</li>
            </ul>
            <Text className="text-sm">
              (All Notion changes are instantly reflected in shared documents)
            </Text>
            <Text className="text-sm">
              You can also use{" "}
              <span className="font-semibold">Bulk upload 💫</span> Just drop
              multiple documents at once
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/documents?utm_source=onboarding&utm_medium=email&utm_campaign=20240723&utm_content=upload_documents`}
                style={{ padding: "12px 20px" }}
              >
                Upload my documents
              </Button>
            </Section>
            <Text className="text-sm">
              After sharing start tracking document activity on each page
            </Text>
            <Hr />
            <Section className="text-gray-400">
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

export default Onboarding1Email;
