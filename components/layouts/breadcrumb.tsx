import Link from "next/link";
import { useRouter } from "next/router";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { useDataroom } from "@/lib/swr/use-dataroom";
import { useDataroomDocumentOverview } from "@/lib/swr/use-dataroom-document";
import { useDocument } from "@/lib/swr/use-document";
import { useFolderWithParents } from "@/lib/swr/use-folders";
import useViewer from "@/lib/swr/use-viewer";

import { BreadcrumbComponent as DataroomBreadcrumb } from "@/components/datarooms/dataroom-breadcrumb";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BadgeTooltip } from "@/components/ui/tooltip";

const FOLDERS_TO_DISPLAY = 1; // Only show the last folder in the path

const SingleDocumentBreadcrumb = () => {
  const { document } = useDocument();
  const { folders } = useFolderWithParents({
    name: document?.folder?.path ? [document.folder.path] : [],
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/documents">Documents</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {folders && folders.length > FOLDERS_TO_DISPLAY ? (
          <>
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1">
                  <BreadcrumbEllipsis className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {folders.slice(0, -1).map((folder, index) => (
                    <DropdownMenuItem key={`${folder.path}-${index}`}>
                      <Link
                        href={`/documents/tree${folder.path}`}
                        className="w-full"
                      >
                        {folder.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  href={`/documents/tree${folders[folders.length - 1].path}`}
                  className="max-w-[200px] truncate"
                >
                  {folders[folders.length - 1].name}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator key={`sep-last`} />
          </>
        ) : (
          folders?.map((folder, index) => (
            <React.Fragment key={`${folder.path}-${index}`}>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link
                    href={`/documents/tree${folder.path}`}
                    className="max-w-[200px] truncate"
                  >
                    {folder.name}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </React.Fragment>
          ))
        )}
        {document && (
          <BreadcrumbItem>
            <BreadcrumbPage className="max-w-[200px] truncate">
              {document.name}
            </BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export const TruncatedBreadcrumbLink = ({
  href,
  text,
}: {
  href: string;
  text: string | undefined;
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const breadcrumbRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (
      breadcrumbRef.current &&
      breadcrumbRef.current.scrollWidth > breadcrumbRef.current.clientWidth
    ) {
      setIsTooltipVisible(true);
    } else {
      setIsTooltipVisible(false);
    }
  }, [text]);

  const link = (
    <BreadcrumbLink asChild>
      <Link
        ref={breadcrumbRef}
        href={href}
        className="max-w-32 truncate md:max-w-60"
      >
        {text || "Loading..."}
      </Link>
    </BreadcrumbLink>
  );

  if (isTooltipVisible) {
    return <BadgeTooltip content={text || ""}>{link}</BadgeTooltip>;
  }
  return link;
};

const SingleDataroomBreadcrumb = ({ path }: { path: string }) => {
  const { dataroom } = useDataroom();

  const title = useMemo(() => {
    switch (path) {
      case "/datarooms/[id]/documents":
        return "Documents";
      case "/datarooms/[id]/settings":
        return "Settings";
      case "/datarooms/[id]/branding":
        return "Branding";
      case "/datarooms/[id]/permissions":
      case "/datarooms/[id]/groups":
      case "/datarooms/[id]/groups/[groupId]":
      case "/datarooms/[id]/groups/[groupId]/permissions":
      case "/datarooms/[id]/groups/[groupId]/members":
      case "/datarooms/[id]/groups/[groupId]/links":
        return "Permissions";
      case "/datarooms/[id]/participants":
        return "Participants";
      case "/datarooms/[id]/analytics":
        return "Analytics";
      case "/datarooms/[id]/conversations/faqs":
        return "FAQ";
      case "/datarooms/[id]/conversations":
      case "/datarooms/[id]/conversations/[conversationId]":
        return "Conversations";
      case "/datarooms/[id]/settings/notifications":
        return "Notifications";
      case "/datarooms/[id]/settings/file-permissions":
        return "File Permissions";
      default:
        return dataroom?.name || "Loading...";
    }
  }, [path, dataroom]);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/datarooms">Datarooms</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <TruncatedBreadcrumbLink
            href={`/datarooms/${dataroom?.id}/documents`}
            text={dataroom?.name}
          />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};

const SingleDataroomDocumentBreadcrumb = () => {
  const { dataroom, document } = useDataroomDocumentOverview();

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/datarooms">Datarooms</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <TruncatedBreadcrumbLink
            href={`/datarooms/${dataroom?.id}/documents`}
            text={dataroom?.name}
          />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={`/datarooms/${dataroom?.id}/documents`}>Documents</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="max-w-[200px] truncate">
            {document?.name || "Loading..."}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};

const SettingsBreadcrumb = () => {
  const router = useRouter();
  const path = router.pathname;

  const settingsTitle = useMemo(() => {
    switch (path) {
      case "/settings/general":
        return "General";
      case "/settings/people":
        return "Team";
      case "/settings/domains":
        return "Domains";
      case "/settings/presets":
        return "Presets";
      case "/settings/billing":
        return "Billing";
      case "/settings/billing/invoices":
        return "Invoices";
      case "/settings/tokens":
        return "API Tokens";
      case "/settings/webhooks":
        return "Webhooks";
      case "/settings/slack":
        return "Slack";
      case "/settings/incoming-webhooks":
        return "Incoming Webhooks";
      default:
        return "Settings";
    }
  }, [path]);

  const isInvoicesPage = path === "/settings/billing/invoices";

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/settings/general">Settings</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {isInvoicesPage ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/settings/billing">Billing</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Invoices</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>{settingsTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

const AccountBreadcrumb = () => {
  const router = useRouter();
  const path = router.pathname;

  const accountTitle = useMemo(() => {
    switch (path) {
      case "/account/general":
        return "General";
      case "/account/security":
        return "Security";
      default:
        return "Account";
    }
  }, [path]);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/account/general">Account</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{accountTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};

const DocumentsBreadcrumb = () => {
  const router = useRouter();
  const { name } = router.query as { name: string[] };

  const { folders } = useFolderWithParents({ name });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/documents">Documents</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {folders && folders.length > 2 ? (
          <>
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1">
                  <BreadcrumbEllipsis className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {folders.slice(0, -2).map((folder, index) => (
                    <DropdownMenuItem key={`${folder.path}-${index}`}>
                      <Link
                        href={`/documents/tree${folder.path}`}
                        className="w-full"
                      >
                        {folder.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  href={`/documents/tree${folders[folders.length - 2].path}`}
                  className="max-w-[200px] truncate"
                >
                  {folders[folders.length - 2].name}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-[200px] truncate">
                {folders[folders.length - 1].name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          folders?.map((folder, index) => (
            <React.Fragment key={`${folder.path}-${index}`}>
              <BreadcrumbItem key={`item-${index}`}>
                {index === folders.length - 1 ? (
                  <BreadcrumbPage className="max-w-[200px] truncate">
                    {folder.name}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      href={`/documents/tree${folder.path}`}
                      className="max-w-[200px] truncate"
                    >
                      {folder.name}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {index < folders.length - 1 && <BreadcrumbSeparator />}
            </React.Fragment>
          ))
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

const VisitorsBreadcrumb = () => {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/visitors">Visitors</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};

const SingleVisitorBreadcrumb = () => {
  const { viewer } = useViewer();

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/visitors">Visitors</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="max-w-[200px] truncate">
            {viewer?.email || "Loading..."}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};

const AnalyticsBreadcrumb = () => {
  const router = useRouter();
  const { type = "links" } = router.query;

  const title = useMemo(() => {
    switch (type) {
      case "links":
        return "Links";
      case "documents":
        return "Documents";
      case "visitors":
        return "Visitors";
      case "views":
        return "Recent Views";
      default:
        return "Analytics";
    }
  }, [type]);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/dashboard?interval=7d&type=links">Dashboard</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export const AppBreadcrumb = () => {
  const router = useRouter();
  const path = router.pathname;
  const { id } = router.query as {
    id?: string;
  };

  const breadcrumb = useMemo(() => {
    // Analytics routes
    if (path === "/dashboard") {
      return <AnalyticsBreadcrumb />;
    }

    // Settings routes
    if (path.startsWith("/settings")) {
      return <SettingsBreadcrumb />;
    }

    // Account routes
    if (path.startsWith("/account")) {
      return <AccountBreadcrumb />;
    }

    // Partner program route
    if (path === "/partners") {
      return (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Partner program</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      );
    }

    // Global branding route
    if (path === "/branding") {
      return (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Branding</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      );
    }

    // Root documents route
    if (path === "/documents") {
      return (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Documents</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      );
    }

    // Document tree routes
    if (path === "/documents/tree/[...name]") {
      return <DocumentsBreadcrumb />;
    }

    // Single document route
    if (path === "/documents/[id]" && id) {
      return <SingleDocumentBreadcrumb />;
    }

    // Dataroom document routes
    if (path === "/datarooms/[id]/documents" && id) {
      return <DataroomBreadcrumb />;
    }

    // Dataroom document routes
    if (path === "/datarooms/[id]/documents/[...name]" && id) {
      return <DataroomBreadcrumb />;
    }

    // Single dataroom document route
    if (path === "/datarooms/[id]/document/[documentId]" && id) {
      return <SingleDataroomDocumentBreadcrumb />;
    }

    // Single dataroom route
    if (path.startsWith("/datarooms/[id]") && id) {
      return <SingleDataroomBreadcrumb path={path} />;
    }

    // Root datarooms route
    if (path === "/datarooms") {
      return (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Datarooms</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      );
    }

    // Root visitors route
    if (path === "/visitors") {
      return <VisitorsBreadcrumb />;
    }

    // Single visitor route
    if (path === "/visitors/[id]" && id) {
      return <SingleVisitorBreadcrumb />;
    }

    return null;
  }, [path, id]);

  return breadcrumb;
};
