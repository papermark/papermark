import { useEffect, useRef, useState } from "react";

import useSWR from "swr";

import { fetcher } from "@/lib/utils";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface FAQ {
  id: string;
  editedQuestion: string;
  answer: string;
  title?: string;
  tags: string[];
  viewCount: number;
  description?: string;
  documentPageNumber?: number;
  documentVersionNumber?: number;
  createdAt: string;
}

interface FAQSectionProps {
  dataroomId?: string;
  linkId: string;
  documentId?: string;
  viewerId?: string;
}

export function FAQSection({
  dataroomId,
  linkId,
  documentId,
  viewerId,
}: FAQSectionProps) {
  const [viewedFAQs, setViewedFAQs] = useState<Set<string>>(new Set());
  const [showTopBlur, setShowTopBlur] = useState(false);
  const [showBottomBlur, setShowBottomBlur] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Fetch FAQs for this dataroom/link/document
  const { data: faqs = [], isLoading } = useSWR<FAQ[]>(
    `/api/faqs?${new URLSearchParams({
      ...(dataroomId && { dataroomId }),
      ...(linkId && { linkId }),
      ...(documentId && { documentId }),
    }).toString()}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000, // 30 seconds
      keepPreviousData: true,
    },
  );

  const handleAccordionChange = async (openItems: string[]) => {
    // Track views for newly opened items
    const newlyOpened = openItems.filter((item) => !viewedFAQs.has(item));

    for (const faqId of newlyOpened) {
      try {
        const params = new URLSearchParams({
          ...(dataroomId && { dataroomId }),
          ...(linkId && { linkId }),
        });

        await fetch(`/api/faqs/${faqId}?${params.toString()}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        // Mark as viewed
        setViewedFAQs((prev) => new Set(prev).add(faqId));
      } catch (error) {
        console.error("Error tracking FAQ view:", error);
      }
    }
  };

  // Check scroll position to show/hide blur effects
  const checkScrollPosition = () => {
    const scrollElement = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (!scrollElement) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollElement;

    setShowTopBlur(scrollTop > 10);
    setShowBottomBlur(scrollTop < scrollHeight - clientHeight - 10);
  };

  // Set up scroll listeners and initial check
  useEffect(() => {
    const scrollElement = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (!scrollElement) return;

    // Initial check and delayed check for content that loads after render
    checkScrollPosition();
    const timeoutId = setTimeout(checkScrollPosition, 100);

    scrollElement.addEventListener("scroll", checkScrollPosition);
    return () => {
      scrollElement.removeEventListener("scroll", checkScrollPosition);
      clearTimeout(timeoutId);
    };
  }, [faqs]);

  if (isLoading) {
    return (
      <>
        <div className="bg-gray-50 p-4 dark:bg-gray-900">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-medium text-primary">
              Frequently Asked Questions
            </h3>
            <div className="h-5 w-5 animate-pulse rounded bg-muted"></div>
          </div>

          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-md border border-gray-200 bg-white"
              >
                <div className="px-3 py-2.5">
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="h-5 w-5 animate-pulse rounded bg-muted"></div>
                    <div className="h-5 w-full animate-pulse rounded bg-muted"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <Separator />
      </>
    );
  }

  if (faqs.length === 0) {
    return (
      <>
        <div className="bg-gray-50 p-4 dark:bg-gray-900">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-medium text-primary">
              Frequently Asked Questions
            </h3>
            <Badge
              variant="notification"
              className="bg-primary/80 text-xs text-primary-foreground"
            >
              0
            </Badge>
          </div>
          <div className="space-y-2 text-sm">No questions published yet.</div>
        </div>
        <Separator />
      </>
    );
  }

  return (
    <>
      <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-900">
        <div className="px-4 pb-2 pt-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-medium text-primary">
              Frequently Asked Questions
            </h3>
            <Badge
              variant="notification"
              className="bg-primary/80 text-xs text-primary-foreground"
            >
              {faqs.length}
            </Badge>
          </div>
        </div>

        <div className="relative px-4">
          <ScrollArea className="h-fit" ref={scrollAreaRef}>
            <div className="max-h-80">
              <Accordion
                type="multiple"
                defaultValue={faqs.length > 0 ? [faqs[0].id] : []}
                onValueChange={handleAccordionChange}
                className="space-y-2 last:pb-4"
              >
                {faqs.map((faq) => (
                  <AccordionItem
                    key={faq.id}
                    value={faq.id}
                    className="rounded-md border border-gray-200 bg-white"
                  >
                    <AccordionTrigger className="min-w-0 px-3 py-2.5 hover:no-underline">
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="flex-shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                          Q
                        </span>
                        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-left text-sm font-medium text-gray-900">
                          {faq.editedQuestion}
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="rounded-b-md bg-muted px-3 pb-3 text-foreground">
                      <div className="space-y-2 pt-3">
                        <div className="flex items-start gap-2">
                          <span className="flex-shrink-0 rounded bg-primary/80 px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                            A
                          </span>
                          <p className="min-w-0 break-words whitespace-pre-wrap text-sm font-medium text-gray-700">
                            {faq.answer}
                          </p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </ScrollArea>

          {/* Scroll blur indicators */}
          {showTopBlur && (
            <div className="pointer-events-none absolute left-4 right-4 top-0 z-10 h-6 bg-gradient-to-b from-gray-50 via-gray-50/80 to-transparent dark:from-gray-900 dark:via-gray-900/80" />
          )}
          {showBottomBlur && (
            <div className="pointer-events-none absolute bottom-0 left-4 right-4 z-10 h-6 bg-gradient-to-t from-gray-50 via-gray-50/80 to-transparent dark:from-gray-900 dark:via-gray-900/80" />
          )}
        </div>
      </div>
      <Separator />
    </>
  );
}
