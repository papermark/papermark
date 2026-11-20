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

function formatExpirationTime(expiresAt?: string): string {
  if (!expiresAt) return "3 days";

  const expires = new Date(expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? "s" : ""}`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""}`;
  }
  return "less than an hour";
}

export default function DownloadReady({
  dataroomName = "Dataroom",
  downloadUrl = "https://app.papermark.com",
  email = "email@example.com",
  expiresAt,
  isViewer = false,
}: {
  dataroomName?: string;
  downloadUrl?: string;
  email: string;
  expiresAt?: string;
  isViewer?: boolean;
}) {
  const expirationTime = formatExpirationTime(expiresAt);

  return (
    <Html>
      <Head />
      <Preview>Your {dataroomName} download is ready</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="text-sm leading-6 text-black">
              Your download of <strong>{dataroomName}</strong> is ready!
            </Text>
            <Text className="text-sm leading-6 text-black">
              {isViewer
                ? "Click the button below to open your downloads page and get your files."
                : "Click the button below to download your files. You'll need to be logged in to your Papermark account to access the download."}
            </Text>

            <Section className="my-8 text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={downloadUrl}
                style={{ padding: "12px 20px" }}
              >
                Download Files
              </Button>
            </Section>

            <Text className="text-sm leading-6 text-black">
              Download details:
            </Text>
            <ul className="break-all text-sm leading-6 text-black">
              <li className="text-sm leading-6 text-black">
                Dataroom: {dataroomName}
              </li>
              <li className="text-sm leading-6 text-black">
                Expires: in {expirationTime}
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
