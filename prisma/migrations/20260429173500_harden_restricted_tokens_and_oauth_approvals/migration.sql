-- AlterTable
ALTER TABLE "RestrictedToken"
ADD COLUMN "subjectType" TEXT NOT NULL DEFAULT 'user';

-- AlterTable
ALTER TABLE "OAuthClientApproval"
ADD COLUMN "clientMetadataHash" TEXT;
