-- AlterTable
ALTER TABLE "Agreement"
ADD COLUMN "signingProvider" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "signingExternalId" TEXT,
ADD COLUMN "signingEnvelopeId" TEXT,
ADD COLUMN "signingTemplateId" TEXT;

-- AlterTable
ALTER TABLE "AgreementResponse"
ALTER COLUMN "viewId" DROP NOT NULL,
ADD COLUMN "signingStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "signingExternalId" TEXT,
ADD COLUMN "signingEnvelopeId" TEXT,
ADD COLUMN "signedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "linkId" TEXT,
ADD COLUMN "signerEmail" TEXT,
ADD COLUMN "signerName" TEXT,
ADD COLUMN "signingDocumentId" INTEGER,
ADD COLUMN "signedFileKey" TEXT,
ADD COLUMN "signedFileName" TEXT,
ADD COLUMN "signedFileStorageType" "DocumentStorageType";

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_signingExternalId_key"
ON "Agreement"("signingExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementResponse_signingExternalId_key"
ON "AgreementResponse"("signingExternalId");

-- CreateIndex
CREATE INDEX "AgreementResponse_linkId_idx" ON "AgreementResponse"("linkId");

-- CreateIndex
CREATE INDEX "AgreementResponse_signerEmail_idx" ON "AgreementResponse"("signerEmail");
