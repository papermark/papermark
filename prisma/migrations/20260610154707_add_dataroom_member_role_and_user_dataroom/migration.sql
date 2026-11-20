-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DATAROOM_MEMBER';

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "dataroomIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "UserDataroom" (
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "dataroomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDataroom_pkey" PRIMARY KEY ("userId","dataroomId")
);

-- CreateIndex
CREATE INDEX "UserDataroom_userId_idx" ON "UserDataroom"("userId");

-- CreateIndex
CREATE INDEX "UserDataroom_teamId_idx" ON "UserDataroom"("teamId");

-- CreateIndex
CREATE INDEX "UserDataroom_dataroomId_idx" ON "UserDataroom"("dataroomId");

-- AddForeignKey
ALTER TABLE "UserDataroom" ADD CONSTRAINT "UserDataroom_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDataroom" ADD CONSTRAINT "UserDataroom_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDataroom" ADD CONSTRAINT "UserDataroom_dataroomId_fkey" FOREIGN KEY ("dataroomId") REFERENCES "Dataroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
