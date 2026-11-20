import React from "react";

import {
  Body,
  Head,
  Html,
  Preview,
  Tailwind,
  Text,
} from "react-email";

interface UpgradePersonalEmailProps {
  name: string | null | undefined;
  planName?: string;
}

const UpgradePersonalEmail = ({
  name,
  planName = "Pro",
}: UpgradePersonalEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Welcome to {planName}</Preview>
      <Tailwind>
        <Body className="font-sans text-sm">
          <Text>Hi{name && ` ${name}`},</Text>
          <Text>
            I&apos;m Iuliia, co-founder of Papermark. Thanks for upgrading!
            I&apos;m thrilled to have you on our {planName} plan.
          </Text>
          <Text>
            You now have access to advanced features. Any questions so far??
          </Text>
          <Text>Iuliia</Text>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default UpgradePersonalEmail;
