-- AlterTable
ALTER TABLE "Link" ADD COLUMN "uploadFolderIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
