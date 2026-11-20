import { useRouter } from "next/router";

import { useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { toast } from "sonner";
import { mutate } from "swr";
import { z } from "zod";

import {
  DEFAULT_FOLDER_COLOR,
  DEFAULT_FOLDER_ICON,
  FolderColorId,
  FolderIconId,
} from "@/lib/constants/folder-constants";
import { safeSlugify } from "@/lib/utils";
import { useAnalytics } from "@/lib/analytics";
import { usePlan } from "@/lib/swr/use-billing";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { UpgradePlanModal } from "../billing/upgrade-plan-modal";
import { FolderIconColorPicker } from "./folder-icon-picker";

export function AddFolderModal({
  open: openProp,
  onOpenChange,
  onAddition,
  isDataroom,
  dataroomId,
  children,
}: {
  /** Controlled open state. Pair with `onOpenChange` to drive from outside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAddition?: (folderName: string) => void;
  isDataroom?: boolean;
  dataroomId?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const folderNameInputRef = useRef<HTMLInputElement>(null);
  const [folderName, setFolderName] = useState<string>("");
  const [folderIcon, setFolderIcon] = useState<FolderIconId>(DEFAULT_FOLDER_ICON);
  const [folderColor, setFolderColor] = useState<FolderColorId>(DEFAULT_FOLDER_COLOR);
  const [loading, setLoading] = useState<boolean>(false);
  const [uncontrolledOpen, setUncontrolledOpen] = useState<boolean>(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const teamInfo = useTeam();
  const { isFree, isTrial } = usePlan();
  const analytics = useAnalytics();

  // Free plans (outside of trial) can't create folders. Centralize the gate
  // so it applies to both trigger usage (`children`) and controlled usage
  // (`open`/`onOpenChange`); otherwise a programmatic open would bypass it.
  const isCreationAllowed = !(isFree && !isTrial);

  /** current folder name */
  const currentFolderPath = router.query.name as string[] | undefined;

  const folderPath =
    isDataroom && dataroomId
      ? `/datarooms/${dataroomId}/documents/${currentFolderPath ? currentFolderPath?.join("/") : ""}/${"/" + safeSlugify(folderName.trim())}`
      : `/documents/tree/${currentFolderPath ? currentFolderPath?.join("/") : ""}${"/" + safeSlugify(folderName.trim())}`;

  const addFolderSchema = z.object({
    name: z
      .string()
      .min(3, {
        message: "Please provide a folder name with at least 3 characters.",
      })
      .max(256, {
        message: "Folder name must be 256 characters or less.",
      }),
  });

  const validation = addFolderSchema.safeParse({ name: folderName });

  const handleSubmit = async (event: any) => {
    event.preventDefault();
    event.stopPropagation();

    // Defense in depth: the form isn't rendered when creation is blocked,
    // but guard the creation path so a stale/leaked submission can't slip past.
    if (!isCreationAllowed) {
      setOpen(false);
      return;
    }

    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setLoading(true);
    const endpointTargetType =
      isDataroom && dataroomId ? `datarooms/${dataroomId}/folders` : "folders";

    try {
      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: folderName.trim(),
            path: currentFolderPath?.join("/"),
            icon: folderIcon,
            color: folderColor,
          }),
        },
      );

      if (!response.ok) {
        const { message } = await response.json();
        setLoading(false);
        toast.error(message.error);
        return;
      }

      const { parentFolderPath } = await response.json();

      analytics.capture("Folder Added", {
        folderName: folderName.trim(),
        icon: folderIcon,
        color: folderColor,
        dataroomId,
      });
      toast.success(`Folder added successfully!`, {
        description: `"${folderName.trim()}"`,
        action: {
          label: "Open folder",
          onClick: () => router.push(folderPath),
        },
        duration: 10000,
      });

      mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}?root=true`,
      );
      mutate(`/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}`);
      mutate(
        `/api/teams/${teamInfo?.currentTeam?.id}/${endpointTargetType}${parentFolderPath}`,
      );
    } catch (error) {
      setLoading(false);
      toast.error("Error adding folder. Please try again.");
      return;
    } finally {
      setFolderName("");
      setFolderIcon(DEFAULT_FOLDER_ICON);
      setFolderColor(DEFAULT_FOLDER_COLOR);
      setLoading(false);
      setOpen(false);
    }
  };

  // If the team is on a free plan, show the upgrade modal regardless of how
  // the consumer opens the dialog (trigger child or controlled props).
  if (!isCreationAllowed) {
    if (children) {
      return (
        <UpgradePlanModal
          clickedPlan={PlanEnum.Pro}
          trigger={"add_folder_button"}
          highlightItem={["folder", "folder-sharing", "datarooms"]}
        >
          {children}
        </UpgradePlanModal>
      );
    }
    // Controlled/programmatic usage: surface the upgrade modal in place of the
    // create-folder dialog so callers can't bypass the gate by passing `open`.
    return (
      <UpgradePlanModal
        clickedPlan={PlanEnum.Pro}
        trigger={"add_folder_button"}
        highlightItem={["folder", "folder-sharing", "datarooms"]}
        open={open}
        setOpen={(next) => {
          const value = typeof next === "function" ? next(open) : next;
          setOpen(value);
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(e) => {
          // Override Radix's default focus (which lands on the icon picker
          // button) so the user can start typing the folder name immediately.
          e.preventDefault();
          folderNameInputRef.current?.focus();
        }}
      >
        <DialogHeader className="text-start">
          <DialogTitle>Add Folder</DialogTitle>
          <DialogDescription>
            Create a new folder with a custom icon and color.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Label htmlFor="folder-name" className="opacity-80">
            Folder Name
          </Label>
          <div className="mb-4 mt-1 flex items-center gap-2">
            <FolderIconColorPicker
              iconValue={folderIcon}
              colorValue={folderColor}
              onIconChange={setFolderIcon}
              onColorChange={setFolderColor}
            />
            <Input
              ref={folderNameInputRef}
              id="folder-name"
              placeholder="Choose a helpful name"
              className="flex-1"
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              className="h-9 w-full"
              disabled={!validation.success || !isCreationAllowed}
              loading={loading}
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
