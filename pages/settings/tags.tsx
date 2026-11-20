import { useRouter } from "next/router";

import { useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  CircleHelpIcon,
  InfoIcon,
  MoreHorizontalIcon,
  Settings2Icon,
  TagIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { useTags } from "@/lib/swr/use-tags";
import { TagColorProps, tagColors } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Pagination } from "@/components/documents/pagination";
import AppLayout from "@/components/layouts/app";
import {
  COLORS_LIST,
  randomBadgeColor,
} from "@/components/links/link-sheet/tags/tag-badge";
import { SearchBoxPersisted } from "@/components/search-box";
import { SettingsHeader } from "@/components/settings/settings-header";
import { AddTagsModal } from "@/components/tags/add-tag-modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BadgeTooltip } from "@/components/ui/tooltip";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .describe("The name of the tag to create."),
  description: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .describe("The description of the tag to create."),
  color: z.enum(tagColors, {
    required_error: "Please select a color for the tag",
  }),
});

const defaultValue = {
  name: "",
  description: "",
  color: randomBadgeColor(),
  loading: false,
};
export default function TagSetting() {
  const [open, setOpen] = useState(false);
  const teamInfo = useTeam();
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const queryParams = router.query;
  const searchQuery = queryParams["search"];
  const teamId = teamInfo?.currentTeam?.id;
  const [tagForm, setTagForm] = useState<{
    color: TagColorProps;
    name: string;
    description: string | null;
    loading: boolean;
    id?: string;
  }>(defaultValue);

  useEffect(() => {
    if (open && !tagForm.id) {
      setTagForm((prev) => ({ ...prev, color: randomBadgeColor() }));
    }
  }, [open]);

  const {
    tagCount,
    tags: availableTags,
    loading: loadingTags,
    isValidating,
    mutate: mutateTags,
  } = useTags({
    query: {
      sortBy: "createdAt",
      sortOrder: "desc",
      page: currentPage,
      pageSize: pageSize,
      ...(searchQuery ? { search: String(searchQuery) } : {}),
    },
    includeLinksCount: true,
  });

  const handleDeleteTag = async (tagId: string) => {
    toast.promise(
      fetch(`/api/teams/${teamId}/tags/${tagId}`, {
        method: "DELETE",
      }).then(() => {
        mutateTags();
      }),
      {
        loading: "Deleting tag...",
        success: "Tag deleted successfully!",
        error: "Failed to delete Tag. Try again.",
      },
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const validation = schema.safeParse({
      name: tagForm.name,
      description: tagForm.description,
      color: tagForm.color,
    });

    console.log(validation);

    if (!validation.success) {
      return toast.error(validation.error.errors[0].message);
    }

    setTagForm((prev) => ({
      ...prev,
      loading: true,
    }));

    const url = tagForm.id
      ? `/api/teams/${teamId}/tags/${tagForm.id}`
      : `/api/teams/${teamId}/tags`;

    const method = tagForm.id ? "PUT" : "POST";

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: tagForm.name,
        color: tagForm.color,
        description: tagForm.description,
      }),
    });

    if (!response.ok) {
      const { error } = await response.json();
      toast.error(error);
      setTagForm((prev) => ({
        ...prev,
        name: "",
        loading: false,
      }));
      return;
    }

    mutateTags();

    setOpen(false);
    toast.success(
      tagForm.id ? "Tag updated successfully!" : "Tag created successfully!",
    );
  };

  const setMenuOpen = (open: boolean) => {
    setOpen(open);
    setTagForm(defaultValue);
  };

  const hasTags = (tagCount ?? 0) > 0;
  const isSearching = !!searchQuery;

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 dark:border-gray-800 sm:flex-row sm:items-center sm:p-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Tags
                </h2>
                <BadgeTooltip
                  content="Organize and categorize your links and documents with tags."
                  className="max-w-80 text-left leading-5 text-gray-600"
                >
                  <CircleHelpIcon className="h-4 w-4 text-gray-400" />
                </BadgeTooltip>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage and categorize your tags here.
              </p>
            </div>
            <AddTagsModal
              open={open}
              setMenuOpen={setMenuOpen}
              tagForm={tagForm}
              setTagForm={setTagForm}
              handleSubmit={handleSubmit}
              tagCount={tagCount}
            >
              <Button className="bg-gray-900 text-gray-50 hover:bg-gray-900/90">
                Create Tag
              </Button>
            </AddTagsModal>
          </div>

          <div className="border-b border-gray-200 p-5 dark:border-gray-800 sm:p-6">
            <SearchBoxPersisted loading={isValidating} inputClassName="h-10" />
          </div>

          {loadingTags ? (
            <div className="p-6">
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800"
                  />
                ))}
              </div>
            </div>
          ) : !hasTags ? (
            <EmptyState isSearching={isSearching} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Name
                    </TableHead>
                    <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                      Links
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableTags?.map((tag) => (
                    <TableRow key={tag.id} className="group/row">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TagIcon
                            size={24}
                            className={cn(
                              "shrink-0 rounded-sm border p-1",
                              COLORS_LIST.find((c) => c.color === tag.color)
                                ?.css ?? "",
                            )}
                          />
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {tag.name}
                          </span>
                          {!!tag.description && (
                            <BadgeTooltip
                              content={tag.description}
                              key="tag_tooltip"
                            >
                              <InfoIcon className="h-4 w-4 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground" />
                            </BadgeTooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                        {tag._count?.items || 0} links
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <RowMenu
                          onEdit={() => {
                            setTagForm({
                              color: tag.color as TagColorProps,
                              name: tag.name,
                              description: tag.description,
                              id: tag.id,
                              loading: false,
                            });
                            setOpen(true);
                          }}
                          onDelete={() => handleDeleteTag(tag.id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {hasTags && (
          <Pagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={tagCount ?? 0}
            totalShownItems={availableTags?.length || 0}
            totalPages={Math.ceil((tagCount ?? 0) / pageSize)}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size: number) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
            itemName="tags"
          />
        )}
      </main>
    </AppLayout>
  );
}

function EmptyState({ isSearching }: { isSearching: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        <TagIcon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {isSearching ? "No tags found" : "No tags yet"}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {isSearching
            ? "Try a different search term to find your tags."
            : "Create your first tag to organize your links and documents."}
        </p>
      </div>
    </div>
  );
}

function RowMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Open tag actions"
        >
          <MoreHorizontalIcon className="!h-4 !w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          onSelect={() => {
            // Defer until the menu has fully closed so opening the edit
            // dialog doesn't get cancelled by the menu's focus/pointer events.
            setTimeout(() => onEdit(), 0);
          }}
        >
          <Settings2Icon className="!h-4 !w-4 text-gray-500" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onDelete()}
          className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-900/20"
        >
          <TrashIcon className="!h-4 !w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
