import React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email";

import { Footer } from "./shared/footer";

const DataRoomsInformationEmail = () => {
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
              Virtual Data Rooms
            </Text>
            <Text className="text-sm">Unlimited branded data rooms!</Text>
            <Text className="text-sm">
              With Papermark Data Rooms plan you can:
            </Text>
            <ul className="list-inside list-disc text-sm">
              <li>Share data rooms with one link</li>
              <li>Upload unlimited files</li>
              <li>Create unlimited folders and subfolders</li>
              <li>
                Connect your <strong>custom domain 💫</strong>{" "}
              </li>
              <li>Create fully branded experience </li>
              <li>Use advanced link settings</li>
            </ul>
            <Text className="text-sm">
              All about Papermark{" "}
              <a
                href="https://www.papermark.com/data-room"
                className="text-blue-500 underline"
              >
                Data Rooms
              </a>{" "}
              features and plans
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/datarooms?utm_source=dataroom-info&utm_medium=email&utm_campaign=20240723&utm_content=upload_documents`}
                style={{ padding: "12px 20px" }}
              >
                Create new data room
              </Button>
            </Section>
            <Text className="text-sm">
              If you require a fully customizable experience,{" "}
              <a
                href="https://cal.com/marcseitz/papermark"
                className="text-blue-500 underline"
              >
                book a call
              </a>{" "}
              with us.
            </Text>
            <Footer
              withAddress={false}
              footerText="This is a last onboarding email. If you have any feedback or questions about this email, simply reply to it. I'd love to hear from you!"
            />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default DataRoomsInformationEmail;
