"use client";

import { useRouter } from "next/router";

import { useCallback, useEffect, useState } from "react";

import { LinkType } from "@prisma/client";
import {
  FileTextIcon,
  FolderArchiveIcon,
  Link2Icon,
  ServerIcon,
  XIcon,
} from "lucide-react";
import useSWR from "swr";

import { useTeam } from "@/context/team-context";
import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";
import { DocumentWithLinksAndLinkCountAndViewCount } from "@/lib/types";
import { cn, fetcher } from "@/lib/utils";

import LinkSheet from "@/components/links/link-sheet";
import { DataroomLinkSheet } from "@/components/links/link-sheet/dataroom-link-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type MobileShareFabProps = {
  mode: "global" | "dataroom";
  /** Current dataroom id when `mode === "dataroom"` */
  dataroomId?: string;
};

export function MobileShareFab({ mode, dataroomId }: MobileShareFabProps) {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { datarooms: dataroomList, loading: dataroomsLoading } =
    useDataroomsSimple();

  const [chooseOpen, setChooseOpen] = useState(false);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [drPickerOpen, setDrPickerOpen] = useState(false);
  const [docLinkOpen, setDocLinkOpen] = useState(false);
  const [drLinkOpen, setDrLinkOpen] = useState(false);
  const [dataroomLinkOpen, setDataroomLinkOpen] = useState(false);
  const [pickedDocumentId, setPickedDocumentId] = useState<string | null>(null);
  const [pickedDataroomId, setPickedDataroomId] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState("");
  const [debouncedDocSearch, setDebouncedDocSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedDocSearch(docSearch), 300);
    return () => clearTimeout(t);
  }, [docSearch]);

  useEffect(() => {
    if (!docLinkOpen) {
      setPickedDocumentId(null);
    }
  }, [docLinkOpen]);

  useEffect(() => {
    if (!drLinkOpen) {
      setPickedDataroomId(null);
    }
  }, [drLinkOpen]);

  const documentsUrl =
    teamId && docPickerOpen
      ? `/api/teams/${teamId}/documents?sort=createdAt&page=1&limit=25${
          debouncedDocSearch
            ? `&query=${encodeURIComponent(debouncedDocSearch)}`
            : ""
        }`
      : null;

  const { data: docListData, isLoading: docListLoading } = useSWR<{
    documents: DocumentWithLinksAndLinkCountAndViewCount[];
  }>(documentsUrl, fetcher, { keepPreviousData: true });

  const documents = docListData?.documents ?? [];

  const openDataroomLinkFor = useCallback((id: string) => {
    setPickedDataroomId(id);
    setDrPickerOpen(false);
    setChooseOpen(false);
    setDrLinkOpen(true);
  }, []);

  const handlePlusClick = () => {
    if (mode === "dataroom" && dataroomId) {
      setDataroomLinkOpen(true);
      return;
    }
    setChooseOpen(true);
  };

  const handlePickDocument = (id: string) => {
    setPickedDocumentId(id);
    setDocPickerOpen(false);
    setChooseOpen(false);
    setDocLinkOpen(true);
  };

  const handlePickDataroom = (id: string) => {
    openDataroomLinkFor(id);
  };

  const afterDocumentLinkCreated = useCallback(
    (id: string) => {
      setDocLinkOpen(false);
      void router.push(`/documents/${id}`);
    },
    [router],
  );

  return (
    <>
      <button
        type="button"
        onClick={handlePlusClick}
        aria-label="Create share link"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-white shadow-md ring-4 ring-background [-webkit-tap-highlight-color:transparent] touch-manipulation dark:ring-background"
      >
        <Link2Icon className="h-5 w-5" strokeWidth={2.25} />
      </button>

      {mode === "dataroom" && dataroomId ? (
        <DataroomLinkSheet
          isOpen={dataroomLinkOpen}
          setIsOpen={setDataroomLinkOpen}
          linkType={LinkType.DATAROOM_LINK}
          linkTargetId={dataroomId}
        />
      ) : null}

      <Sheet open={chooseOpen} onOpenChange={setChooseOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Share</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start gap-3 py-4 text-left"
              onClick={() => {
                setChooseOpen(false);
                setDocPickerOpen(true);
              }}
            >
              <FileTextIcon className="h-5 w-5 shrink-0" />
              <span>
                <span className="block font-medium">Document</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Create a link to a document
                </span>
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start gap-3 py-4 text-left"
              onClick={() => {
                setChooseOpen(false);
                setDrPickerOpen(true);
              }}
            >
              <FolderArchiveIcon className="h-5 w-5 shrink-0" />
              <span>
                <span className="block font-medium">Dataroom</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Create a link to a data room
                </span>
              </span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={docPickerOpen} onOpenChange={setDocPickerOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col rounded-t-xl border-t px-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
        >
          <SheetHeader className="space-y-3 px-4 text-left">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle>Choose document</SheetTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setDocPickerOpen(false)}
              >
                <XIcon className="h-5 w-5" />
              </Button>
            </div>
            <Input
              placeholder="Search documents…"
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              className="bg-muted/50"
            />
          </SheetHeader>
          <ScrollArea className="mt-2 min-h-0 flex-1 px-2">
            <div className="space-y-0.5 pb-4">
              {docListLoading && !documents.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : documents.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No documents found.
                </p>
              ) : (
                documents.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => handlePickDocument(doc.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors",
                      "hover:bg-muted",
                    )}
                  >
                    <FileTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {doc.name}
                    </span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <Sheet open={drPickerOpen} onOpenChange={setDrPickerOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col rounded-t-xl border-t px-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
        >
          <SheetHeader className="px-4 text-left">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle>Choose dataroom</SheetTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setDrPickerOpen(false)}
              >
                <XIcon className="h-5 w-5" />
              </Button>
            </div>
          </SheetHeader>
          <ScrollArea className="mt-2 min-h-0 flex-1 px-2">
            <div className="space-y-0.5 pb-4">
              {dataroomsLoading && !dataroomList?.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : !dataroomList?.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No datarooms yet.
                </p>
              ) : (
                dataroomList.map((dr) => (
                  <button
                    key={dr.id}
                    type="button"
                    onClick={() => handlePickDataroom(dr.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors",
                      "hover:bg-muted",
                    )}
                  >
                    <ServerIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {dr.internalName || dr.name}
                    </span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {pickedDocumentId ? (
        <LinkSheet
          isOpen={docLinkOpen}
          setIsOpen={setDocLinkOpen}
          linkType={LinkType.DOCUMENT_LINK}
          linkTargetId={pickedDocumentId}
          onLinkCreatedNavigate={afterDocumentLinkCreated}
        />
      ) : null}

      {pickedDataroomId ? (
        <DataroomLinkSheet
          isOpen={drLinkOpen}
          setIsOpen={setDrLinkOpen}
          linkType={LinkType.DATAROOM_LINK}
          linkTargetId={pickedDataroomId}
        />
      ) : null}
    </>
  );
}
