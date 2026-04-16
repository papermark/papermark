-- AlterTable: mark a DocumentVersion as produced by redaction
ALTER TABLE "DocumentVersion" ADD COLUMN "redactedFromVersionId" TEXT;

-- CreateIndex
CREATE INDEX "DocumentVersion_redactedFromVersionId_idx" ON "DocumentVersion"("redactedFromVersionId");

-- AddForeignKey: self-reference from redacted version to its source
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_redactedFromVersionId_fkey" FOREIGN KEY ("redactedFromVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "DocumentRedactionJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "resultingVersionId" TEXT,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "customTerms" TEXT[],
    "triggerRunId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRedactionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRedaction" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "detectedText" TEXT,
    "category" TEXT,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRedaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_documentId_idx" ON "DocumentRedactionJob"("documentId");

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_documentVersionId_idx" ON "DocumentRedactionJob"("documentVersionId");

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_teamId_idx" ON "DocumentRedactionJob"("teamId");

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_documentId_createdAt_idx" ON "DocumentRedactionJob"("documentId", "createdAt" DESC);

-- CreateIndex: one-to-one between job and resulting version
CREATE UNIQUE INDEX "DocumentRedactionJob_resultingVersionId_key" ON "DocumentRedactionJob"("resultingVersionId");

-- CreateIndex
CREATE INDEX "DocumentRedaction_jobId_idx" ON "DocumentRedaction"("jobId");

-- CreateIndex
CREATE INDEX "DocumentRedaction_jobId_pageNumber_idx" ON "DocumentRedaction"("jobId", "pageNumber");

-- CreateIndex
CREATE INDEX "DocumentRedaction_jobId_status_idx" ON "DocumentRedaction"("jobId", "status");

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: redacted (resulting) version link
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_resultingVersionId_fkey" FOREIGN KEY ("resultingVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedaction" ADD CONSTRAINT "DocumentRedaction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentRedactionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
