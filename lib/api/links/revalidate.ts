import prisma from "@/lib/prisma";

type LinkForRevalidation = {
  id: string;
  domainId: string | null;
};

type RevalidateConfig = {
  revalidateUrl: string;
  revalidateToken: string;
};

const REVALIDATE_CONCURRENCY = 10;
const REVALIDATE_TIMEOUT_MS = 10_000;

function getRevalidateConfig(): RevalidateConfig | null {
  const revalidateUrl = process.env.NEXTAUTH_URL;
  const revalidateToken = process.env.REVALIDATE_TOKEN;

  if (!revalidateUrl || !revalidateToken) return null;

  return { revalidateUrl, revalidateToken };
}

async function revalidateSingleLink(
  link: LinkForRevalidation,
  config: RevalidateConfig,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REVALIDATE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `${config.revalidateUrl}/api/revalidate?secret=${config.revalidateToken}&linkId=${link.id}&hasDomain=${link.domainId ? "true" : "false"}`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      console.error(
        `Error revalidating link ${link.id}: unexpected status ${response.status}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error revalidating link ${link.id}:`, error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function revalidateLinks(links: LinkForRevalidation[]): Promise<void> {
  if (links.length === 0) return;

  const config = getRevalidateConfig();
  if (!config) return;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < links.length) {
      const link = links[cursor++];
      await revalidateSingleLink(link, config);
    }
  };

  const workerCount = Math.min(REVALIDATE_CONCURRENCY, links.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

/**
 * Trigger ISR revalidation for a single link by ID.
 */
export async function revalidateLinkById(linkId: string): Promise<boolean> {
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    select: { id: true, domainId: true },
  });

  if (!link) {
    console.error(`Error revalidating link ${linkId}: link not found`);
    return false;
  }

  const config = getRevalidateConfig();
  if (!config) {
    console.error(`Error revalidating link ${linkId}: missing revalidate config`);
    return false;
  }

  return revalidateSingleLink(link, config);
}

/**
 * Trigger ISR revalidation for all non-deleted links using a specific permission group.
 * Call this after creating, updating, or deleting a permission group.
 */
export async function revalidateLinksForPermissionGroup(
  permissionGroupId: string,
): Promise<void> {
  try {
    const links = await prisma.link.findMany({
      where: {
        permissionGroupId: permissionGroupId,
        deletedAt: null,
      },
      select: {
        id: true,
        domainId: true,
      },
    });

    await revalidateLinks(links);
  } catch (error) {
    console.error(
      `Error revalidating links for permission group ${permissionGroupId}:`,
      error,
    );
  }
}

/**
 * Trigger ISR revalidation for all non-deleted restricted links in a dataroom.
 */
export async function revalidateLinksForDataroom(
  dataroomId: string,
): Promise<void> {
  try {
    const links = await prisma.link.findMany({
      where: {
        dataroomId,
        deletedAt: null,
        OR: [{ permissionGroupId: { not: null } }, { groupId: { not: null } }],
      },
      select: {
        id: true,
        domainId: true,
      },
    });

    await revalidateLinks(links);
  } catch (error) {
    console.error(
      `Error revalidating links for dataroom ${dataroomId}:`,
      error,
    );
  }
}
