-- AlterTable
ALTER TABLE "Link" ADD COLUMN "uploadFolderIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: seed the new array with the legacy single-folder value so existing links keep restricting to that folder.
UPDATE "Link"
SET "uploadFolderIds" = ARRAY["uploadFolderId"]
WHERE "uploadFolderId" IS NOT NULL
  AND ("uploadFolderIds" IS NULL OR array_length("uploadFolderIds", 1) IS NULL);
