import Link from "next/link";
import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { ConversationListItem } from "@/ee/features/conversations/components/dashboard/conversation-list-item";
import {
  BookOpenCheckIcon,
  Loader2,
  MessageSquare,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import z from "zod";

import { useDocument } from "@/lib/swr/use-document";
import { fetcher } from "@/lib/utils";

import DocumentHeader from "@/components/documents/document-header";
import { NavMenu } from "@/components/navigation-menu";
import AppLayout from "@/components/layouts/app";
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

export interface ConversationSummary {
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

export default function DocumentConversationOverviewPage() {
  const router = useRouter();
  const { document, primaryVersion } = useDocument();
  const { currentTeamId: teamId } = useTeam();
  const [searchQuery, setSearchQuery] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState("conversations");

  const documentId = router.query.id as string;

  // SWR hook for fetching conversation summaries for document
  const { data: conversations = [], isLoading: isLoadingConversations } =
    useSWR<ConversationSummary[]>(
      documentId && teamId
        ? `/api/teams/${teamId}/documents/${documentId}/conversations`
        : null,
      fetcher,
      {
        revalidateOnFocus: true,
        dedupingInterval: 10000,
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
  const filteredConversations = conversations.filter((conversation) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();

    // Search by viewer email
    if (conversation.viewerEmail?.toLowerCase().includes(query)) return true;

    // Search in conversation titles and last messages
    return (
      conversation.title?.toLowerCase().includes(query) ||
      conversation.lastMessage?.content.toLowerCase().includes(query) ||
      conversation.documentName?.toLowerCase().includes(query)
    );
  });

  // Handle conversation deletion
  const handleDeleteConversation = async () => {
    if (!conversationToDelete || !documentId || !teamId) return;

    setIsDeleting(true);
    try {
      const teamIdParsed = z.string().cuid().parse(teamId);
      const documentIdParsed = z.string().cuid().parse(documentId);
      const conversationToDeleteParsed = z
        .string()
        .cuid()
        .parse(conversationToDelete);

      const response = await fetch(
        `/api/teams/${teamIdParsed}/documents/${documentIdParsed}/conversations/${conversationToDeleteParsed}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) throw new Error("Failed to delete conversation");

      toast.success("Conversation deleted successfully");
    } catch (error) {
      console.error("Error deleting conversation:", error);
      toast.error("Failed to delete conversation");
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
      setConversationToDelete(null);
    }
  };

  // Navigate to conversation detail
  const navigateToConversation = (conversationId: string) => {
    router.push(`/documents/${documentId}/conversations/${conversationId}`);
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

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList>
            <TabsTrigger
              value="conversations"
              className="flex items-center gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Conversations
              <Badge variant="notification">{conversations.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="conversations" className="space-y-0">
            <div className="h-[calc(100vh-20rem)] overflow-hidden rounded-md border">
              <div className="flex h-full flex-col md:flex-row">
                {/* Sidebar with conversations list */}
                <div className="flex h-full w-full flex-col border-r md:w-96">
                  <div className="flex items-center p-4">
                    <div className="relative w-full">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
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
                                  isActive={false}
                                />
                              ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                </div>

                {/* Empty state for the right panel */}
                <div className="hidden flex-1 items-center justify-center md:flex">
                  <div className="text-center">
                    <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">
                      Select a conversation
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Choose a conversation to view and reply
                    </p>
                  </div>
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
    </AppLayout>
  );
}

