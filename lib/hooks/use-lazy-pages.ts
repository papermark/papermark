import { useCallback, useEffect, useRef, useState } from "react";

type PageData = {
  file: string | null;
  pageNumber: string;
  embeddedLinks: string[];
  pageLinks: {
    href: string;
    coords: string;
    isInternal?: boolean;
    targetPage?: number;
  }[];
  metadata: { width: number; height: number; scaleFactor: number };
};

type FetchPagesResponse = {
  pages: { pageNumber: number; file: string }[];
};

type UseLazyPagesOptions = {
  initialPages: PageData[];
  viewId?: string;
  previewToken?: string;
  linkId?: string;
  documentVersionId: string;
  preloadRadius?: number;
  apiEndpoint?: string;
};

const DEFAULT_PRELOAD_RADIUS = 5;

export function useLazyPages({
  initialPages,
  viewId,
  previewToken,
  linkId,
  documentVersionId,
  preloadRadius = DEFAULT_PRELOAD_RADIUS,
  apiEndpoint = "/api/views/pages",
}: UseLazyPagesOptions) {
  const [pages, setPages] = useState<PageData[]>(initialPages);
  const pagesRef = useRef<PageData[]>(pages);
  const pendingRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    setPages(initialPages);
    pagesRef.current = initialPages;
  }, [initialPages]);

  const fetchPageUrls = useCallback(
    async (pageNumbers: number[]) => {
      const currentPages = pagesRef.current;
      const needed = pageNumbers.filter(
        (pn) =>
          pn >= 1 &&
          pn <= currentPages.length &&
          !currentPages[pn - 1]?.file &&
          !pendingRef.current.has(pn),
      );

      if (needed.length === 0) return;

      needed.forEach((pn) => pendingRef.current.add(pn));

      try {
        const payload =
          viewId
            ? { viewId, documentVersionId, pageNumbers: needed }
            : { previewToken, linkId, documentVersionId, pageNumbers: needed };

        const response = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          needed.forEach((pn) => pendingRef.current.delete(pn));
          return;
        }

        const data: FetchPagesResponse = await response.json();

        setPages((prev) => {
          const updated = [...prev];
          for (const fetchedPage of data.pages) {
            const idx = fetchedPage.pageNumber - 1;
            if (idx >= 0 && idx < updated.length && updated[idx]) {
              updated[idx] = {
                ...updated[idx],
                file: fetchedPage.file,
              };
            }
          }
          return updated;
        });

        needed.forEach((pn) => pendingRef.current.delete(pn));
      } catch {
        needed.forEach((pn) => pendingRef.current.delete(pn));
      }
    },
    [viewId, previewToken, linkId, documentVersionId, apiEndpoint],
  );

  const ensurePagesLoaded = useCallback(
    (currentPage: number) => {
      const currentPages = pagesRef.current;
      const start = Math.max(1, currentPage - preloadRadius);
      const end = Math.min(currentPages.length, currentPage + preloadRadius);
      const needed: number[] = [];

      for (let i = start; i <= end; i++) {
        if (!currentPages[i - 1]?.file && !pendingRef.current.has(i)) {
          needed.push(i);
        }
      }

      if (needed.length > 0) {
        fetchPageUrls(needed);
      }
    },
    [preloadRadius, fetchPageUrls],
  );

  return { pages, ensurePagesLoaded, fetchPageUrls };
}
