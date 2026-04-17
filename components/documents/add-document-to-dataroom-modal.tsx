import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { SnowflakeIcon } from "lucide-react";
import { toast } from "sonner";

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

export function AddToDataroomModal({
  open,
  setOpen,
  documentId,
  documentName,
  dataroomId,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  documentId?: string;
  documentName?: string;
  dataroomId?: string;
}) {
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
        `/api/teams/${teamId}/documents/${documentId}/add-to-dataroom`,
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

      toast.success("Document added to dataroom successfully!");
    } catch (error) {
      console.error("Error adding document to dataroom", error);
      toast.error("Failed to add document to dataroom. Try again.");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[90vw] sm:max-w-[425px]">
        <DialogHeader className="text-start">
          <DialogTitle>
            <span className="font-bold">{documentName}</span>
          </DialogTitle>
          <DialogDescription>
            Add your document to a dataroom.
          </DialogDescription>
        </DialogHeader>
        <Select onValueChange={(value) => setSelectedDataroom(value)}>
          <SelectTrigger className="w-[380px] max-w-full [&>span]:max-w-full [&>span]:overflow-hidden [&>span]:truncate [&>span]:text-ellipsis [&>span]:whitespace-nowrap">
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
                <span className="flex items-center gap-1.5 line-clamp-1 break-words">
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
                <span className="flex w-full max-w-[350px] items-center justify-center truncate">
                  Add to
                  <span className="ml-1 line-clamp-1 truncate font-medium">
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
