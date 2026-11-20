-- CreateEnum
CREATE TYPE "RootItemAccess" AS ENUM ('VIEW_ONLY', 'VIEW_AND_DOWNLOAD', 'HIDDEN');

-- AlterTable
ALTER TABLE "Dataroom" ADD COLUMN     "defaultRootItemAccess" "RootItemAccess" NOT NULL DEFAULT 'VIEW_ONLY',
ADD COLUMN     "defaultGroupRootItemAccess" "RootItemAccess" NOT NULL DEFAULT 'VIEW_ONLY';
