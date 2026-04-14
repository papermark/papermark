"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { EyeIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { usePlan } from "@/lib/swr/use-billing";
import { uploadImage } from "@/lib/utils";

import PlanBadge from "@/components/billing/plan-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { ScrollArea } from "@/components/ui/scroll-area";

interface IntroductionSettingsProps {
  dataroomId: string;
}

interface FolderItem {
  id: string;
  name: string;
  documents?: { document: { name: string } }[];
}

interface DocumentItem {
  document: { name: string };
}

// Generate TipTap JSON content for introduction based on dataroom structure
function generateIntroductionContent(
  dataroomName: string,
  folders: FolderItem[],
  rootDocuments: DocumentItem[],
): any {
  const content: any[] = [];

  // Overview paragraph (no "Welcome to" repetition)
  content.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: `This data room contains confidential documents and materials prepared for your review. Please take a moment to familiarize yourself with the structure below.`,
      },
    ],
  });

  // What's Inside section
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "What's Inside" }],
  });

  // If there are folders, list them
  if (folders.length > 0) {
    const folderList = {
      type: "bulletList",
      content: folders.slice(0, 8).map((folder) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: folder.name,
                marks: [{ type: "bold" }],
              },
              ...(folder.documents && folder.documents.length > 0
                ? [
                    {
                      type: "text",
                      text: ` — ${folder.documents.length} document${folder.documents.length > 1 ? "s" : ""}`,
                    },
                  ]
                : []),
            ],
          },
        ],
      })),
    };
    content.push(folderList);

    if (folders.length > 8) {
      content.push({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `...and ${folders.length - 8} more sections.`,
          },
        ],
      });
    }
  } else {
    // Show placeholder sections if dataroom is empty
    const placeholderList = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Section 1", marks: [{ type: "bold" }] },
                { type: "text", text: " — Company Overview & Key Documents" },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Section 2", marks: [{ type: "bold" }] },
                { type: "text", text: " — Financial Information" },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Section 3", marks: [{ type: "bold" }] },
                { type: "text", text: " — Legal & Compliance" },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Section 4", marks: [{ type: "bold" }] },
                { type: "text", text: " — Additional Materials" },
              ],
            },
          ],
        },
      ],
    };
    content.push(placeholderList);
  }

  // If there are root documents, mention them
  if (rootDocuments.length > 0) {
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `There ${rootDocuments.length === 1 ? "is" : "are"} also ${rootDocuments.length} document${rootDocuments.length > 1 ? "s" : ""} available at the root level for quick access.`,
        },
      ],
    });
  }

  // How to Navigate section
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "How to Navigate" }],
  });

  content.push({
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Use the sidebar on the left to browse sections and folders",
              },
            ],
          },
        ],
      },
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Click on any document to open and view it",
              },
            ],
          },
        ],
      },
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Use the search function to find specific documents quickly",
              },
            ],
          },
        ],
      },
    ],
  });

  // Placeholder for navigation screenshot

  // Q&A and Conversations section
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Q&A and Conversations" }],
  });

  content.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "Have questions about specific documents? You can start a conversation directly within the data room. Use the chat feature to ask questions and get answers from our team.",
      },
    ],
  });

  content.push({
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Click the chat icon to start a new conversation",
              },
            ],
          },
        ],
      },
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Ask questions about any document or section",
              },
            ],
          },
        ],
      },
      {
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Receive timely responses from our team",
              },
            ],
          },
        ],
      },
    ],
  });

  // Placeholder for conversations screenshot

  // Need Help section
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Need Help?" }],
  });

  content.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "If you have any questions or need assistance, please reach out to your designated contact. We're here to help you navigate this data room effectively.",
      },
    ],
  });

  return {
    type: "doc",
    content,
  };
}

// Helper to render inline text nodes with marks (bold, italic, etc.)
function renderInlineContent(nodes: any[] | undefined): React.ReactNode {
  if (!nodes) return null;

  return nodes.map((textNode: any, textIndex: number) => {
    if (textNode.type === "text") {
      let text: React.ReactNode = textNode.text;
      if (textNode.marks) {
        textNode.marks.forEach((mark: any) => {
          if (mark.type === "bold") {
            text = (
              <strong key={`bold-${textIndex}`} className="font-semibold">
                {text}
              </strong>
            );
          } else if (mark.type === "italic") {
            text = (
              <em key={`italic-${textIndex}`} className="italic">
                {text}
              </em>
            );
          }
        });
      }
      return <React.Fragment key={textIndex}>{text}</React.Fragment>;
    } else if (textNode.type === "image") {
      return (
        <img
          key={textIndex}
          src={textNode.attrs?.src}
          alt={textNode.attrs?.alt || ""}
          className="my-2 h-auto max-w-full rounded-md"
        />
      );
    }
    return null;
  });
}

// Render TipTap JSON content for preview
function renderContent(content: any): React.ReactNode {
  if (!content || !content.content) return null;

  return content.content.map((node: any, index: number) => {
    if (node.type === "heading") {
      const level = node.attrs?.level || 1;
      const text = node.content?.[0]?.text || "";
      if (level === 1) {
        return (
          <h1
            key={index}
            className="mb-3 mt-4 text-xl font-bold text-gray-900 first:mt-0"
          >
            {text}
          </h1>
        );
      }
      return (
        <h2
          key={index}
          className="mb-2 mt-4 text-base font-semibold text-gray-800 first:mt-0"
        >
          {text}
        </h2>
      );
    } else if (node.type === "paragraph") {
      return (
        <p key={index} className="mb-3 text-sm leading-relaxed text-gray-700">
          {renderInlineContent(node.content)}
        </p>
      );
    } else if (node.type === "bulletList") {
      return (
        <ul key={index} className="mb-3 list-disc pl-5 text-sm text-gray-700">
          {node.content?.map((item: any, itemIndex: number) => (
            <li key={itemIndex} className="mb-1">
              {renderInlineContent(item.content?.[0]?.content)}
            </li>
          ))}
        </ul>
      );
    } else if (node.type === "orderedList") {
      return (
        <ol
          key={index}
          className="mb-3 list-decimal pl-5 text-sm text-gray-700"
        >
          {node.content?.map((item: any, itemIndex: number) => (
            <li key={itemIndex} className="mb-1">
              {renderInlineContent(item.content?.[0]?.content)}
            </li>
          ))}
        </ol>
      );
    } else if (node.type === "blockquote") {
      return (
        <blockquote
          key={index}
          className="mb-3 border-l-4 border-gray-300 pl-4 italic text-gray-600"
        >
          {node.content?.map((p: any) =>
            p.content?.map((textNode: any) =>
              textNode.type === "text" ? textNode.text : null,
            ),
          )}
        </blockquote>
      );
    } else if (node.type === "image") {
      return (
        <img
          key={index}
          src={node.attrs?.src}
          alt={node.attrs?.alt || ""}
          className="my-3 h-auto max-w-full rounded-md"
        />
      );
    } else if (node.type === "youtube") {
      // Extract video ID from the src URL
      const src = node.attrs?.src || "";
      let videoId = "";

      // Handle different YouTube URL formats
      const youtubeMatch = src.match(
        /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([^?&]+)/,
      );
      if (youtubeMatch) {
        videoId = youtubeMatch[1];
      }

      if (!videoId) return null;

      return (
        <div key={index} className="my-4 aspect-video w-full">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}`}
            title="YouTube video"
            className="h-full w-full rounded-lg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      );
    }
    return null;
  });
}

export default function IntroductionSettings({
  dataroomId,
}: IntroductionSettingsProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { isDataroomsPlus, isTrial } = usePlan();

  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [introductionEnabled, setIntroductionEnabled] = useState(false);
  const [introductionContent, setIntroductionContent] = useState<any>({
    type: "doc",
    content: [],
  });
  const [showPreview, setShowPreview] = useState(false);
  const [dataroomName, setDataroomName] = useState<string>("Data Room");

  const isFeatureAvailable = isDataroomsPlus || isTrial;
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitialLoadRef = useRef(false);
  const skipNextAutosaveRef = useRef(false);

  // Fetch current introduction settings from dataroom
  useEffect(() => {
    const fetchSettings = async () => {
      if (!teamId) return;

      try {
        const response = await fetch(
          `/api/teams/${teamId}/datarooms/${dataroomId}`,
        );
        if (response.ok) {
          const data = await response.json();
          setIntroductionEnabled(data.introductionEnabled || false);
          setDataroomName(data.name || "Data Room");

          const existingContent = data.introductionContent;
          const hasExistingContent =
            existingContent?.content && existingContent.content.length > 0;

          if (hasExistingContent) {
            setIntroductionContent(existingContent);
          } else {
            // Auto-generate introduction if empty
            try {
              const foldersResponse = await fetch(
                `/api/teams/${teamId}/datarooms/${dataroomId}/folders?include_documents=true`,
              );

              let folders: FolderItem[] = [];
              let rootDocuments: DocumentItem[] = [];

              if (foldersResponse.ok) {
                const foldersData = await foldersResponse.json();
                folders = foldersData.filter(
                  (item: any) => item.name && !item.document,
                );
                rootDocuments = foldersData.filter(
                  (item: any) => item.document,
                );
              }

              const generatedContent = generateIntroductionContent(
                data.name || "Data Room",
                folders,
                rootDocuments,
              );
              setIntroductionContent(generatedContent);
            } catch (genError) {
              console.error("Failed to auto-generate introduction:", genError);
              setIntroductionContent({ type: "doc", content: [] });
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch introduction settings:", error);
      } finally {
        setIsFetching(false);
        hasInitialLoadRef.current = true;
        skipNextAutosaveRef.current = true;
      }
    };

    fetchSettings();
  }, [teamId, dataroomId]);

  // Auto-save function
  const saveSettings = useCallback(
    async (enabled: boolean, content: any) => {
      if (!teamId || !isFeatureAvailable) return;

      setIsSaving(true);
      try {
        const response = await fetch(
          `/api/teams/${teamId}/datarooms/${dataroomId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              introductionEnabled: enabled,
              introductionContent: content,
            }),
          },
        );

        if (response.ok) {
          await mutate(`/api/teams/${teamId}/datarooms/${dataroomId}`);
        } else {
          toast.error("Failed to save introduction settings");
        }
      } catch (error) {
        console.error("Failed to save introduction settings:", error);
        toast.error("Failed to save introduction settings");
      } finally {
        setIsSaving(false);
      }
    },
    [teamId, dataroomId, isFeatureAvailable],
  );

  // Debounced auto-save on content change
  useEffect(() => {
    if (!hasInitialLoadRef.current) return;

    // Skip the first auto-save pass after initial load
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveSettings(introductionEnabled, introductionContent);
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [introductionContent, introductionEnabled, saveSettings]);

  const handleImageUpload = async (file: File): Promise<string> => {
    try {
      const imageUrl = await uploadImage(file, "assets");
      return imageUrl;
    } catch (error) {
      console.error("Failed to upload image:", error);
      throw new Error("Failed to upload image");
    }
  };

  const handleToggle = (checked: boolean) => {
    if (!isFeatureAvailable) {
      toast.error("This feature is only available on Data Rooms Plus plan");
      return;
    }
    setIntroductionEnabled(checked);
    if (checked) {
      toast.success("Introduction page enabled");
    }
  };

  const hasContent =
    introductionContent?.content && introductionContent.content.length > 0;

  if (isFetching) {
    return (
      <div className="flex items-center justify-center py-10">
        <LoadingSpinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPreview(true)}
          disabled={!hasContent}
        >
          <EyeIcon className="mr-1.5 h-4 w-4" />
          Preview
        </Button>
        <Button
          variant={introductionEnabled ? "default" : "outline"}
          size="sm"
          onClick={() => handleToggle(!introductionEnabled)}
          disabled={!isFeatureAvailable}
        >
          {introductionEnabled ? "Enabled" : "Disabled"}
        </Button>
        {!isFeatureAvailable && <PlanBadge plan="data rooms plus" />}
        {isSaving && (
          <span className="text-xs text-muted-foreground">Saving...</span>
        )}
      </div>

        {/* Rich Text Editor */}
        <div className="space-y-2">
          <RichTextEditor
            content={introductionContent}
            onChange={setIntroductionContent}
            placeholder="Welcome to our data room! Here you'll find..."
            onImageUpload={handleImageUpload}
          />
        </div>

        {/* Preview Dialog */}
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden border-0 p-0 shadow-2xl sm:max-w-xl sm:rounded-2xl md:max-w-2xl">
            <DialogHeader className="border-b border-gray-100 bg-gray-50 px-4 py-6 dark:border-gray-800 dark:bg-gray-900 sm:px-6">
              <p className="mb-1 text-xs text-muted-foreground">
                This is a preview
              </p>
              <DialogTitle className="text-xl font-semibold">
                Welcome to {dataroomName}
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[55vh] px-4 py-5 sm:px-6">
              <div className="prose prose-sm max-w-none dark:prose-invert">
                {renderContent(introductionContent)}
              </div>
            </ScrollArea>
            <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900 sm:px-6 sm:py-4">
              <Button onClick={() => setShowPreview(false)}>
                Continue to Data Room
              </Button>
            </div>
          </DialogContent>
        </Dialog>
    </div>
  );
}
