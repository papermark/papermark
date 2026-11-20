-- AlterTable
ALTER TABLE "RestrictedToken" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'live',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'dashboard';

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientUri" TEXT,
    "logoUri" TEXT,
    "redirectUris" TEXT[],
    "grantTypes" TEXT[],
    "scopes" TEXT NOT NULL,
    "tokenAuthMethod" TEXT NOT NULL,
    "hashedSecret" TEXT,
    "registrationType" TEXT NOT NULL,
    "metadataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthGrantTeam" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthGrantTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthRecord" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "grantId" TEXT,
    "userCode" TEXT,
    "uid" TEXT,
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OAuthClient_clientId_idx" ON "OAuthClient"("clientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId" ASC);

-- CreateIndex
CREATE INDEX "OAuthGrantTeam_grantId_idx" ON "OAuthGrantTeam"("grantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthGrantTeam_grantId_key" ON "OAuthGrantTeam"("grantId" ASC);

-- CreateIndex
CREATE INDEX "OAuthRecord_expiresAt_idx" ON "OAuthRecord"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "OAuthRecord_grantId_idx" ON "OAuthRecord"("grantId" ASC);

-- CreateIndex
CREATE INDEX "OAuthRecord_kind_idx" ON "OAuthRecord"("kind" ASC);

-- CreateIndex
CREATE INDEX "OAuthRecord_uid_idx" ON "OAuthRecord"("uid" ASC);

-- CreateIndex
CREATE INDEX "OAuthRecord_userCode_idx" ON "OAuthRecord"("userCode" ASC);

-- CreateIndex
CREATE INDEX "RestrictedToken_clientId_idx" ON "RestrictedToken"("clientId" ASC);

-- CreateIndex
CREATE INDEX "RestrictedToken_hashedKey_idx" ON "RestrictedToken"("hashedKey" ASC);

-- AddForeignKey
ALTER TABLE "RestrictedToken" ADD CONSTRAINT "RestrictedToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

