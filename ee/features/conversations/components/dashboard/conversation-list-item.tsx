import { formatDistanceToNow } from "date-fns";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";

export function ConversationListItem({
  navigateToConversation,
  conversation,
  isActive,
  showVersionNumber = false,
}: {
  navigateToConversation: (id: string) => void;
  conversation: any;
  isActive: boolean;
  showVersionNumber?: boolean;
}) {
  // Helper function to format document reference
  const formatDocumentReference = () => {
    // Support both dataroom and document conversations
    const documentName =
      conversation.dataroomDocumentName || conversation.documentName;
    if (!documentName) return "Untitled conversation";

    const parts = [];

    if (conversation.documentPageNumber) {
      parts.push(`Page ${conversation.documentPageNumber}`);
    }

    // Only show version number if showVersionNumber is true (admin/team member view)
    if (showVersionNumber && conversation.documentVersionNumber) {
      parts.push(`v${conversation.documentVersionNumber}`);
    }

    const reference = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    return `${documentName}${reference}`;
  };

  return (
    <button
      className={cn(
        "relative flex flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent",
        isActive && "bg-muted",
      )}
      onClick={() => navigateToConversation(conversation.id)}
    >
      <div className="flex w-full flex-col gap-1">
        <div className="flex items-center">
          <div className="flex items-center gap-2">
            <div className="font-semibold">
              {conversation.viewerEmail || "Anonymous Viewer"}
            </div>
          </div>
          <div
            className={cn(
              "ml-auto text-xs text-muted-foreground",
              isActive && "text-foreground",
            )}
          >
            {formatDistanceToNow(new Date(conversation.updatedAt), {
              addSuffix: true,
            })}
          </div>
        </div>
        <div className="text-xs font-medium">
          {formatDocumentReference() || conversation.title}
        </div>
      </div>

      <div className="line-clamp-2 text-xs text-muted-foreground">
        {conversation.lastMessage.content}
      </div>

      {conversation.unreadCount > 0 && (
        <Badge className="absolute right-3 top-3" variant="default">
          {conversation.unreadCount}
        </Badge>
      )}
    </button>
  );
}
