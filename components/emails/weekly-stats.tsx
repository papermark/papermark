import React from "react";

import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

import { Footer } from "./shared/footer";

interface DataroomStats {
  name: string;
  timeSpentMinutes: number;
  completionPercent: number;
  visitorCount: number;
  documentsViewed: number;
}

interface WeeklyStatsEmailProps {
  userName: string;
  teamName: string;
  weekLabel: string;
  totalMinutes: number;
  mostViewedDocCompletionPercent: number;
  documentsViewedCount: number;
  topItemName: string;
  topItemIsDataroom: boolean;
  dataroomStats: DataroomStats | null;
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
  }
  return `${minutes} min`;
}

const defaultDataroomStats: DataroomStats = {
  name: "Investor Data Room",
  timeSpentMinutes: 18,
  completionPercent: 64,
  visitorCount: 7,
  documentsViewed: 5,
};

export default function WeeklyStatsEmail({
  userName = "Marc",
  teamName = "Acme Corp",
  weekLabel = "Mar 31 – Apr 7, 2026",
  totalMinutes = 42,
  mostViewedDocCompletionPercent = 78,
  documentsViewedCount = 12,
  topItemName = defaultDataroomStats.name,
  topItemIsDataroom = true,
  dataroomStats = defaultDataroomStats,
}: WeeklyStatsEmailProps) {
  const headerStat =
    totalMinutes < 1 ? "< 1 min" : `${formatMinutes(totalMinutes)}`;

  return (
    <Html>
      <Head />
      <Preview>
        Your documents were viewed for {headerStat} this week
      </Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 w-[500px] p-5">
            <Text className="mx-0 mb-6 mt-4 p-0 text-left text-2xl font-normal">
              <span className="font-bold tracking-tighter">Papermark</span>
            </Text>

            <Text className="mx-0 mt-0 mb-4 p-0 text-left text-lg font-semibold text-black">
              Your Papermark weekly activity report
            </Text>

            <Text className="mx-0 mt-0 mb-1 p-0 text-left text-sm leading-6 text-black">
              Hi {userName},
            </Text>
            <Text className="mx-0 mt-0 mb-6 p-0 text-left text-sm leading-6 text-black">
              Here&apos;s your weekly summary for{" "}
              <span className="font-semibold">{teamName}</span> from{" "}
              <span className="font-semibold">{weekLabel}</span>.
            </Text>

            {/* Stats Grid */}
            <Section
              className="w-full"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "4px",
                overflow: "hidden",
              }}
            >
              <Row>
                <Column
                  className="w-1/2 p-5 text-center"
                  style={{
                    borderRight: "1px solid #e5e7eb",
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  <Text className="m-0 p-0 text-2xl font-bold text-black">
                    {formatMinutes(totalMinutes)}
                  </Text>
                  <Text className="m-0 mt-1 p-0 text-xs font-medium uppercase tracking-wider text-gray-500">
                    Time on Documents
                  </Text>
                </Column>
                <Column
                  className="w-1/2 p-5 text-center"
                  style={{ borderBottom: "1px solid #e5e7eb" }}
                >
                  <Text className="m-0 p-0 text-2xl font-bold text-black">
                    {mostViewedDocCompletionPercent}%
                  </Text>
                  <Text className="m-0 mt-1 p-0 text-xs font-medium uppercase tracking-wider text-gray-500">
                    Completion
                  </Text>
                </Column>
              </Row>
              <Row>
                <Column
                  className="w-1/2 p-5 text-center"
                  style={{ borderRight: "1px solid #e5e7eb" }}
                >
                  <Text className="m-0 p-0 text-2xl font-bold text-black">
                    {documentsViewedCount}
                  </Text>
                  <Text className="m-0 mt-1 p-0 text-xs font-medium uppercase tracking-wider text-gray-500">
                    Documents Viewed
                  </Text>
                </Column>
                <Column className="w-1/2 p-5 text-center">
                  <Text className="m-0 mt-1 p-0 text-xs font-semibold text-black">
                    {topItemName}
                  </Text>
                  <Text className="m-0 mt-1 p-0 text-xs font-medium uppercase tracking-wider text-gray-500">
                    {topItemIsDataroom ? "Top Data Room" : "Most Viewed"}
                  </Text>
                </Column>
              </Row>
            </Section>

            {dataroomStats ? (
              <Section className="mt-6">
                <Text className="mx-0 mb-2 mt-0 p-0 text-base font-semibold text-black">
                  {dataroomStats.name} Activity :
                </Text>
                <Text className="mx-0 my-0 p-0 text-sm leading-7 text-gray-700">
                  &bull; Time spent:{" "}
                  <span className="font-semibold text-black">
                    {formatMinutes(dataroomStats.timeSpentMinutes)}
                  </span>
                  <br />
                  &bull; Completion:{" "}
                  <span className="font-semibold text-black">
                    {dataroomStats.completionPercent}%
                  </span>
                  <br />
                  &bull; Visitors:{" "}
                  <span className="font-semibold text-black">
                    {dataroomStats.visitorCount}
                  </span>
                  <br />
                  &bull; Documents viewed:{" "}
                  <span className="font-semibold text-black">
                    {dataroomStats.documentsViewed}
                  </span>
                </Text>
              </Section>
            ) : null}

            <Section className="my-8 text-left">
              <Button
                className="rounded bg-black text-center text-xs font-semibold text-white no-underline"
                href="https://app.papermark.com/documents"
                style={{ padding: "12px 20px" }}
              >
                View Dashboard
              </Button>
            </Section>

            <Footer
              footerText={
                <>
                  You received this email because your team had document
                  activity this week. If you have feedback, simply reply to this
                  email.
                </>
              }
            />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
