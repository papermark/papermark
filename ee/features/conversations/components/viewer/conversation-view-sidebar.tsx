"use client";

import { useState } from "react";

import { ConversationDocumentContext } from "@/ee/features/conversations/components/shared/conversation-document-context";
import { ConversationMessage } from "@/ee/features/conversations/components/shared/conversation-message";
import { FAQSection } from "@/ee/features/conversations/components/viewer/faq-section";
import { format } from "date-fns";
import { ArrowLeftIcon, BellIcon, BellOffIcon, Plus } from "lucide-react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";

import { fetcher } from "@/lib/utils";
import { MAX_MESSAGE_LENGTH } from "@/lib/utils/sanitize-html";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";

// Type definitions
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
  messages: Message[];
  userId: string | null;
  viewerId: string | null;
  documentPageNumber: number | null;
  documentVersionNumber: number | null;
  dataroomDocument?: {
    document: {
      name: string;
    };
  };
  receiveNotifications: boolean;
}

interface CreateConversationData {
  title?: string;
  initialMessage: string;
}

export type ConversationSidebarProps = {
  linkId: string;
  viewId: string;
  dataroomId?: string;
  documentId?: string;
  pageNumber?: number;
  viewerId?: string;
  isEnabled?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ConversationViewSidebar({
  dataroomId,
  documentId,
  pageNumber,
  viewId,
  viewerId,
  linkId,
  isEnabled = true,
  isOpen = false,
  onOpenChange,
}: ConversationSidebarProps) {
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [isNewConversationFormOpen, setIsNewConversationFormOpen] =
    useState(false);
  const [newMessage, setNewMessage] = useState("");

  // SWR hook for fetching conversations
  // For document links, we can fetch without viewerId (shows all conversations)
  // For datarooms, viewerId is required
  const {
    data: conversations = [],
    error,
    isLoading,
  } = useSWR<Conversation[]>(
    dataroomId
      ? (viewerId
          ? `/api/conversations?dataroomId=${dataroomId}&viewerId=${viewerId}`
          : null)
      : `/api/conversations?linkId=${linkId}${viewerId ? `&viewerId=${viewerId}` : ""}`,
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

  // Create a new conversation
  const handleCreateConversation = async (data: CreateConversationData) => {
    console.log("Creating conversation", data);
    try {
      // For document links without viewerId, the API will create an anonymous viewer
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...data,
          viewId,
          ...(viewerId && { viewerId }),
          documentId,
          pageNumber,
          linkId,
          ...(dataroomId && { dataroomId }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        toast.error(errorData.error);
        return;
      }

      const newConversation = await response.json();

      // If we didn't have a viewerId before, update it from the response
      // (the API may have created an anonymous viewer)
      if (!viewerId && newConversation.participants?.[0]?.viewerId) {
        // Update viewerId for future requests
        // Note: This is a workaround - ideally we'd update the parent component's state
      }

      // Update the SWR cache with the new conversation
      const effectiveViewerId = viewerId || newConversation.participants?.[0]?.viewerId;
      const cacheKey = dataroomId
        ? `/api/conversations?dataroomId=${dataroomId}&viewerId=${effectiveViewerId}`
        : `/api/conversations?linkId=${linkId}&viewerId=${effectiveViewerId}`;
      mutate(
        cacheKey,
        [newConversation, ...(conversations || [])],
        false,
      );

      setActiveConversation(newConversation);
      setIsNewConversationFormOpen(false);

      toast.success("Conversation created successfully");
    } catch (error) {
      toast.error("Failed to create conversation");
    }
  };

  // Send a new message to an active conversation
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConversation) return;

    try {
      const response = await fetch(`/api/conversations/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: newMessage,
          viewId,
          viewerId,
          conversationId: activeConversation.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        toast.error(errorData.error);
        return;
      }

      const message: Message = await response.json();

      // Update the SWR cache with the new message
      mutate(
        dataroomId
          ? `/api/conversations?dataroomId=${dataroomId}&viewerId=${viewerId}`
          : `/api/conversations?linkId=${linkId}&viewerId=${viewerId}`,
        conversations?.map((conv) =>
          conv.id === activeConversation.id
            ? {
                ...conv,
                messages: [...conv.messages, message],
                updatedAt: new Date().toISOString(),
              }
            : conv,
        ),
        false,
      );

      // Also update the active conversation
      setActiveConversation((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, message],
              updatedAt: new Date().toISOString(),
            }
          : null,
      );

      setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message");
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 sm:max-w-md">
        <div className="flex h-full flex-col">
          {/* Header */}
          {/* <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-lg font-medium">Questions</h2>
          </div> */}

          {/* Content */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {isEnabled ? (
              <>
                {/* FAQ Section */}
                <FAQSection
                  dataroomId={dataroomId}
                  linkId={linkId}
                  documentId={documentId}
                  viewerId={viewerId}
                />

                {activeConversation ? (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    {/* Conversation Header */}
                    <div className="flex-shrink-0 border-b p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex min-w-0 flex-1 items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setActiveConversation(null)}
                            className="-ml-2 mr-2 shrink-0"
                          >
                            <ArrowLeftIcon className="h-5 w-5" />
                          </Button>
                          <div className="min-w-0">
                            <h3 className="truncate font-medium">
                              {activeConversation.title || "Question"}
                            </h3>
                          </div>
                        </div>
                        <Button
                          variant={
                            activeConversation.receiveNotifications
                              ? "default"
                              : "ghost"
                          }
                          size="icon"
                          onClick={async () => {
                            try {
                              const response = await fetch(
                                `/api/conversations/notifications`,
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    conversationId: activeConversation.id,
                                    viewerId: viewerId,
                                    enabled:
                                      !activeConversation.receiveNotifications,
                                  }),
                                },
                              );

                              if (!response.ok)
                                throw new Error(
                                  "Failed to toggle notifications",
                                );

                              // Update the local state
                              setActiveConversation((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      receiveNotifications:
                                        !prev.receiveNotifications,
                                    }
                                  : null,
                              );

                              toast.success(
                                `Notifications ${!activeConversation.receiveNotifications ? "enabled" : "disabled"}`,
                              );
                            } catch (error) {
                              console.error(
                                "Error toggling notifications:",
                                error,
                              );
                              toast.error("Failed to toggle notifications");
                            }
                          }}
                        >
                          {activeConversation.receiveNotifications ? (
                            <BellIcon className="h-5 w-5 text-background" />
                          ) : (
                            <BellOffIcon className="h-5 w-5 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Messages */}
                    <ScrollArea className="flex-1">
                      <div className="flex flex-col gap-2 p-4">
                        {/* Document Context */}
                        <ConversationDocumentContext
                          dataroomDocument={activeConversation.dataroomDocument}
                          documentPageNumber={
                            activeConversation.documentPageNumber
                          }
                          documentVersionNumber={
                            activeConversation.documentVersionNumber
                          }
                          showVersionNumber={false} // Viewers see simplified context
                          className="mb-2"
                        />
                        {activeConversation.messages?.map((message) => (
                          <ConversationMessage
                            key={message.id}
                            message={message}
                            isAuthor={message.viewerId === viewerId}
                            senderEmail={""}
                          />
                        ))}
                      </div>
                    </ScrollArea>

                    {/* Message Input */}
                    <form
                      onSubmit={handleSendMessage}
                      className="flex-shrink-0 border-t p-3"
                    >
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          maxLength={MAX_MESSAGE_LENGTH}
                          className="flex-1 rounded-md border border-input px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Type your message..."
                        />
                        <Button type="submit" disabled={!newMessage.trim()}>
                          Send
                        </Button>
                      </div>
                    </form>
                  </div>
                ) : isNewConversationFormOpen ? (
                  <div className="flex-1 p-4">
                    <div className="mb-4 flex items-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsNewConversationFormOpen(false)}
                        className="-ml-2 mr-2"
                      >
                        <ArrowLeftIcon className="h-5 w-5" />
                      </Button>
                      <h3 className="font-medium">New Question</h3>
                    </div>

                    <form
                      onSubmit={(e: React.FormEvent) => {
                        e.preventDefault();
                        if (!newMessage.trim()) return;

                        handleCreateConversation({
                          initialMessage: newMessage,
                        });
                        setNewMessage("");
                      }}
                      className="space-y-4"
                    >
                      <div>
                        <textarea
                          id="message"
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          maxLength={MAX_MESSAGE_LENGTH}
                          placeholder="Type your question..."
                          className="min-h-[100px] w-full rounded-md border border-input px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          required
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsNewConversationFormOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={!newMessage.trim()}>
                          Ask Question
                        </Button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex-shrink-0 p-4">
                      <Button
                        onClick={() => setIsNewConversationFormOpen(true)}
                        className="w-full"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        New Question
                      </Button>
                    </div>
                    <Separator />
                    <div className="flex-1 overflow-y-auto">
                      <div className="divide-y">
                        {isLoading ? (
                          <div className="space-y-3 p-4">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <div key={i} className="flex flex-col gap-2">
                                <div className="h-5 w-3/4 animate-pulse bg-muted"></div>
                                <div className="h-4 w-1/2 animate-pulse bg-muted"></div>
                                <div className="h-10 w-full animate-pulse bg-muted"></div>
                              </div>
                            ))}
                          </div>
                        ) : conversations.length === 0 ? (
                          <div className="p-4 text-center text-muted-foreground">
                            No questions yet. Ask a new one!
                          </div>
                        ) : (
                          conversations.map((conversation) => {
                            const lastMessage =
                              conversation.messages?.[
                                conversation.messages.length - 1
                              ];
                            const hasUnread = conversation.messages?.some(
                              (msg) =>
                                !msg.isRead &&
                                (msg.userId ||
                                  msg.viewerId !== conversation.viewerId),
                            );

                            return (
                              <div
                                key={conversation.id}
                                className="cursor-pointer p-4 hover:bg-muted/50"
                                onClick={() =>
                                  setActiveConversation(conversation)
                                }
                              >
                                <div className="mb-1 flex items-center justify-between">
                                  <h3 className="truncate font-medium">
                                    {conversation.title || "Untitled question"}
                                  </h3>
                                  {/* {hasUnread && (
                                  <span className="ml-2 inline-flex h-5 items-center rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground">
                                    New
                                  </span>
                                )} */}
                                </div>

                                <div className="mb-2 text-xs text-muted-foreground">
                                  {format(
                                    new Date(conversation.updatedAt),
                                    "MMM d, h:mm a",
                                  )}
                                </div>

                                {lastMessage && (
                                  <p className="line-clamp-2 text-sm">
                                    {lastMessage.content}
                                  </p>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">
                Questions are disabled for this document.
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
