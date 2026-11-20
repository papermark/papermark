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

export default function ExportReady({
  resourceName = "Export",
  downloadUrl = "https://app.papermark.com/datarooms/123",
  email = "email@example.com",
}: {
  resourceName?: string;
  downloadUrl: string;
  email: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>Your {resourceName} export is ready for download</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="text-sm leading-6 text-black">
              The export you requested is ready to download for your Papermark
              account. Make sure you&apos;re signed into this account, and click
              below to download. The file will be available for the next three
              days.
            </Text>
            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={downloadUrl}
                style={{ padding: "12px 20px" }}
              >
                Download Export
              </Button>
            </Section>
            <Text className="text-sm leading-6 text-black">
              Export details:
            </Text>
            <ul className="break-all text-sm leading-6 text-black">
              <li className="text-sm leading-6 text-black">
                Export type: {resourceName}
              </li>
            </ul>
            <Text className="text-sm leading-6 text-black">
              Best,
              <br />
              The Papermark Team
            </Text>
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
