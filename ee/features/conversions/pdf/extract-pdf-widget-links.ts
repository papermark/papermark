import type { PDFDocument, PDFObject, PDFPage } from "mupdf";

export type EmbeddedPageLink = {
  href: string;
  coords: string;
  isInternal: boolean;
  targetPage?: number;
  /** Present when the hit area came from a PDF Link/Widget annotation not in the link list */
  fromAnnotation?: boolean;
};

function rectToCoords(rect: number[]): string {
  return rect.join(",");
}

/** Match `doc.findPage(i)` to a page object reference (0-based page index). */
function pageIndexFromPageRef(doc: PDFDocument, pageRef: PDFObject): number {
  const resolved = pageRef.resolve();
  const targetNum = resolved.asIndirect();
  for (let i = 0; i < doc.countPages(); i++) {
    const candidate = doc.findPage(i);
    if (candidate.asIndirect() === targetNum) {
      return i;
    }
  }
  return -1;
}

function destToInternalLink(
  doc: PDFDocument,
  dest: PDFObject,
): { href: string; isInternal: true; targetPage: number } | null {
  const d = dest.resolve();
  if (d.isArray() && d.length > 0) {
    const pageRef = d.get(0).resolve();
    const idx = pageIndexFromPageRef(doc, pageRef);
    if (idx >= 0) {
      return {
        href: `#page=${idx + 1}`,
        isInternal: true,
        targetPage: idx + 1,
      };
    }
    return null;
  }
  if (d.isString()) {
    try {
      const idx = doc.resolveLink(d.asString());
      if (idx >= 0) {
        return {
          href: `#page=${idx + 1}`,
          isInternal: true,
          targetPage: idx + 1,
        };
      }
    } catch {
      /* named dest may not resolve */
    }
  }
  return null;
}

function actionDictToLink(
  doc: PDFDocument,
  action: PDFObject,
): { href: string; isInternal?: boolean; targetPage?: number } | null {
  const a = action.resolve();
  if (!a.isDictionary()) return null;

  const type = a.get("S");
  if (type.isNull()) return null;
  const subtype = type.asName();

  if (subtype === "URI") {
    const uri = a.get("URI");
    if (!uri.isNull() && uri.isString()) {
      const href = uri.asString().trim();
      if (href) return { href, isInternal: false };
    }
    return null;
  }

  if (subtype === "GoTo") {
    const d = a.get("D");
    if (!d.isNull()) {
      const internal = destToInternalLink(doc, d);
      if (internal) return internal;
    }
    return null;
  }

  if (subtype === "Launch") {
    const f = a.get("F");
    if (!f.isNull()) {
      const pathObj = f.isDictionary() ? f.get("UF").resolve() : f.resolve();
      if (!pathObj.isNull() && pathObj.isString()) {
        const href = pathObj.asString().trim();
        if (href) return { href };
      }
    }
    return null;
  }

  if (subtype === "GoToR") {
    const f = a.get("F");
    let filePart = "";
    if (!f.isNull()) {
      const pathObj = f.isDictionary() ? f.get("UF").resolve() : f.resolve();
      if (!pathObj.isNull() && pathObj.isString()) {
        filePart = pathObj.asString().trim();
      }
    }
    const d = a.get("D");
    if (!d.isNull()) {
      const internal = destToInternalLink(doc, d);
      if (internal && filePart) {
        return {
          href: `${filePart}${internal.href}`,
          isInternal: false,
        };
      }
      if (internal) return internal;
    }
    if (filePart) return { href: filePart, isInternal: false };
    return null;
  }

  if (subtype === "Named") {
    const n = a.get("N");
    if (!n.isNull() && n.isString()) {
      const name = n.asString();
      try {
        const idx = doc.resolveLink(name);
        if (idx >= 0) {
          return {
            href: `#page=${idx + 1}`,
            isInternal: true,
            targetPage: idx + 1,
          };
        }
      } catch {
        /* ignore */
      }
      return {
        href: `#named=${encodeURIComponent(name)}`,
        isInternal: true,
      };
    }
  }

  return null;
}

function annotDictToLink(
  doc: PDFDocument,
  annotDict: PDFObject,
): { href: string; isInternal?: boolean; targetPage?: number } | null {
  const dict = annotDict.resolve();
  if (!dict.isDictionary()) return null;

  const dest = dict.get("Dest");
  if (!dest.isNull()) {
    const internal = destToInternalLink(doc, dest);
    if (internal) return internal;
  }

  const directA = dict.get("A");
  if (!directA.isNull()) {
    const r = directA.resolve();
    if (r.isDictionary() && r.get("S").isNull() && !r.get("A").isNull()) {
      const fromAA = actionDictToLink(doc, r.get("A"));
      if (fromAA) return fromAA;
    }
    const fromA = actionDictToLink(doc, directA);
    if (fromA) return fromA;
  }

  return null;
}

/**
 * Collect click targets from PDF Link annotations and interactive form Widgets.
 * MuPDF's `page.getLinks()` omits many of these; merging both yields deck/PDF-editor hotspots.
 */
export function extractAnnotatedPdfLinks(
  pdfDoc: PDFDocument,
  pdfPage: PDFPage,
): EmbeddedPageLink[] {
  const out: EmbeddedPageLink[] = [];
  const annots = pdfPage.getAnnotations();

  for (const annot of annots) {
    const t = annot.getType();
    if (t !== "Link" && t !== "Widget") continue;

    const obj = annot.getObject();
    const parsed = annotDictToLink(pdfDoc, obj);
    if (!parsed || !parsed.href) continue;

    const bounds = annot.getBounds();
    const isInternal = parsed.isInternal === true;
    out.push({
      ...parsed,
      isInternal,
      coords: rectToCoords(bounds),
      fromAnnotation: true,
    });
  }

  return out;
}

export function mergePdfEmbeddedLinks(
  ...groups: EmbeddedPageLink[][]
): EmbeddedPageLink[] {
  const seen = new Set<string>();
  const merged: EmbeddedPageLink[] = [];

  for (const group of groups) {
    for (const link of group) {
      const key = [
        link.href,
        link.coords,
        link.isInternal === true ? "1" : "0",
        link.targetPage ?? "",
        link.fromAnnotation ? "a" : "l",
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(link);
    }
  }

  return merged;
}
