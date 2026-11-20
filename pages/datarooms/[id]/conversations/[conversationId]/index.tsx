import { useRouter } from "next/router";

import ConversationOverview from "@/ee/features/conversations/pages/conversation-overview";

export default function ConversationDetailPage() {
  const router = useRouter();
  const conversationId =
    typeof router.query.conversationId === "string"
      ? router.query.conversationId
      : undefined;

  return <ConversationOverview initialConversationId={conversationId} />;
}
