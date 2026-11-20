import { useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { format } from "date-fns";
import {
  CircleHelpIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import useSWR from "swr";

import { cn, fetcher, timeAgo } from "@/lib/utils";

import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { useAddEditTokenModal } from "@/components/tokens/add-edit-token-modal";
import { useDeleteTokenModal } from "@/components/tokens/delete-token-modal";
import {
  TOKEN_TYPE_LABELS,
  TokenSubjectType,
  scopesToPermissionLabel,
} from "@/components/tokens/scopes";
import { useTokenCreatedModal } from "@/components/tokens/token-created-modal";
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

interface Token {
  id: string;
  name: string;
  partialKey: string;
  subjectType: TokenSubjectType;
  scopes: string | null;
  createdAt: string;
  lastUsed: string | null;
  user: {
    name: string | null;
    email: string | null;
  };
}

export default function TokenSettings() {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const {
    data: tokens,
    isLoading,
    mutate,
  } = useSWR<Token[]>(teamId ? `/api/teams/${teamId}/tokens` : null, fetcher);

  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);

  const { TokenCreatedModal, setShowTokenCreatedModal } = useTokenCreatedModal({
    token: createdToken ?? "",
  });

  const onTokenCreated = (secret: string) => {
    setCreatedToken(secret);
    setShowTokenCreatedModal(true);
  };

  const {
    AddEditTokenModal: CreateTokenModal,
    setShowAddEditTokenModal: setShowCreateTokenModal,
  } = useAddEditTokenModal({
    onTokenCreated,
    onSaved: () => mutate(),
  });

  const {
    AddEditTokenModal: EditTokenModal,
    setShowAddEditTokenModal: setShowEditTokenModal,
  } = useAddEditTokenModal({
    token: selectedToken
      ? {
          id: selectedToken.id,
          name: selectedToken.name,
          scopes: selectedToken.scopes,
        }
      : undefined,
    onSaved: () => mutate(),
  });

  const { DeleteTokenModal, setShowDeleteTokenModal } = useDeleteTokenModal({
    token: selectedToken
      ? { id: selectedToken.id, name: selectedToken.name }
      : null,
    onDeleted: () => mutate(),
  });

  const openEdit = (token: Token) => {
    setSelectedToken(token);
    setShowEditTokenModal(true);
  };

  const openDelete = (token: Token) => {
    setSelectedToken(token);
    setShowDeleteTokenModal(true);
  };

  const hasTokens = useMemo(() => (tokens?.length ?? 0) > 0, [tokens]);

  return (
    <AppLayout>
      <CreateTokenModal />
      <EditTokenModal />
      <DeleteTokenModal />
      <TokenCreatedModal />

      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        {
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-200 p-5 dark:border-gray-800 sm:flex-row sm:items-center sm:p-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Secret keys
                  </h2>
                  <BadgeTooltip
                    content="These API keys allow other apps to access your workspace. Use them with caution — do not share your API key with others, or expose it in the browser or other client-side code."
                    className="max-w-80 text-left leading-5 text-gray-600"
                  >
                    <CircleHelpIcon className="h-4 w-4 text-gray-400" />
                  </BadgeTooltip>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Create scoped API keys for your apps, automation, and MCP
                  clients.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost">
                  <a
                    href="https://www.papermark.com/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Documentation
                    <ExternalLinkIcon className="!h-3.5 !w-3.5" />
                  </a>
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowCreateTokenModal(true)}
                  className="bg-gray-900 text-gray-50 hover:bg-gray-900/90"
                >
                  Create API key
                </Button>
              </div>
            </div>

            {isLoading ? (
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
            ) : !hasTokens ? (
              <EmptyState />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        Name
                      </TableHead>
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        Permissions
                      </TableHead>
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        Created
                      </TableHead>
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        Key
                      </TableHead>
                      <TableHead className="text-xs font-medium tracking-wide text-gray-500">
                        Last used
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokens?.map((token) => (
                      <TableRow
                        key={token.id}
                        className="cursor-pointer"
                        onClick={() => openEdit(token)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <KeyRoundIcon className="h-4 w-4 text-gray-400" />
                            <div className="flex flex-col">
                              <span className="font-medium text-gray-900 dark:text-gray-100">
                                {token.name}
                              </span>
                              <span className="text-xs text-gray-500">
                                {TOKEN_TYPE_LABELS[token.subjectType]}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                          {scopesToPermissionLabel(token.scopes)}
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                          <div className="flex flex-col">
                            <span>
                              {format(new Date(token.createdAt), "MMM d, yyyy")}
                            </span>
                            <span className="text-xs text-gray-500">
                              by{" "}
                              {token.user.name ??
                                token.user.email ??
                                "Unknown user"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-gray-700 dark:text-gray-300">
                          {token.partialKey}
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 dark:text-gray-300">
                          {token.lastUsed ? timeAgo(token.lastUsed) : "Never"}
                        </TableCell>
                        <TableCell
                          className={cn("text-right")}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <RowMenu
                            onEdit={() => openEdit(token)}
                            onDelete={() => openDelete(token)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        }
      </main>
    </AppLayout>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800">
        <KeyRoundIcon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          No API keys yet
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your first API key to use the Papermark API.
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
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Open token actions"
        >
          <MoreHorizontalIcon className="!h-4 !w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setOpen(false);
            onEdit();
          }}
        >
          <PencilIcon className="!h-4 !w-4 text-gray-500" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            setOpen(false);
            onDelete();
          }}
          className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-900/20"
        >
          <TrashIcon className="!h-4 !w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
