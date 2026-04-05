import { useRouter } from "next/router";

import React, { useEffect, useState } from "react";

import { ConversationListItem } from "@/ee/features/conversations/components/dashboard/conversation-list-item";
import { ConversationMessage } from "@/ee/features/conversations/components/shared/conversation-message";
import {
  Loader2,
  MessageSquare,
  SearchIcon,
  Send,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import z from "zod";

import { useDocument } from "@/lib/swr/use-document";
import { useTeam } from "@/context/team-context";
import { CustomUser } from "@/lib/types";
import { fetcher } from "@/lib/utils";

import DocumentHeader from "@/components/documents/document-header";
import { NavMenu } from "@/components/navigation-menu";
import AppLayout from "@/components/layouts/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

// Types for conversation
interface Message {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  viewerId: string | null;
  isRead: boolean;
}

interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  participants: { id: string; email: string | null }[];
  documentPageNumber: number | null;
  documentVersionNumber: number | null;
  unreadCount: number;
  messages: Message[];
  documentName?: string;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  viewerId: string | null;
  viewerEmail?: string;
  documentPageNumber: number | null;
  documentVersionNumber: number | null;
  unreadCount: number;
  lastMessage?: {
    content: string;
    createdAt: string;
  };
  documentName?: string;
}

export default function DocumentConversationDetailPage() {
  const router = useRouter();
  const { document, primaryVersion } = useDocument();
  const { data: session } = useSession();
  const { currentTeamId: teamId } = useTeam();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { conversationId, id: documentId } = router.query;
  const [searchQuery, setSearchQuery] = useState("");

  // Mark messages as read
  const markMessagesAsRead = async (conversationId: string) => {
    if (!documentId || !teamId) return;

    try {
      const conversationIdParsed = z.string().cuid().parse(conversationId);
      const documentIdParsed = z.string().cuid().parse(documentId);
      const teamIdParsed = z.string().cuid().parse(teamId);
      const response = await fetch(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations/${conversationIdParsed}/read`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) throw new Error("Failed to mark messages as read");

      // Revalidate both the conversation and the summaries
      mutate(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations/${conversationIdParsed}`,
      );
      mutate(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations`,
      );
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  };

  // SWR hook for fetching the conversation with messages
  const { data: conversation, isLoading } = useSWR<Conversation>(
    conversationId && documentId && teamId
      ? `/api/teams/${teamId}/documents/${documentId}/conversations/${conversationId}`
      : null,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 3000, // 3 seconds
      keepPreviousData: true,
      onSuccess: (data) => {
        if (
          data &&
          data.messages.some((msg) => !msg.isRead && msg.viewerId !== null)
        ) {
          markMessagesAsRead(data.id);
        }
      },
      onError: (err) => {
        console.error("Error fetching conversation:", err);
        toast.error("Failed to load conversation");
      },
    },
  );

  // SWR hook for fetching all conversations
  const { data: conversations = [], isLoading: isLoadingConversations } =
    useSWR<ConversationSummary[]>(
      documentId && teamId
        ? `/api/teams/${teamId}/documents/${documentId}/conversations`
        : null,
      fetcher,
      {
        revalidateOnFocus: true,
        dedupingInterval: 5000, // 5 seconds
        keepPreviousData: true,
        onError: (err) => {
          console.error("Error fetching conversations:", err);
          toast.error("Failed to load conversations");
        },
      },
    );

  // Calculate total unread count across all conversations
  const unreadCount = conversations.reduce(
    (total, conv) => total + (conv.unreadCount || 0),
    0,
  );

  // Only show menu if there are conversations
  const hasConversations = conversations.length > 0;

  // Filter conversations based on search query
  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();

    // Search by viewer email
    if (conv.viewerEmail?.toLowerCase().includes(query)) return true;

    // Search in conversation titles and last messages
    return (
      conv.title?.toLowerCase().includes(query) ||
      conv.lastMessage?.content.toLowerCase().includes(query) ||
      conv.documentName?.toLowerCase().includes(query)
    );
  });

  // Handle conversation deletion
  const handleDeleteConversation = async () => {
    if (!conversation || !documentId || !teamId) return;

    setIsDeleting(true);
    try {
      const conversationIdParsed = z.string().cuid().parse(conversation.id);
      const documentIdParsed = z.string().cuid().parse(documentId);
      const teamIdParsed = z.string().cuid().parse(teamId);
      const response = await fetch(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations/${conversationIdParsed}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) throw new Error("Failed to delete conversation");

      // Revalidate the summaries
      mutate(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations`,
      );

      // Navigate back to conversations list
      router.push(`/documents/${documentIdParsed}/conversations`);

      toast.success("Conversation deleted successfully");
    } catch (error) {
      console.error("Error deleting conversation:", error);
      toast.error("Failed to delete conversation");
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
    }
  };

  // Handle sending a new message
  const handleSendMessage = async (e: React.FormEvent, newMessage: string) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversation || !documentId || !teamId) return;

    try {
      const conversationIdParsed = z.string().cuid().parse(conversation.id);
      const documentIdParsed = z.string().cuid().parse(documentId);
      const teamIdParsed = z.string().cuid().parse(teamId);
      const response = await fetch(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations/${conversationIdParsed}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: newMessage,
          }),
        },
      );

      if (!response.ok) throw new Error("Failed to send message");

      // Revalidate both the conversation and the summaries
      mutate(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations/${conversationIdParsed}`,
      );
      mutate(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations`,
      );

      toast.success("Message sent");
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message");
    }
  };

  // Navigate to a different conversation
  const navigateToConversation = (id: string) => {
    router.push(`/documents/${documentId}/conversations/${id}`);
  };

  if (!document || !primaryVersion) {
    return (
      <AppLayout>
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <header>
          <DocumentHeader
            primaryVersion={primaryVersion}
            prismaDocument={document}
            teamId={teamId!}
          />
          {hasConversations && (
            <NavMenu
              navigation={[
                {
                  label: "Overview",
                  href: `/documents/${document.id}`,
                  segment: `${document.id}`,
                },
                {
                  label: "Conversations",
                  href: `/documents/${document.id}/conversations`,
                  segment: "conversations",
                  count: unreadCount > 0 ? unreadCount : undefined,
                },
              ]}
            />
          )}
        </header>

        <div className="h-[calc(100vh-20rem)] overflow-hidden rounded-md border">
          <div className="flex h-full flex-col md:flex-row">
            {/* Sidebar with conversations list */}
            <div className="flex h-full w-full flex-col border-r md:w-96">
              <div className="flex items-center p-4">
                <div className="relative w-full">
                  <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search conversations..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex h-[calc(100%-7.5rem)] flex-col">
                <div className="m-0 flex-1 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="flex flex-col gap-2 p-4 pt-0">
                      {isLoadingConversations ? (
                        <div className="flex h-20 items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      ) : filteredConversations.length === 0 ? (
                        <div className="flex h-20 items-center justify-center">
                          <p className="text-sm text-muted-foreground">
                            No conversations found
                          </p>
                        </div>
                      ) : (
                        // Sort by most recent first
                        [...filteredConversations]
                          .sort(
                            (a, b) =>
                              new Date(b.updatedAt).getTime() -
                              new Date(a.updatedAt).getTime(),
                          )
                          .map((conv) => (
                            <ConversationListItem
                              key={conv.id}
                              navigateToConversation={navigateToConversation}
                              conversation={conv}
                              isActive={conv.id === conversationId}
                            />
                          ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>

            {/* Conversation content */}
            <div className="flex h-full flex-1 flex-col">
              {isLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : conversation ? (
                <>
                  {/* Conversation header */}
                  <div className="flex items-center justify-between border-b p-4">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src="" />
                        <AvatarFallback>
                          {conversation.participants[0].email
                            ? conversation.participants[0].email
                                .charAt(0)
                                .toUpperCase()
                            : "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <h2 className="text-base font-semibold">
                          {conversation.title || "Conversation"}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {conversation.participants[0].email ||
                            "Anonymous Viewer"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete conversation"
                        onClick={() => setIsDeleteDialogOpen(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Messages */}
                  <ScrollArea className="flex-1">
                    <div className="flex flex-col gap-4 p-4">
                      {conversation.documentPageNumber && (
                        <div className="rounded-lg border bg-muted p-3 text-sm">
                          <p className="font-medium">
                            Page {conversation.documentPageNumber}
                            {conversation.documentVersionNumber &&
                              ` • Version ${conversation.documentVersionNumber}`}
                          </p>
                        </div>
                      )}
                      {conversation.messages.map((message) => (
                        <ConversationMessage
                          key={message.id}
                          message={message}
                          isAuthor={
                            message.userId ===
                            (session?.user as CustomUser).id
                          }
                          senderEmail={
                            conversation.participants[0].email || "Viewer"
                          }
                        />
                      ))}
                    </div>
                  </ScrollArea>

                  <ConversationReplyForm
                    onSendMessage={handleSendMessage}
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-muted-foreground">
                    Conversation not found
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this conversation? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConversation}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

// Extracted reply form component
function ConversationReplyForm({
  onSendMessage,
}: {
  onSendMessage: (e: React.FormEvent, message: string) => Promise<void>;
}) {
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setIsSending(true);
    try {
      await onSendMessage(e, newMessage);
      setNewMessage("");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="border-t p-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Textarea
          placeholder="Type your reply..."
          className="min-h-[100px]"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!newMessage.trim() || isSending}
            className="ml-auto"
          >
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

