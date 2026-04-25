import WeeklyStatsEmail from "@/components/emails/weekly-stats";

import { sendEmail } from "@/lib/resend";

interface DataroomStats {
  name: string;
  timeSpentMinutes: number;
  completionPercent: number;
  visitorCount: number;
  documentsViewed: number;
}

export const sendWeeklyStats = async ({
  to,
  userName,
  teamName,
  weekLabel,
  totalMinutes,
  mostViewedDocCompletionPercent,
  documentsViewedCount,
  topItemName,
  topItemIsDataroom,
  dataroomStats,
}: {
  to: string;
  userName: string;
  teamName: string;
  weekLabel: string;
  totalMinutes: number;
  mostViewedDocCompletionPercent: number;
  documentsViewedCount: number;
  topItemName: string;
  topItemIsDataroom: boolean;
  dataroomStats: DataroomStats | null;
}) => {
  const minuteLabel =
    totalMinutes < 1 ? "< 1 min" : `${totalMinutes} min`;

  await sendEmail({
    to,
    subject: `Your documents were viewed for ${minuteLabel} this week`,
    react: WeeklyStatsEmail({
      userName,
      teamName,
      weekLabel,
      totalMinutes,
      mostViewedDocCompletionPercent,
      documentsViewedCount,
      topItemName,
      topItemIsDataroom,
      dataroomStats,
    }),
    test: process.env.NODE_ENV === "development",
    system: true,
  });
};
