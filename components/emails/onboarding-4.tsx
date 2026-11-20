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

const Onboarding4Email = () => {
  const previewText = `The document sharing infrastructure for the modern web`;

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
              Custom domains and branding
            </Text>
            <Text className="text-sm">
              Look professional with custom branding!
            </Text>
            <Text className="text-sm">With Papermark you can:</Text>
            <ul className="list-inside list-disc text-sm">
              <li>
                Share documnets with your <strong>custom domain💫</strong>{" "}
              </li>

              <li>Remove &quot;powered by Papermark&quot;</li>
              <li>Add logo and custom colors</li>
              <li>Share data room with custom domain</li>
              <li>Add banner and custom brand to data rooms</li>
            </ul>
            <Text className="text-sm">
              (Customization for data rooms is seaprate and available in each
              data room you create)
            </Text>
            {/* <Text className="text-sm">You can also use Bulk upload</Text> */}
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/documents?utm_source=onboarding&utm_medium=email&utm_campaign=20240723&utm_content=upload_documents`}
                style={{ padding: "12px 20px" }}
              >
                Add your domain and branding
              </Button>
            </Section>
            <Text className="text-sm">
              If you are looking for full white-labelling just{" "}
              <a
                href="https://cal.com/marcseitz/papermark"
                className="text-blue-500 underline"
              >
                book a call
              </a>{" "}
              with us.
            </Text>
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

export default Onboarding4Email;
