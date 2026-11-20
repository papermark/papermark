import Link from "next/link";
import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { EditFAQModal } from "@/ee/features/conversations/components/dashboard/edit-faq-modal";
import {
  BookOpenCheckIcon,
  ClockIcon,
  EditIcon,
  EyeIcon,
  FileTextIcon,
  Link2Icon,
  MessageSquare,
  MoreVertical,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import { z } from "zod";

import { useDataroom } from "@/lib/swr/use-dataroom";
import { fetcher, timeAgo } from "@/lib/utils";

import AppLayout from "@/components/layouts/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ConversationSummary } from "./conversation-overview";

const apiParamSchema = z.object({
  teamId: z.string().cuid("Invalid team ID"),
  dataroomId: z.string().cuid("Invalid dataroom ID"),
  faqId: z.string().cuid("Invalid FAQ ID"),
});

export interface PublishedFAQ {
  id: string;
  editedQuestion: string;
  originalQuestion?: string;
  answer: string;
  visibilityMode: "PUBLIC_DATAROOM" | "PUBLIC_LINK" | "PUBLIC_DOCUMENT";
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  dataroom: {
    name: string;
  };
  link?: {
    name: string;
  };
  dataroomDocument?: {
    document: {
      name: string;
    };
  };
  publishedByUser: {
    name: string;
    email: string;
  };
  sourceConversation?: {
    id: string;
  };
  questionMessage?: {
    id: string;
    content: string;
  };
  answerMessage?: {
    id: string;
    content: string;
  };
}

const visibilityIcons = {
  PUBLIC_DATAROOM: ServerIcon,
  PUBLIC_LINK: Link2Icon,
  PUBLIC_DOCUMENT: FileTextIcon,
};

const visibilityLabels = {
  PUBLIC_DATAROOM: "Dataroom",
  PUBLIC_LINK: "Link",
  PUBLIC_DOCUMENT: "Document",
};

export default function FAQOverview() {
  const router = useRouter();
  const { dataroom } = useDataroom();
  const { currentTeamId: teamId } = useTeam();

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [faqToDelete, setFaqToDelete] = useState<string | null>(null);
  const [faqToEdit, setFaqToEdit] = useState<PublishedFAQ | null>(null);

  // Fetch published FAQs
  const {
    data: faqs = [],
    isLoading,
    error,
  } = useSWR<PublishedFAQ[]>(
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

  // SWR hook for fetching conversation summaries
  const { data: conversations = [], isLoading: isLoadingConversations } =
    useSWR<ConversationSummary[]>(
      dataroom && teamId
        ? `/api/teams/${teamId}/datarooms/${dataroom.id}/conversations`
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

  const handleEdit = (faq: PublishedFAQ) => {
    setFaqToEdit(faq);
    setIsEditModalOpen(true);
  };

  const handleStatusToggle = async (faq: PublishedFAQ) => {
    const newStatus = faq.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";

    const paramValidation = apiParamSchema.safeParse({
      teamId,
      dataroomId: dataroom?.id,
      faqId: faq.id,
    });

    if (!paramValidation.success) {
      toast.error("Invalid team, dataroom, or FAQ ID");
      return;
    }

    try {
      const response = await fetch(
        `/api/teams/${paramValidation.data.teamId}/datarooms/${paramValidation.data.dataroomId}/faqs/${paramValidation.data.faqId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: newStatus }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to update FAQ status");
      }

      const isPublish = newStatus === "PUBLISHED";
      toast.success(
        `FAQ ${isPublish ? "published" : "unpublished"} successfully`,
      );
      mutate(
        `/api/teams/${paramValidation.data.teamId}/datarooms/${paramValidation.data.dataroomId}/faqs`,
      );
    } catch (error) {
      console.error("Error updating FAQ status:", error);
      toast.error("Failed to update FAQ status");
    }
  };

  const handleDelete = async (faqId: string) => {
    setIsDeleting(true);

    const paramValidation = apiParamSchema.safeParse({
      teamId,
      dataroomId: dataroom?.id,
      faqId,
    });

    if (!paramValidation.success) {
      toast.error("Invalid team, dataroom, or FAQ ID");
      return;
    }

    try {
      const response = await fetch(
        `/api/teams/${paramValidation.data.teamId}/datarooms/${paramValidation.data.dataroomId}/faqs/${paramValidation.data.faqId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to delete FAQ");
      }

      toast.success("FAQ deleted successfully");
      mutate(
        `/api/teams/${paramValidation.data.teamId}/datarooms/${paramValidation.data.dataroomId}/faqs`,
      );
      setIsDeleteModalOpen(false);
      setFaqToDelete(null);
    } catch (error) {
      console.error("Error deleting FAQ:", error);
      toast.error("Failed to delete FAQ");
    } finally {
      setIsDeleting(false);
    }
  };

  const VisibilityIcon = ({
    mode,
  }: {
    mode: PublishedFAQ["visibilityMode"];
  }) => {
    const Icon = visibilityIcons[mode];
    return <Icon className="h-4 w-4" />;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <p>Loading published FAQs...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <p className="text-destructive">Failed to load FAQs</p>
        </CardContent>
      </Card>
    );
  }

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  if (faqs.length === 0) {
    return (
      <AppLayout>
        <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
          <Tabs defaultValue="faqs" className="space-y-6">
            <TabsList>
              <TabsTrigger value="conversations" asChild>
                <Link
                  href={`/datarooms/${dataroom.id}/conversations`}
                  className="flex items-center gap-2"
                >
                  <MessageSquare className="h-4 w-4" />
                  Conversations
                  <Badge variant="secondary">{conversations.length}</Badge>
                </Link>
              </TabsTrigger>
              <TabsTrigger value="faqs" className="flex items-center gap-2">
                <BookOpenCheckIcon className="h-4 w-4" />
                Published FAQs
                <Badge variant="secondary" className="ml-1">
                  {faqs.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="faqs">
              <Card>
                <CardContent className="flex h-48 flex-col items-center justify-center text-center">
                  <BookOpenCheckIcon className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="mb-2 text-lg font-semibold">
                    No Published FAQs
                  </h3>
                  <p className="text-muted-foreground">
                    Start by publishing FAQs from conversations to help visitors
                    find answers quickly.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <Tabs defaultValue="faqs" className="space-y-6">
          <TabsList>
            <TabsTrigger value="conversations" asChild>
              <Link
                href={`/datarooms/${dataroom.id}/conversations`}
                className="flex items-center gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                Conversations
                <Badge variant="notification">{conversations.length}</Badge>
              </Link>
            </TabsTrigger>
            <TabsTrigger value="faqs" className="flex items-center gap-2">
              <BookOpenCheckIcon className="h-4 w-4" />
              Published FAQs
              <Badge variant="notification">{faqs.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="faqs">
            <Card>
              <CardHeader>
                <CardTitle>Published FAQs</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Question & Answer</TableHead>
                      <TableHead>Visibility</TableHead>
                      <TableHead>Published</TableHead>
                      <TableHead>Published Date</TableHead>
                      <TableHead className="w-12">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {faqs.map((faq) => (
                      <TableRow key={faq.id} className="group">
                        <TableCell className="max-w-md">
                          <div className="space-y-3">
                            {/* Question */}
                            <div>
                              <div className="flex items-start gap-2">
                                <span className="rounded bg-primary/80 px-1.5 py-0.5 text-sm font-medium text-primary-foreground">
                                  Q
                                </span>
                                <div className="line-clamp-2 flex flex-col px-1 py-0.5 text-sm font-medium">
                                  {faq.editedQuestion}
                                </div>
                              </div>
                            </div>

                            {/* Answer */}
                            <div className="flex items-start gap-2">
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-sm font-medium text-foreground group-hover:bg-primary-foreground">
                                A
                              </span>
                              <div className="line-clamp-2 flex flex-col gap-1 rounded-sm bg-muted px-2 py-0.5 text-sm text-foreground group-hover:bg-primary-foreground">
                                {faq.answer}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <VisibilityIcon mode={faq.visibilityMode} />
                            <span className="text-sm">
                              {visibilityLabels[faq.visibilityMode]}
                            </span>
                          </div>
                          {faq.visibilityMode === "PUBLIC_LINK" && faq.link && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {faq.link.name}
                            </p>
                          )}
                          {faq.visibilityMode === "PUBLIC_DOCUMENT" &&
                            faq.dataroomDocument && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {faq.dataroomDocument.document.name}
                              </p>
                            )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={faq.status === "PUBLISHED"}
                              onCheckedChange={() => handleStatusToggle(faq)}
                              aria-label={`${faq.status === "PUBLISHED" ? "Unpublish" : "Publish"} FAQ`}
                            />
                            <span className="text-sm text-muted-foreground">
                              {faq.status === "PUBLISHED" ? "Yes" : "No"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-1">
                            <ClockIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              {timeAgo(new Date(faq.createdAt))}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="icon">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEdit(faq)}>
                                <EditIcon className="mr-1 h-4 w-4" />
                                Edit FAQ
                              </DropdownMenuItem>
                              {faq.sourceConversation && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    router.push(
                                      `/datarooms/${dataroom?.id}/conversations/${faq.sourceConversation?.id}`,
                                    )
                                  }
                                >
                                  <MessageSquare className="mr-1 h-4 w-4" />
                                  View Conversation
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  setFaqToDelete(faq.id);
                                  setIsDeleteModalOpen(true);
                                }}
                              >
                                <Trash2Icon className="mr-1 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Delete Confirmation Modal */}
            <Dialog
              open={isDeleteModalOpen}
              onOpenChange={setIsDeleteModalOpen}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete FAQ</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to delete this FAQ? This action cannot
                    be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsDeleteModalOpen(false)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => faqToDelete && handleDelete(faqToDelete)}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Edit FAQ Modal */}
            {faqToEdit && (
              <EditFAQModal
                faq={faqToEdit}
                dataroomId={dataroom?.id!}
                teamId={teamId!}
                isOpen={isEditModalOpen}
                onClose={() => {
                  setIsEditModalOpen(false);
                  setFaqToEdit(null);
                }}
                onSuccess={() => {
                  mutate(`/api/teams/${teamId}/datarooms/${dataroom?.id}/faqs`);
                  setIsEditModalOpen(false);
                  setFaqToEdit(null);
                }}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
