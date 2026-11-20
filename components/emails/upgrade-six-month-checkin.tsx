import React from "react";

import {
  Body,
  Head,
  Html,
  Preview,
  Tailwind,
  Text,
} from "react-email";

interface SixMonthMilestoneEmailProps {
  name: string | null | undefined;
  planName?: string;
}

const SixMonthMilestoneEmail = ({
  name,
  planName = "Pro",
}: SixMonthMilestoneEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>6 months with Papermark</Preview>
      <Tailwind>
        <Body className="font-sans text-sm">
          <Text>Hi {name},</Text>
          <Text>What&apos;s been your biggest win using Papermark?</Text>
          <Text>
            Marc here. It&apos;s been 6 months since you using advanced
            Papermark features! Excited to hear your story and feedback for us.
          </Text>

          <Text>Marc</Text>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default SixMonthMilestoneEmail;
