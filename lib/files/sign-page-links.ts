import {
  resolvePageLinkKind,
  type MediaPageLink,
  type PageLink,
  type StoredFileRef,
} from "@/lib/types/page-link";

import { getFile } from "./get-file";

/**
 * Signs the storage refs (`src` / `poster`) on `gif` / `video` overlay
 * entries inside a `DocumentPage.pageLinks` blob and returns a copy that
 * is safe to send to the client.
 *
 * - For each `MediaPageLink` that has `src`, mints an `href` signed URL.
 * - For each `MediaPageLink` that has `poster`, mints a `posterUrl`.
 * - The internal `src` / `poster` keys are stripped from the returned
 *   payload so the client never sees raw S3 keys.
 * - Regular `link` entries (the default) are returned untouched.
 *
 * `pageLinks` is typed as `unknown` because Prisma stores it as `Json`;
 * we defensively coerce.
 */
export async function signPageLinks(
  pageLinks: unknown,
  /** Defaults to S3 lifetime; we use the same cap as the page-image URLs. */
  expiresIn?: number,
): Promise<PageLink[] | undefined> {
  if (!Array.isArray(pageLinks)) return undefined;

  const links = pageLinks as PageLink[];

  return Promise.all(
    links.map(async (link) => {
      const kind = resolvePageLinkKind(link);
      if (kind !== "gif" && kind !== "video") {
        // Regular link entry — pass through untouched.
        return link;
      }

      const media = link as MediaPageLink;
      const out: MediaPageLink = {
        kind: media.kind,
        coords: media.coords,
        ...(media.naturalWidth ? { naturalWidth: media.naturalWidth } : {}),
        ...(media.naturalHeight ? { naturalHeight: media.naturalHeight } : {}),
      };

      if (media.src) {
        out.href = await signRef(media.src, expiresIn);
      } else if (media.href) {
        // Legacy: external URL baked in directly.
        out.href = media.href;
      }

      if (media.poster) {
        out.posterUrl = await signRef(media.poster, expiresIn);
      }

      return out;
    }),
  );
}

async function signRef(
  ref: StoredFileRef,
  expiresIn?: number,
): Promise<string> {
  return getFile({
    type: ref.storageType,
    data: ref.data,
    ...(expiresIn ? { expiresIn } : {}),
  });
}
