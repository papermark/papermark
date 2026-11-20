import { useEffect, useState } from "react";

import { useTeam } from "@/context/team-context";
import {
  CircleCheckIcon,
  ExternalLinkIcon,
  FlagIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SettingsIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableCell, TableRow } from "@/components/ui/table";

import { useDeleteDomainModal } from "./delete-domain-modal";
import DomainConfiguration from "./domain-configuration";
import { useDomainStatus } from "./use-domain-status";

export default function DomainRow({
  domain,
  isDefault,
  redirectUrl: initialRedirectUrl,
  redirectsAllowed,
  defaultOpen = false,
  onDelete,
}: {
  domain: string;
  isDefault: boolean;
  redirectUrl?: string | null;
  redirectsAllowed: boolean;
  defaultOpen?: boolean;
  onDelete: (deletedDomain: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(defaultOpen);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (defaultOpen) {
      setShowDetails(true);
    }
  }, [defaultOpen]);
  const [redirectUrl, setRedirectUrl] = useState(initialRedirectUrl || "");
  const [savingRedirect, setSavingRedirect] = useState(false);

  const {
    status,
    loading,
    domainJson,
    configJson,
    mutate: mutateDomain,
  } = useDomainStatus({
    domain,
  });
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const isInvalid =
    status && !["Valid Configuration", "Pending Verification"].includes(status);

  const { setShowDeleteDomainModal, DeleteDomainModal } = useDeleteDomainModal({
    domain,
    onDelete,
  });

  const handleSaveRedirectUrl = async () => {
    setSavingRedirect(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/domains/${domain}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUrl: redirectUrl || null }),
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(data?.message || "Failed to save redirect URL");
        return;
      }

      mutate(`/api/teams/${teamId}/domains`);
      toast.success(
        redirectUrl ? "Root redirect URL saved" : "Root redirect URL removed",
      );
    } catch {
      toast.error("Failed to save redirect URL");
    } finally {
      setSavingRedirect(false);
    }
  };

  const handleMakeDefault = async () => {
    try {
      const response = await fetch(`/api/teams/${teamId}/domains/${domain}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.message || "Failed to set as default domain");
        return;
      }

      mutate(`/api/teams/${teamId}/domains`);
      toast.success("Default domain updated");
    } catch {
      toast.error("Failed to set as default domain");
    }
  };

  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell>
          <div className="flex items-center gap-2">
            <GlobeIcon className="h-4 w-4 text-gray-400" />
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {domain}
            </span>
            {isDefault ? (
              <span className="flex items-center gap-1 rounded-full bg-sky-400/[.15] px-1.5 py-0.5 text-xs font-medium text-sky-600">
                <FlagIcon className="hidden h-3 w-3 sm:block" />
                Default
              </span>
            ) : null}
          </div>
        </TableCell>
        <TableCell>
          {status && !loading ? (
            <StatusBadge
              variant={
                status === "Valid Configuration"
                  ? "success"
                  : status === "Pending Verification"
                    ? "pending"
                    : "error"
              }
            >
              {status === "Valid Configuration"
                ? "Active"
                : status === "Pending Verification"
                  ? "Pending"
                  : "Invalid"}
            </StatusBadge>
          ) : (
            <div className="h-6 w-16 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
          )}
        </TableCell>
        <TableCell
          className="text-right"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="relative h-8 w-8"
              onClick={() => setShowDetails((s) => !s)}
              data-state={showDetails ? "open" : "closed"}
              aria-label="Domain settings"
            >
              <SettingsIcon
                className={cn(
                  "h-4 w-4",
                  showDetails
                    ? "text-gray-800 dark:text-gray-200"
                    : "text-gray-600 dark:text-gray-400",
                )}
              />
              {status && isInvalid && (
                <div className="absolute -right-px -top-px h-[5px] w-[5px] rounded-full bg-destructive">
                  <div className="h-full w-full animate-pulse rounded-full ring-2 ring-destructive/30" />
                </div>
              )}
            </Button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Open domain actions"
                >
                  <MoreHorizontalIcon className="!h-4 !w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={isDefault}
                  onClick={handleMakeDefault}
                >
                  <FlagIcon className="mr-2 h-4 w-4" />
                  Make default
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => mutateDomain()}
                  disabled={loading}
                >
                  <RefreshCwIcon className="mr-2 h-4 w-4" />
                  Refresh
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive transition-colors duration-200 focus:bg-destructive focus:text-destructive-foreground"
                  onClick={() => setShowDeleteDomainModal(true)}
                >
                  <TrashIcon className="mr-2 h-4 w-4" />
                  Delete domain
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>

      {showDetails ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={3} className="bg-muted/20 p-0">
            <div className="px-4 py-4">
              {status ? (
                status === "Valid Configuration" ? (
                  <div className="flex items-center gap-2 text-pretty rounded-lg bg-green-100/80 p-3 text-sm text-green-600">
                    <CircleCheckIcon className="h-5 w-5 shrink-0" />
                    <div>
                      Good news! Your DNS records are set up correctly, but it
                      can take some time for them to propagate globally.
                    </div>
                  </div>
                ) : (
                  <DomainConfiguration
                    status={status}
                    response={{ domainJson, configJson }}
                  />
                )
              ) : (
                <div className="h-6 w-32 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
              )}

              {/* Root domain redirect */}
              <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ExternalLinkIcon className="h-4 w-4" />
                  Root Domain Redirect
                </div>
                {redirectsAllowed ? (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Redirect visitors who land on{" "}
                      <span className="font-medium">{domain}</span> to a specific
                      URL. Leave empty to redirect to papermark.com.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Input
                        type="url"
                        placeholder="https://example.com"
                        value={redirectUrl}
                        onChange={(e) => setRedirectUrl(e.target.value)}
                        className="h-9 flex-1"
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveRedirectUrl}
                        disabled={savingRedirect}
                        className="h-9 shrink-0"
                      >
                        {savingRedirect ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Root domain redirects require a{" "}
                    <span className="font-semibold">Business</span> plan or
                    higher.
                  </p>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}

      <DeleteDomainModal />
    </>
  );
}
