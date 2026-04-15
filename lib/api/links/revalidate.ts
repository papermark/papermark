import prisma from "@/lib/prisma";

/**
 * Trigger ISR revalidation for a single link by ID.
 */
export async function revalidateLinkById(linkId: string): Promise<void> {
  try {
    const link = await prisma.link.findUnique({
      where: { id: linkId },
      select: { id: true, domainId: true },
    });

    if (!link) return;

    const revalidateUrl = process.env.NEXTAUTH_URL;
    const revalidateToken = process.env.REVALIDATE_TOKEN;
    if (!revalidateUrl || !revalidateToken) return;

    await fetch(
      `${revalidateUrl}/api/revalidate?secret=${revalidateToken}&linkId=${link.id}&hasDomain=${link.domainId ? "true" : "false"}`,
    );
  } catch (error) {
    console.error(`Error revalidating link ${linkId}:`, error);
  }
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

    if (links.length === 0) return;

    const revalidateUrl = process.env.NEXTAUTH_URL;
    const revalidateToken = process.env.REVALIDATE_TOKEN;
    if (!revalidateUrl || !revalidateToken) return;

    await Promise.all(
      links.map((link) =>
        fetch(
          `${revalidateUrl}/api/revalidate?secret=${revalidateToken}&linkId=${link.id}&hasDomain=${link.domainId ? "true" : "false"}`,
        ).catch((error) => {
          console.error(`Error revalidating link ${link.id}:`, error);
        }),
      ),
    );
  } catch (error) {
    console.error(
      `Error revalidating links for permission group ${permissionGroupId}:`,
      error,
    );
  }
}
