-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "DataroomBrand" ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'en';
