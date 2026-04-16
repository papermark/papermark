import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { SnowflakeIcon } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import useDataroomsSimple from "@/lib/swr/use-datarooms-simple";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export type TSelectedDataroom = { id: string; name: string } | null;

export function AddFolderToDataroomModal({
  open,
  setOpen,
  folderId,
  folderName,
  dataroomId,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  folderId?: string;
  folderName?: string;
  dataroomId?: string;
}) {
  const router = useRouter();
  const [selectedDataroom, setSelectedDataroom] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { datarooms } = useDataroomsSimple();

  const handleSubmit = async (event: any) => {
    event.preventDefault();
    event.stopPropagation();

    if (!selectedDataroom) return;

    setLoading(true);
    try {
      const response = await fetch(
        !!dataroomId
          ? `/api/teams/${teamId}/datarooms/${dataroomId}/folders/manage/${folderId}/dataroom-to-dataroom`
          : `/api/teams/${teamId}/folders/manage/${folderId}/add-to-dataroom`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dataroomId: selectedDataroom,
          }),
        },
      );

      if (!response.ok) {
        const { message } = await response.json();
        setLoading(false);
        toast.error(message);
        return;
      }
      dataroomId &&
        mutate(`/api/teams/${teamId}/datarooms/${dataroomId}/folders`);

      const dataroomName = datarooms?.find(
        (d) => d.id === selectedDataroom,
      )?.name;

      toast.success(`Folder added successfully!`, {
        description: `${folderName?.trim()} → ${dataroomName}`,
        action: {
          label: "Open Dataroom",
          onClick: () =>
            router.push(`/datarooms/${selectedDataroom}/documents`),
        },
        duration: 10000,
      });
    } catch (error) {
      console.error("Error adding folder to dataroom", error);
      toast.error("Failed to add folder to dataroom. Try again.");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="text-start">
          <DialogTitle>
            <span className="font-bold">{folderName}</span>
          </DialogTitle>
          <DialogDescription>Add your folder to a dataroom.</DialogDescription>
        </DialogHeader>
        <Select onValueChange={(value) => setSelectedDataroom(value)}>
          <SelectTrigger className="w-[380px] max-w-full [&>span]:truncate [&>span]:max-w-full [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap">
            <SelectValue placeholder="Select a dataroom" />
          </SelectTrigger>
          <SelectContent className="w-[380px] max-w-[90vw]">
            {datarooms?.map((dataroom) => (
              <SelectItem
                key={dataroom.id}
                value={dataroom.id}
                disabled={dataroom.id === dataroomId || dataroom.isFrozen}
                className="break-words"
              >
                <span className="flex items-center gap-1.5 break-words line-clamp-1">
                  {dataroom.isFrozen && (
                    <SnowflakeIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                  )}
                  <span className={dataroom.isFrozen ? "text-muted-foreground" : ""}>
                    {dataroom.name}
                    {dataroom.id === dataroomId ? " (current)" : ""}
                    {dataroom.isFrozen ? " (frozen)" : ""}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form>
          <div className="mb-2"></div>

          <DialogFooter>
            <Button
              onClick={handleSubmit}
              className="flex h-9 w-full gap-1"
              loading={loading}
              disabled={!selectedDataroom}
            >
              {!selectedDataroom ? (
                "Select a dataroom"
              ) : (
                <span className="flex items-center justify-center w-full max-w-[350px] truncate">
                  Add to
                  <span className="font-medium truncate line-clamp-1 ml-1">
                    {
                      datarooms?.filter((d) => d.id === selectedDataroom)[0]
                        .name
                    }
                  </span>
                </span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
