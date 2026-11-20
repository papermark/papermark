-- CreateEnum
CREATE TYPE "ReferralTrack" AS ENUM ('AFFILIATE', 'PARTNER_DISCOUNT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralProfile" JSONB,
ADD COLUMN     "referralTrack" "ReferralTrack",
ADD COLUMN     "referralTrackSelectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "referralProfile" JSONB,
ADD COLUMN     "referralTrack" "ReferralTrack",
ADD COLUMN     "referralTrackSelectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReferralInvite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "scopeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "referralLink" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralInvite_userId_idx" ON "ReferralInvite"("userId");

-- CreateIndex
CREATE INDEX "ReferralInvite_teamId_idx" ON "ReferralInvite"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralInvite_scopeId_email_key" ON "ReferralInvite"("scopeId", "email");

-- AddForeignKey
ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
