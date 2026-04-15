import React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

import { Footer } from "./shared/footer";

interface UpgradePlanEmailProps {
  name: string | null | undefined;
  planType: string;
}

const UpgradePlanEmail = ({
  name,
  planType = "datarooms-plus",
}: UpgradePlanEmailProps) => {
  const previewText = `The document sharing infrastructure for the modern web`;

  const PLAN_TYPE_MAP = {
    pro: "Pro",
    business: "Business",
    datarooms: "Data Rooms",
    "datarooms-plus": "Data Rooms Plus",
    "datarooms-premium": "Data Rooms Premium",
    "datarooms-unlimited": "Data Rooms Unlimited",
  };

  const planTypeText = PLAN_TYPE_MAP[planType as keyof typeof PLAN_TYPE_MAP];
  const features: any = {
    pro: [
      "Custom branding",
      "Unlimited link views",
      "Folder organization",
      "1 team member",
    ],
    business: [
      "Custom domains on document links",
      "Unlimited data rooms for multi-file sharing",
      "Advanced access controls",
      "3 team members",
    ],
    datarooms: [
      "Custom domains on data room links",
      "Unlimited data rooms",
      "Unlimited document uploads",
      "3 team members",
    ],
    "datarooms-plus": [
      "Custom domains on data room links",
      "Unlimited data rooms",
      "Q&A module",
      "5 team members",
    ],
    "datarooms-premium": [
      "Multiple teams (up to 5 teams)",
      "Unlimited encrypted storage",
      "No file size limit",
      "10 team members",
    ],
    "datarooms-unlimited": [
      "Unlimited team members",
      "Unlimited encrypted storage",
      "Unlimited data rooms",
      "Custom SLA & dedicated success team",
    ],
  };

  const planFeatures = features[planType];

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
            <Text className="font-seminbold mx-0 mb-8 mt-4 p-0 text-center text-xl">
              Thanks for upgrading to Papermark {planTypeText}!
            </Text>
            <Text className="text-sm leading-6 text-black">
              Hey{name && ` ${name}`}!
            </Text>
            <Text className="text-sm">
              Marc is here. I wanted to personally reach out to thank you for
              upgrading to Papermark {planTypeText}!
            </Text>

            <Text className="text-sm leading-6 text-black">
              On the {planTypeText} plan, you now have access to:
            </Text>
            {planFeatures?.map(
              (feature: string, index: number) => (
                <Text key={index} className="ml-1 text-sm leading-4 text-black">
                  ◆ {feature}
                </Text>
              ),
              [],
            )}
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href={`${process.env.NEXT_PUBLIC_BASE_URL}/${
                  planTypeText.includes("datarooms") ? "datarooms" : "documents"
                }`}
                style={{ padding: "12px 20px" }}
              >
                Share your{" "}
                {planType.includes("datarooms") ? "data rooms" : "documents"}
              </Button>
            </Section>
            <Section>
              <Text className="text-sm">
                Let me know if you have any questions or feedback. I&apos;m
                always happy to help!
              </Text>
              <Text className="text-sm text-gray-400">Marc from Papermark</Text>
            </Section>
            <Footer />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default UpgradePlanEmail;
