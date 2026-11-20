"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

import { InfoIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IntroductionModalProps {
  dataroom: {
    id?: string;
    name?: string;
    introductionEnabled?: boolean;
    introductionContent?: any;
  };
  viewerId?: string;
}

// Context to share modal state
interface IntroductionContextType {
  openIntroduction: () => void;
  hasIntroduction: boolean;
  hasSeen: boolean;
}

const IntroductionContext = createContext<IntroductionContextType>({
  openIntroduction: () => {},
  hasIntroduction: false,
  hasSeen: false,
});

export const useIntroduction = () => useContext(IntroductionContext);

// Info button component to be placed inline (e.g., next to dataroom name)
export function IntroductionInfoButton() {
  const { openIntroduction, hasIntroduction, hasSeen } = useIntroduction();
  const { t } = useTranslation("dataroom");

  if (!hasIntroduction) return null;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openIntroduction}
            className={`inline-flex items-center justify-center rounded-full p-1.5 transition-colors ${
              hasSeen
                ? "text-[var(--viewer-muted-text)] hover:bg-[var(--viewer-panel-bg-hover)] hover:text-[var(--viewer-text)]"
                : "border-2 border-[var(--viewer-control-border-strong)] text-[var(--viewer-text)] hover:bg-[var(--viewer-panel-bg-hover)]"
            }`}
            aria-label={t("intro.viewIntroduction", "View introduction")}
          >
            <InfoIcon className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>{t("intro.viewIntroduction", "View introduction")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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

// Render TipTap JSON content
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
            className="mb-3 mt-4 text-xl font-bold text-gray-900 first:mt-0 dark:text-gray-100"
          >
            {text}
          </h1>
        );
      }
      return (
        <h2
          key={index}
          className="mb-2 mt-4 text-base font-semibold text-gray-800 first:mt-0 dark:text-gray-200"
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
          {node.content?.map((p: any, pIndex: number) =>
            p.content?.map((textNode: any, textIndex: number) =>
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

interface IntroductionProviderProps extends IntroductionModalProps {
  children: React.ReactNode;
}

export function IntroductionProvider({
  dataroom,
  viewerId,
  children,
}: IntroductionProviderProps) {
  const { t } = useTranslation("dataroom");
  const [isOpen, setIsOpen] = useState(false);
  const [hasSeen, setHasSeen] = useState(true); // Default to true, will be updated on mount

  const storageKey = `dataroom-intro-seen-${dataroom.id}${viewerId ? `-${viewerId}` : ""}`;

  const content = dataroom.introductionContent as any;
  const hasContent =
    dataroom.introductionEnabled &&
    content?.content &&
    content.content.length > 0;

  useEffect(() => {
    // Check if introduction is enabled and has content
    if (!hasContent) {
      return;
    }

    // Check if user has already seen the introduction
    const seen = localStorage.getItem(storageKey);
    setHasSeen(!!seen);

    // Show modal only first time
    if (!seen) {
      setIsOpen(true);
    }
  }, [hasContent, storageKey]);

  const handleClose = () => {
    setIsOpen(false);
    localStorage.setItem(storageKey, "true");
    setHasSeen(true);
  };

  const openIntroduction = useCallback(() => {
    setIsOpen(true);
  }, []);

  return (
    <IntroductionContext.Provider
      value={{ openIntroduction, hasIntroduction: hasContent, hasSeen }}
    >
      {children}

      {/* Introduction Modal */}
      {hasContent && (
        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleClose();
            } else {
              setIsOpen(true);
            }
          }}
        >
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden border-0 p-0 shadow-2xl sm:max-w-xl sm:rounded-2xl md:max-w-2xl">
            <DialogHeader className="border-b border-gray-100 bg-gray-50 px-6 py-6 dark:border-gray-800 dark:bg-gray-900">
              <DialogTitle className="text-xl font-semibold">
                {t("intro.title", "Welcome to {{name}}", {
                  name: dataroom.name || t("intro.defaultName", "Data Room"),
                })}
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] px-6 py-5">
              <div className="prose prose-sm max-w-none dark:prose-invert">
                {renderContent(content)}
              </div>
            </ScrollArea>
            <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
              <Button onClick={handleClose} size="lg">
                {t("intro.continueButton", "Continue to Data Room")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </IntroductionContext.Provider>
  );
}

// Backwards compatible export
export function IntroductionModal({
  dataroom,
  viewerId,
}: IntroductionModalProps) {
  return (
    <IntroductionProvider dataroom={dataroom} viewerId={viewerId}>
      {null}
    </IntroductionProvider>
  );
}
