-- Consolidated branding/layout migration.
-- Layout TEXT values (cardLayout, viewerLayoutPreset, viewerHeaderStyle) are
-- validated by Zod at the API boundary; allowed values live in
-- ee/features/branding/lib/dataroom-viewer-layout.ts.

ALTER TABLE "Brand"
    ADD COLUMN "accentButtonColor"        TEXT,
    ADD COLUMN "ctaLabel"                 TEXT,
    ADD COLUMN "ctaUrl"                   TEXT,
    ADD COLUMN "cardLayout"               TEXT    NOT NULL DEFAULT 'LIST',
    ADD COLUMN "showFolderTree"           BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "viewerLayoutPreset"       TEXT    NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN "viewerHeaderStyle"        TEXT    NOT NULL DEFAULT 'DEFAULT',
    ADD COLUMN "hideFolderIconsInMain"    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "customLinkPreviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "linkPreviewTitle"         TEXT,
    ADD COLUMN "linkPreviewDescription"   TEXT,
    ADD COLUMN "linkPreviewImage"         TEXT,
    ADD COLUMN "linkPreviewFavicon"       TEXT;

ALTER TABLE "DataroomBrand"
    ADD COLUMN "accentButtonColor"        TEXT,
    ADD COLUMN "cardLayout"               TEXT    NOT NULL DEFAULT 'LIST',
    ADD COLUMN "showFolderTree"           BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "viewerLayoutPreset"       TEXT    NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN "viewerHeaderStyle"        TEXT    NOT NULL DEFAULT 'DEFAULT',
    ADD COLUMN "hideFolderIconsInMain"    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ctaLabel"                 TEXT,
    ADD COLUMN "ctaUrl"                   TEXT,
    ADD COLUMN "customLinkPreviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "linkPreviewTitle"         TEXT,
    ADD COLUMN "linkPreviewDescription"   TEXT,
    ADD COLUMN "linkPreviewImage"         TEXT,
    ADD COLUMN "linkPreviewFavicon"       TEXT;

-- defaultShowBanner: backfill existing datarooms to false (preserve old
-- behaviour), then flip default to true for new datarooms.
ALTER TABLE "Dataroom" ADD COLUMN "defaultShowBanner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Dataroom" ALTER COLUMN "defaultShowBanner" SET DEFAULT true;
