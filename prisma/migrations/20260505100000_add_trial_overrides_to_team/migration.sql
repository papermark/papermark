-- AlterTable
ALTER TABLE "Team"
  ADD COLUMN "trialStartedAt"     TIMESTAMP(3),
  ADD COLUMN "trialEndsAt"        TIMESTAMP(3),
  ADD COLUMN "trialReminderRunId" TEXT,
  ADD COLUMN "trialExpiredRunId"  TEXT;
