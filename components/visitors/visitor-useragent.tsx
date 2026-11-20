import { useVisitorUserAgent } from "@/lib/swr/use-stats";

import VisitorUserAgentBase from "./visitor-useragent-base";

export default function VisitorUserAgent({
  viewId,
  documentId,
}: {
  viewId: string;
  documentId?: string;
}) {
  const { userAgent, error } = useVisitorUserAgent(viewId, documentId);

  if (error) {
    return null;
  }

  if (!userAgent) {
    return <div className="pb-0.5 pl-1.5 md:pb-1 md:pl-2">Loading...</div>;
  }

  return <VisitorUserAgentBase userAgent={userAgent} />;
}
