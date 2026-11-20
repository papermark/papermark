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

export default function DataroomUploadNotification({
  dataroomId = "123",
  dataroomName = "Example Dataroom",
  uploaderEmail = "visitor@example.com",
  documentNames = ["Document 1.pdf", "Document 2.pdf"],
  linkName = "Link #abc12",
}: {
  dataroomId: string;
  dataroomName: string;
  uploaderEmail: string | null;
  documentNames: string[];
  linkName: string;
}) {
  const documentCount = documentNames.length;
  const documentLabel = documentCount === 1 ? "document" : "documents";

  return (
    <Html>
      <Head />
      <Preview>
        {`${documentCount} new ${documentLabel} uploaded to ${dataroomName}`}
      </Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 my-7 p-0 text-center text-xl font-semibold text-black">
              New File Upload
            </Text>
            <Text className="text-sm leading-6 text-black">
              {uploaderEmail ? (
                <>
                  <span className="font-semibold">{uploaderEmail}</span> has
                  uploaded{" "}
                </>
              ) : (
                <>A visitor has uploaded </>
              )}
              <span className="font-semibold">
                {documentCount} {documentLabel}
              </span>{" "}
              to your dataroom{" "}
              <span className="font-semibold">{dataroomName}</span> via the link{" "}
              <span className="font-semibold">{linkName}</span>.
            </Text>
            {documentNames.length <= 10 && (
              <Section className="my-4">
                {documentNames.map((name, index) => (
                  <Text
                    key={index}
                    className="my-1 text-sm leading-6 text-black"
                  >
                    {"\u2022"} {name}
                  </Text>
                ))}
              </Section>
            )}
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`https://app.papermark.com/datarooms/${dataroomId}`}
                style={{ padding: "12px 20px" }}
              >
                View the dataroom
              </Button>
            </Section>

            <Footer
              footerText={
                <>
                  If you have any feedback or questions about this email, simply
                  reply to it. I&apos;d love to hear from you!
                  <br />
                  <br />
                  To stop email notifications for this link, edit the link and
                  uncheck &quot;Receive email notification&quot;.
                </>
              }
            />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
