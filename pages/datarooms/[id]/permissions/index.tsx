import Link from "next/link";

import { useState } from "react";

import { CircleHelpIcon } from "lucide-react";

import { useDataroom, useDataroomLinks } from "@/lib/swr/use-dataroom";

import { DataroomHeader } from "@/components/datarooms/dataroom-header";
import { DataroomNavigation } from "@/components/datarooms/dataroom-navigation";
import AppLayout from "@/components/layouts/app";
import LinkSheet from "@/components/links/link-sheet";
import LinksTable from "@/components/links/links-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BadgeTooltip } from "@/components/ui/tooltip";

export default function DataroomAnalyticsPage() {
  const { dataroom } = useDataroom();
  const { links } = useDataroomLinks();

  const [isLinkSheetOpen, setIsLinkSheetOpen] = useState<boolean>(false);

  if (!dataroom) {
    return <div>Loading...</div>;
  }

  return (
    <AppLayout>
      <div className="relative mx-2 mb-10 mt-4 space-y-8 px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <header>
          <DataroomHeader
            title={dataroom.name}
            description={dataroom.pId}
            internalName={dataroom.internalName}
            actions={[
              <Button onClick={() => setIsLinkSheetOpen(true)} key={1}>
                Share
              </Button>,
            ]}
          />
          <DataroomNavigation dataroomId={dataroom.id} />
        </header>

        <Tabs defaultValue="links" className="!mt-4 space-y-4">
          <TabsList>
            <TabsTrigger value="links">Links</TabsTrigger>
            <TabsTrigger value="groups" asChild>
              <Link href={`/datarooms/${dataroom.id}/groups`}>Groups</Link>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="links" className="space-y-4">
            <div className="!mt-8 flex items-center gap-x-2">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold tracking-tight text-foreground">
                  Links
                </h3>
                <p className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
                  Share data room with strong access controls using links.
                  <BadgeTooltip
                    linkText="Learn more"
                    content="Configure access controls for data room links."
                    key="links"
                    link="https://www.papermark.com/help/category/links"
                  >
                    <CircleHelpIcon className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground" />
                  </BadgeTooltip>
                </p>
              </div>
            </div>
            <LinksTable
              links={links}
              targetType={"DATAROOM"}
              dataroomName={dataroom.name}
            />
            <LinkSheet
              linkType={"DATAROOM_LINK"}
              isOpen={isLinkSheetOpen}
              setIsOpen={setIsLinkSheetOpen}
              existingLinks={links}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
