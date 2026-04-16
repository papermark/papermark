"use client";

import Link from "next/link";
import { useRouter } from "next/router";

import { formatDistanceToNow } from "date-fns";
import { SnowflakeIcon } from "lucide-react";

import { TagColorProps } from "@/lib/types";

import TagBadge from "@/components/links/link-sheet/tags/tag-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type DataroomTag = {
  tag: {
    id: string;
    name: string;
    color: string;
    description: string | null;
  };
};

type DataroomWithDetails = {
  id: string;
  name: string;
  internalName?: string | null;
  isFrozen?: boolean;
  _count: {
    documents: number;
    views: number;
  };
  activeLinkCount: number;
  lastViewedAt: Date | null;
  createdAt: Date;
  tags?: DataroomTag[];
};

interface DataroomCardProps {
  dataroom: DataroomWithDetails;
}

export default function DataroomCard({ dataroom }: DataroomCardProps) {
  const router = useRouter();

  const isActive = dataroom.activeLinkCount > 0;
  const activeLinkCount = dataroom.activeLinkCount;
  const lastViewedAt = dataroom.lastViewedAt;
  const hasDocuments = dataroom._count.documents > 0;

  const handleButtonClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!hasDocuments) {
      // If no documents, go to documents tab
      router.push(`/datarooms/${dataroom.id}/documents`);
    } else if (!isActive) {
      // If has documents but inactive, go to permissions/share
      router.push(`/datarooms/${dataroom.id}/permissions`);
    }
  };

  return (
    <Card className="group relative overflow-hidden duration-500 hover:border-primary/50">
      <Link href={`/datarooms/${dataroom.id}/documents`}>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="truncate text-lg">
                {dataroom.internalName || dataroom.name}
              </CardTitle>
              {dataroom.internalName && (
                <p className="truncate text-sm text-muted-foreground mt-0.5">
                  {dataroom.name}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="flex items-center gap-1.5"
                      onClick={(e) => e.preventDefault()}
                    >
                      {dataroom.isFrozen ? (
                        <>
                          <SnowflakeIcon className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-xs text-blue-600">Frozen</span>
                        </>
                      ) : (
                        <>
                          <div
                            className={`h-2 w-2 rounded-full ${
                              isActive ? "bg-green-500" : "bg-gray-400"
                            }`}
                          />
                          <span
                            className={`text-xs ${
                              isActive ? "text-green-600" : "text-gray-500"
                            }`}
                          >
                            {isActive ? "Active" : "Inactive"}
                          </span>
                        </>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {dataroom.isFrozen
                        ? "Data room is frozen"
                        : isActive
                          ? "Dataroom has active links"
                          : "No active links"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Tags */}
          {dataroom.tags && dataroom.tags.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5"
              onClick={(e) => e.preventDefault()}
            >
              {dataroom.tags.slice(0, 3).map((tagItem) => (
                <TagBadge
                  key={tagItem.tag.id}
                  name={tagItem.tag.name}
                  color={tagItem.tag.color as TagColorProps}
                  withIcon
                />
              ))}
              {dataroom.tags.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{dataroom.tags.length - 3} more
                </span>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {/* Stats List */}
          <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Documents</div>
              <div className="text-sm text-muted-foreground">
                {dataroom._count.documents}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Views</div>
              <div className="text-sm text-muted-foreground">
                {dataroom._count.views}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Active Links</div>
              <div className="text-sm text-muted-foreground">
                {activeLinkCount}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t pt-3">
            <div className="text-xs text-muted-foreground">
              {lastViewedAt ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <span>
                        Viewed{" "}
                        {formatDistanceToNow(new Date(lastViewedAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Last viewed</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <span>No views yet</span>
              )}
            </div>

            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              {!hasDocuments ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 text-muted-foreground hover:text-foreground"
                        onClick={handleButtonClick}
                      >
                        <span>Add Documents</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Add documents to dataroom</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                !isActive && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-2 text-muted-foreground hover:text-foreground"
                          onClick={handleButtonClick}
                        >
                          <span>Share</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Share dataroom</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )
              )}
            </div>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
