"use client";

import { useState } from "react";

import {
  Check,
  ClockIcon,
  Copy,
  DownloadIcon,
  ExternalLink,
  FolderLockIcon,
  KeyRoundIcon,
  MailCheckIcon,
  MailIcon,
  SendIcon,
  ShieldIcon,
  Users,
} from "lucide-react";

import { LinkWithViews } from "@/lib/types";


import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface LinkSuccessSheetProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  link: LinkWithViews;
  hasCustomPermissions: boolean;
  onCreateAnother: () => void;
  onInviteViewers?: (link: LinkWithViews) => void;
}

export default function LinkSuccessSheet({
  isOpen,
  setIsOpen,
  link,
  hasCustomPermissions,
  onCreateAnother,
  onInviteViewers,
}: LinkSuccessSheetProps) {
  const [copied, setCopied] = useState(false);

  const linkUrl =
    link.domainId && link.slug
      ? `https://${link.domainSlug}/${link.slug}`
      : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${link.id}`;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  };

  const openLink = () => {
    window.open(linkUrl, "_blank");
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent className="flex w-[90%] flex-col justify-between border-l border-gray-200 bg-background px-4 text-foreground dark:border-gray-800 dark:bg-gray-900 sm:w-[600px] sm:max-w-2xl md:px-5">
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            Link Created Successfully
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            Your dataroom link has been created and is ready to share.
          </p>
        </SheetHeader>

        <div className="flex-1 space-y-6 py-6">
          {/* Link Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Share Link to Your Data Room</h3>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex-1 truncate font-mono text-sm">{linkUrl}</div>
              <Button
                variant="default"
                size="sm"
                onClick={copyToClipboard}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={openLink}
                className="shrink-0"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </Button>
            </div>
          </div>

          <Separator />

          {/* Link Configuration Summary */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Link Configuration</h3>

            <div className="grid gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <FolderLockIcon className="h-4 w-4" />
                  File Permissions
                </span>
                <Badge variant={hasCustomPermissions ? "secondary" : "default"}>
                  {hasCustomPermissions ? "Custom Permissions" : "Full Access"}
                </Badge>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Viewer Access
                </span>
                <Badge
                  variant={link.allowList.length > 0 ? "default" : "secondary"}
                >
                  {link.allowList.length > 0
                    ? "Specified viewers"
                    : "Everyone with link"}
                </Badge>
              </div>

              {link.emailProtected && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <MailIcon className="h-4 w-4" />
                    Email Protection
                  </span>
                  <Badge variant="default">Enabled</Badge>
                </div>
              )}

              {link.emailProtected && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <MailCheckIcon className="h-4 w-4" />
                    Email Verification
                  </span>
                  <Badge
                    variant={link.emailAuthenticated ? "default" : "secondary"}
                  >
                    {link.emailAuthenticated ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              )}

              {link.password && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <KeyRoundIcon className="h-4 w-4" />
                    Password Protection
                  </span>
                  <Badge variant="secondary">Enabled</Badge>
                </div>
              )}

              {link.expiresAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <ClockIcon className="h-4 w-4" />
                    Expiration
                  </span>
                  <Badge variant="outline">
                    {new Date(link.expiresAt).toLocaleDateString()}
                  </Badge>
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <DownloadIcon className="h-4 w-4" />
                  Downloads
                </span>
                <Badge variant={link.allowDownload ? "default" : "secondary"}>
                  {link.allowDownload ? "Enabled" : "Disabled"}
                </Badge>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <ShieldIcon className="h-4 w-4" />
                  Additional Security
                </span>
                <Badge
                  variant={
                    link.enableAgreement || link.enableWatermark
                      ? "default"
                      : "secondary"
                  }
                >
                  {link.enableAgreement || link.enableWatermark
                    ? "Enabled"
                    : "Disabled"}
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Invite Viewers Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Invite Visitors by Email</h3>
            <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
              <SendIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                Send email invitations to viewers with a direct link to this
                data room
              </p>
              {onInviteViewers && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => onInviteViewers(link)}
                >
                  <SendIcon className="mr-1.5 h-4 w-4" />
                  Send Invitations
                </Button>
              )}
            </div>
          </div>
        </div>

        <SheetFooter>
          <div className="flex flex-row-reverse items-center gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onCreateAnother}>
              Create Another Link
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
