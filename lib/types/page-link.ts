import type { DocumentStorageType } from "@prisma/client";

/**
 * The kinds of entries a rendered page's `pageLinks` JSON can hold.
 *
 *  - "link"  — a regular hyperlink rectangle (clickable area). This is the
 *              implicit default and is **not** stored on the entry — every
 *              shape that lacks an explicit `kind` is treated as a link.
 *  - "gif"   — an animated GIF rendered as `<img>` on top of the static
 *              page image.
 *  - "video" — an embedded video rendered as `<video>` on top of the
 *              static page image.
 *
 * Coordinates are always stored in **PDF user-space points** with the
 * top-left origin (matching what `mupdf`'s `link.getBounds()` returns and
 * what the existing `scaleCoordinates()` helper expects). The viewer
 * multiplies them by the per-page display scale-factor to get CSS pixels.
 *
 * For PowerPoint embeds, EMU coordinates from `<a:xfrm>` map to points via
 * `pt = emu / 12700` (1 inch = 914 400 EMU = 72 pt). LibreOffice preserves
 * slide dimensions in the generated PDF, so the same conversion lands the
 * overlay in the same place mupdf reports for hyperlinks on the same page.
 */
export type PageLinkKind = "link" | "gif" | "video";

/** Reference to a file living in our own storage (S3 / Vercel Blob). */
export interface StoredFileRef {
  storageType: DocumentStorageType;
  data: string;
}

/**
 * A regular hyperlink rectangle — the default `pageLinks` entry written
 * by `convert-page.ts`. There is no `kind` field on the wire; absence of
 * the discriminator means "link" so existing rows stay unchanged.
 */
export interface RegularPageLink {
  href: string;
  coords: string;
  isInternal?: boolean;
  targetPage?: number;
}

/**
 * A media overlay (gif or video) extracted from the source presentation.
 *
 * - `src`   — internal storage reference (preferred). The server signs a
 *             time-limited URL just before sending the page to the viewer.
 * - `poster`— optional internal storage reference for a still poster
 *             frame (videos only).
 * - `href`  — direct, public URL fallback (legacy convention where users
 *             added a hyperlink in PowerPoint pointing to a hosted .gif).
 * - `posterUrl` — populated on the wire by the server after signing.
 * - `naturalWidth/Height` — pixels of the source media; used by the viewer
 *             only for object-fit hints.
 */
export interface MediaPageLink {
  kind: "gif" | "video";
  coords: string;
  src?: StoredFileRef;
  poster?: StoredFileRef;
  href?: string;
  posterUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export type PageLink = RegularPageLink | MediaPageLink;

/**
 * Returns the resolved kind of a page-link entry. Falls back to `"link"`
 * when no discriminator is present (the standard case for hyperlink
 * rectangles) and to `"gif"` for the legacy convention of users adding
 * hyperlinks pointing at hosted `.gif` URLs.
 */
export function resolvePageLinkKind(link: PageLink): PageLinkKind {
  if ("kind" in link && link.kind) return link.kind;
  if (
    "href" in link &&
    typeof link.href === "string" &&
    link.href.endsWith(".gif")
  ) {
    return "gif";
  }
  return "link";
}
