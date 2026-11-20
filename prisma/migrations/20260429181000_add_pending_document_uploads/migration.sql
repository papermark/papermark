-- CreateTable
CREATE TABLE "PendingDocumentUpload" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storageType" "DocumentStorageType" NOT NULL DEFAULT 'S3_PATH',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingDocumentUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingDocumentUpload_uploadId_key" ON "PendingDocumentUpload"("uploadId");

-- CreateIndex
CREATE INDEX "PendingDocumentUpload_teamId_expiresAt_idx" ON "PendingDocumentUpload"("teamId", "expiresAt");

-- CreateIndex
CREATE INDEX "PendingDocumentUpload_tokenId_expiresAt_idx" ON "PendingDocumentUpload"("tokenId", "expiresAt");
