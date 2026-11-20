-- CreateTable
CREATE TABLE "DocumentRedaction" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "category" TEXT,
    "confidence" TEXT,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "textPreview" TEXT,

    CONSTRAINT "DocumentRedaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRedactionJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "customTerms" TEXT[],
    "reasons" TEXT[],
    "resultVersionId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applyRunId" TEXT,
    "detectRunId" TEXT,

    CONSTRAINT "DocumentRedactionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRedaction_jobId_idx" ON "DocumentRedaction"("jobId" ASC);

-- CreateIndex
CREATE INDEX "DocumentRedaction_jobId_pageNumber_idx" ON "DocumentRedaction"("jobId" ASC, "pageNumber" ASC);

-- CreateIndex
CREATE INDEX "DocumentRedaction_jobId_status_idx" ON "DocumentRedaction"("jobId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_documentId_idx" ON "DocumentRedactionJob"("documentId" ASC);

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_documentVersionId_idx" ON "DocumentRedactionJob"("documentVersionId" ASC);

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_teamId_idx" ON "DocumentRedactionJob"("teamId" ASC);

-- CreateIndex
CREATE INDEX "DocumentRedactionJob_teamId_status_idx" ON "DocumentRedactionJob"("teamId" ASC, "status" ASC);

-- AddForeignKey
ALTER TABLE "DocumentRedaction" ADD CONSTRAINT "DocumentRedaction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentRedactionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedactionJob" ADD CONSTRAINT "DocumentRedactionJob_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

