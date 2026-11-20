import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email";

import { Footer } from "./shared/footer";

export function EmailUpdated({
  oldEmail = "old@example.com",
  newEmail = "new@example.com",
}: {
  oldEmail: string;
  newEmail: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>Your email address has been updated</Preview>

      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[465px] p-5">
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>
            <Text className="mx-0 my-7 p-0 text-center text-xl font-semibold text-black">
              Your email address has been changed
            </Text>
            <Text className="text-sm leading-6 text-black">
              The email address for your Papermark account has been changed from{" "}
              <strong>{oldEmail}</strong> to <strong>{newEmail}</strong>.
            </Text>
            <Text className="text-sm leading-6 text-black">
              If you did not make this change, please contact our support team
              or{" "}
              <Link href="https://app.papermark.com/account/general">
                update your email address
              </Link>
              .
            </Text>
            <Text className="text-sm leading-6 text-black">
              This message is being sent to your old email address only.
            </Text>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default EmailUpdated;
