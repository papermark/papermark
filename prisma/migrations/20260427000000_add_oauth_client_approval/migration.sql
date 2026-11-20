-- CreateTable
CREATE TABLE "OAuthClientApproval" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthClientApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClientApproval_userId_clientId_key" ON "OAuthClientApproval"("userId", "clientId");

-- CreateIndex
CREATE INDEX "OAuthClientApproval_clientId_idx" ON "OAuthClientApproval"("clientId");
