-- AlterTable
ALTER TABLE "Dataroom" ADD COLUMN "isFrozen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Dataroom" ADD COLUMN "frozenAt" TIMESTAMP(3);
ALTER TABLE "Dataroom" ADD COLUMN "frozenBy" TEXT;
ALTER TABLE "Dataroom" ADD COLUMN "freezeArchiveUrl" TEXT;
ALTER TABLE "Dataroom" ADD COLUMN "freezeArchiveHash" TEXT;

-- AddForeignKey
ALTER TABLE "Dataroom" ADD CONSTRAINT "Dataroom_frozenBy_fkey" FOREIGN KEY ("frozenBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
