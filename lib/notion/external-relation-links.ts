import { Decoration } from "notion-types";

export type ExternalRelationLink = {
  text: string;
  url: string;
};

export function getExternalRelationLinks(
  data?: Decoration[],
): ExternalRelationLink[] | null {
  if (!Array.isArray(data)) return null;

  const links: ExternalRelationLink[] = [];

  for (const segment of data) {
    if (!Array.isArray(segment)) return null;

    const [text, decorations] = segment;
    const isSeparator = text === "," || text === " ";

    if (!Array.isArray(decorations)) {
      if (isSeparator) continue;
      return null;
    }

    const linkDecorator = decorations.find(
      (decoration: any) =>
        Array.isArray(decoration) &&
        decoration[0] === "a" &&
        typeof decoration[1] === "string",
    );

    if (!linkDecorator) return null;

    const linkUrl = linkDecorator[1];
    if (typeof linkUrl !== "string") return null;

    try {
      const url = new URL(linkUrl);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }

      links.push({
        text: typeof text === "string" && text ? text : url.href,
        url: url.href,
      });
    } catch {
      return null;
    }
  }

  return links.length > 0 ? links : null;
}
