import Link from "next/link";
import { useRouter } from "next/router";

import React, { useEffect, useState } from "react";

import { ConversationListItem } from "@/ee/features/conversations/components/dashboard/conversation-list-item";
import { PublishFAQModal } from "@/ee/features/conversations/components/dashboard/publish-faq-modal";
import { ConversationDocumentContext } from "@/ee/features/conversations/components/shared/conversation-document-context";
import { ConversationMessage } from "@/ee/features/conversations/components/shared/conversation-message";
import {
  BookOpenCheckIcon,
  Loader2,
  MessageSquare,
  SearchIcon,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import z from "zod";

import { useDataroom } from "@/lib/swr/use-dataroom";
import { CustomUser } from "@/lib/types";
import { fetcher } from "@/lib/utils";
import { MAX_MESSAGE_LENGTH } from "@/lib/utils/sanitize-html";

import { DataroomHeader } from "@/components/datarooms/dataroom-header";
import { DataroomNavigation } from "@/components/datarooms/dataroom-navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { PublishedFAQ } from "./faq-overview";

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
  dataroomDocument?: {
    document: {
      name: string;
    };
  };
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
  dataroomDocument?: {
    document: {
      name: string;
    };
  };
}

export default function ConversationDetailPage() {
  const router = useRouter();
  const { dataroom } = useDataroom();
  const { data: session } = useSession();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPublishFAQModalOpen, setIsPublishFAQModalOpen] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    null,
  );
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const { conversationId, id: dataroomId } = router.query;
  const teamId = router.query.teamId || dataroom?.teamId;

  const [searchQuery, setSearchQuery] = useState("");

  // Clear selections when switching conversations
  useEffect(() => {
    setSelectedQuestionId(null);
    setSelectedAnswerId(null);
  }, [conversationId]);

  // Auto-select latest question and answer
  const autoSelectLatestQA = () => {
    if (!conversation) return;

    // Find latest visitor message (question)
    const visitorMessages = conversation.messages.filter(
      (msg) => msg.viewerId !== null,
    );
    const latestQuestion = visitorMessages[visitorMessages.length - 1];

    // Find latest admin message (answer)
    const adminMessages = conversation.messages.filter(
      (msg) => msg.userId !== null,
    );
    const latestAnswer = adminMessages[adminMessages.length - 1];

    if (latestQuestion) setSelectedQuestionId(latestQuestion.id);
    if (latestAnswer) setSelectedAnswerId(latestAnswer.id);
  };

  // Handle message selection for FAQ publishing
  const handleMessageSelect = (messageId: string, isVisitor: boolean) => {
    if (isVisitor) {
      // Selecting/deselecting a question
      setSelectedQuestionId((prev) => (prev === messageId ? null : messageId));
    } else {
      // Selecting/deselecting an answer
      setSelectedAnswerId((prev) => (prev === messageId ? null : messageId));
    }
  };

  const getSelectedMessages = () => {
    if (!conversation || !selectedQuestionId || !selectedAnswerId) return null;

    const questionMessage = conversation.messages.find(
      (m) => m.id === selectedQuestionId,
    );
    const answerMessage = conversation.messages.find(
      (m) => m.id === selectedAnswerId,
    );

    return { questionMessage, answerMessage };
  };

  // SWR hook for fetching the conversation with messages
  const { data: conversation, isLoading } = useSWR<Conversation>(
    conversationId && dataroomId && teamId
      ? `/api/teams/${teamId}/datarooms/${dataroomId}/conversations/${conversationId}`
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
      dataroomId && teamId
        ? `/api/teams/${teamId}/datarooms/${dataroomId}/conversations`
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

  // Fetch published FAQs
  const { data: faqs = [] } = useSWR<PublishedFAQ[]>(
    dataroom && teamId
      ? `/api/teams/${teamId}/datarooms/${dataroom.id}/faqs`
      : null,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000,
      keepPreviousData: true,
    },
  );

  // Filter conversations based on search query
  const filteredConversations = conversations.filter((conversation) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();

    // Search by viewer email
    if (conversation.viewerEmail?.toLowerCase().includes(query)) return true;

    // Search in conversation titles and last messages
    return (
      conversation.title?.toLowerCase().includes(query) ||
      conversation.lastMessage?.content.toLowerCase().includes(query) ||
      conversation.dataroomDocument?.document.name.toLowerCase().includes(query)
    );
  });

  const isPublishFAQDisabled =
    !conversation?.messages.some((msg) => msg.viewerId !== null) ||
    !conversation?.messages.some((msg) => msg.userId !== null);

  // Mark messages as read
  const markMessagesAsRead = async (conversationId: string) => {
    if (!dataroomId || !teamId) return;

    try {
      const conversationIdParsed = z.string().cuid().parse(conversationId);
      const dataroomIdParsed = z.string().cuid().parse(dataroomId);
      const teamIdParsed = z.string().cuid().parse(teamId);
      const response = await fetch(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations/${conversationIdParsed}/read`,
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
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations/${conversationIdParsed}`,
      );
      mutate(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations`,
      );
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  };

  // Handle conversation deletion
  const handleDeleteConversation = async () => {
    if (!conversation || !dataroomId || !teamId) return;

    setIsDeleting(true);
    try {
      const conversationIdParsed = z.string().cuid().parse(conversation.id);
      const dataroomIdParsed = z.string().cuid().parse(dataroomId);
      const teamIdParsed = z.string().cuid().parse(teamId);
      const response = await fetch(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations/${conversationIdParsed}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) throw new Error("Failed to delete conversation");

      // Revalidate the summaries
      mutate(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations`,
      );

      // Navigate back to conversations list
      router.push(`/datarooms/${dataroomIdParsed}/conversations`);

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
    if (!newMessage.trim() || !conversation || !dataroomId || !teamId) return;

    try {
      const conversationIdParsed = z.string().cuid().parse(conversation.id);
      const dataroomIdParsed = z.string().cuid().parse(dataroomId);
      const teamIdParsed = z.string().cuid().parse(teamId);
      const response = await fetch(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations/${conversationIdParsed}/messages`,
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

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to send message");
      }

      // Revalidate both the conversation and the summaries
      mutate(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations/${conversationIdParsed}`,
      );
      mutate(
        `/api/teams/${teamIdParsed}/datarooms/${dataroomIdParsed}/conversations`,
      );

      toast.success("Message sent");
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to send message",
      );
    }
  };

  // Navigate to a different conversation
  const navigateToConversation = (id: string) => {
    router.push(`/datarooms/${dataroomId}/conversations/${id}`);
  };

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 my-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <header>
          <DataroomHeader title={dataroom.name} description={dataroom.pId} internalName={dataroom.internalName} />
          <DataroomNavigation dataroomId={dataroom.id} />
        </header>

        <Tabs value="conversations" className="space-y-6">
          <TabsList>
            <TabsTrigger
              value="conversations"
              className="flex items-center gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Conversations
              <Badge variant="notification">{conversations.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="faqs" asChild>
              <Link
                href={`/datarooms/${dataroom.id}/conversations/faqs`}
                className="flex items-center gap-2"
              >
                <BookOpenCheckIcon className="h-4 w-4" />
                Published FAQs
                <Badge variant="notification">{faqs.length}</Badge>
              </Link>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="conversations" className="space-y-0">
            <div className="h-[calc(100vh-20rem)] overflow-hidden rounded-md border">
              <div className="flex h-full flex-col md:flex-row">
                {/* Sidebar with conversations list */}
                <div className="flex h-full w-full flex-col border-r md:w-96">
                  {/* <div className="flex items-center justify-between p-4">
                    <h2 className="text-lg font-semibold">Conversations</h2>
                    <Badge variant="secondary">{conversations.length}</Badge>
                  </div> */}

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
                              .map((conversation) => (
                                <ConversationListItem
                                  key={conversation.id}
                                  navigateToConversation={
                                    navigateToConversation
                                  }
                                  conversation={conversation}
                                  isActive={conversation.id === conversationId}
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
                            <AvatarImage
                              src={`/api/og/avatar/${encodeURIComponent(conversation.participants[0].email || "user")}`}
                            />
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
                          {(selectedQuestionId || selectedAnswerId) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Clear message selections"
                              onClick={() => {
                                setSelectedQuestionId(null);
                                setSelectedAnswerId(null);
                              }}
                            >
                              <X className="mr-1 h-4 w-4" />
                              Clear
                            </Button>
                          )}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (
                                      selectedQuestionId &&
                                      selectedAnswerId
                                    ) {
                                      setIsPublishFAQModalOpen(true);
                                    } else {
                                      autoSelectLatestQA();
                                    }
                                  }}
                                  disabled={isPublishFAQDisabled}
                                >
                                  <BookOpenCheckIcon className="mr-2 h-4 w-4" />
                                  {selectedQuestionId && selectedAnswerId
                                    ? "Publish FAQ"
                                    : "Select messages to publish"}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>
                                  {isPublishFAQDisabled
                                    ? "Need both visitor questions and admin answers to publish FAQ"
                                    : selectedQuestionId && selectedAnswerId
                                      ? "Publish selected question and answer as FAQ"
                                      : "Select the latest question and answer for FAQ publishing"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
                          {/* Document Context */}
                          <ConversationDocumentContext
                            dataroomDocument={conversation.dataroomDocument}
                            documentPageNumber={conversation.documentPageNumber}
                            documentVersionNumber={
                              conversation.documentVersionNumber
                            }
                            showVersionNumber={true} // Admin sees full context
                            className="mb-2"
                          />

                          {/* Selection Guidance */}
                          {/* {conversation.messages.length > 1 && (
                        <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                          <div className="flex items-start gap-2">
                            <BookOpenCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
                            <div className="text-blue-800">
                              {!selectedQuestionId && !selectedAnswerId ? (
                                <p>
                                  <strong>💡 Step 1:</strong> Click "Select
                                  messages to publish" to automatically choose
                                  the latest question and answer, or manually
                                  select different messages by clicking them
                                  first.
                                </p>
                              ) : selectedQuestionId && !selectedAnswerId ? (
                                <p>
                                  <strong>Question selected!</strong> Now select
                                  an admin answer to complete your FAQ pair.
                                </p>
                              ) : !selectedQuestionId && selectedAnswerId ? (
                                <p>
                                  <strong>Answer selected!</strong> Now select a
                                  visitor question to complete your FAQ pair.
                                </p>
                              ) : (
                                <p>
                                  <strong>Step 2:</strong> Perfect! Both
                                  question and answer are selected. Click
                                  "Publish FAQ" to review and publish.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )} */}
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
                              isSelectable={true}
                              isSelected={
                                message.id === selectedQuestionId ||
                                message.id === selectedAnswerId
                              }
                              onSelect={handleMessageSelect}
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
          </TabsContent>
        </Tabs>
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

      {/* Publish FAQ Modal */}
      {conversation && (
        <PublishFAQModal
          conversation={conversation}
          dataroomId={dataroomId as string}
          teamId={teamId as string}
          isOpen={isPublishFAQModalOpen}
          onClose={() => {
            setIsPublishFAQModalOpen(false);
            // Keep selections when modal closes so user can reselect
          }}
          onSuccess={() => {
            // Reset selections after successful publish
            setSelectedQuestionId(null);
            setSelectedAnswerId(null);
            toast.success("FAQ published successfully!");
            mutate(
              teamId && dataroom?.id
                ? `/api/teams/${teamId}/datarooms/${dataroom.id}/faqs`
                : null,
            );
          }}
          selectedQuestionMessage={getSelectedMessages()?.questionMessage}
          selectedAnswerMessage={getSelectedMessages()?.answerMessage}
        />
      )}
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
  const isOverLimit = newMessage.length > MAX_MESSAGE_LENGTH;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isOverLimit) return;

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
          className={`min-h-[100px] ${isOverLimit ? "border-destructive focus-visible:ring-destructive" : ""}`}
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <span
            className={`text-xs ${isOverLimit ? "font-medium text-destructive" : "text-muted-foreground"}`}
          >
            {newMessage.length > 0 &&
              `${newMessage.length} / ${MAX_MESSAGE_LENGTH}`}
          </span>
          <Button
            type="submit"
            disabled={!newMessage.trim() || isOverLimit || isSending}
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
