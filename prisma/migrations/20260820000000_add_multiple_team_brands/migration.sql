-- Named team brands: drop the 1:1 unique, add a default pointer, and
-- let links and datarooms select a Brand row.

ALTER TABLE "Brand" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Default';

ALTER TABLE "Team" ADD COLUMN "defaultBrandId" TEXT;

UPDATE "Team" AS t
SET "defaultBrandId" = b.id
FROM "Brand" AS b
WHERE b."teamId" = t.id;

ALTER TABLE "Link" ADD COLUMN "brandId" TEXT;

ALTER TABLE "Dataroom" ADD COLUMN "brandId" TEXT;

DROP INDEX "Brand_teamId_key";

CREATE INDEX "Brand_teamId_idx" ON "Brand"("teamId");

CREATE UNIQUE INDEX "Brand_teamId_name_key" ON "Brand"("teamId", "name");

CREATE INDEX "Team_defaultBrandId_idx" ON "Team"("defaultBrandId");

CREATE INDEX "Link_brandId_idx" ON "Link"("brandId");

CREATE INDEX "Dataroom_brandId_idx" ON "Dataroom"("brandId");

ALTER TABLE "Team"
ADD CONSTRAINT "Team_defaultBrandId_fkey"
FOREIGN KEY ("defaultBrandId") REFERENCES "Brand"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Link"
ADD CONSTRAINT "Link_brandId_fkey"
FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Dataroom"
ADD CONSTRAINT "Dataroom_brandId_fkey"
FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
