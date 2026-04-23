import {
  Body,
  Head,
  Html,
  Link,
  Tailwind,
  Text,
} from "@react-email/components";

interface AbandonedCheckoutEmailProps {
  name: string | null | undefined;
}

const AbandonedCheckoutEmail = ({ name }: AbandonedCheckoutEmailProps) => {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="font-sans text-sm">
          <Text>Hi{name && ` ${name}`},</Text>
          <Text>
            I noticed you started the checkout process but didn&apos;t complete
            it. Did something go wrong?
          </Text>
          <Text>
            If you ran into any issues or have questions about our plans,
            I&apos;d be happy to help. Just reply to this email.
          </Text>
          <Text>
            <Link
              href="https://app.papermark.com/settings/upgrade"
              target="_blank"
              className="text-blue-500 underline"
            >
              Complete your upgrade →
            </Link>
          </Text>
          <Text>
            Best,
            <br />
            Marc
          </Text>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default AbandonedCheckoutEmail;
