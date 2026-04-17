import { NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Check for secret to confirm this is a valid request
  if (req.query.secret !== process.env.REVALIDATE_TOKEN) {
    return res.status(401).json({ message: "Invalid token" });
  }

  const { linkId, documentId, teamId, hasDomain } = req.query as {
    linkId: string;
    documentId: string;
    teamId: string;
    hasDomain: string;
  };

  try {
    if (linkId) {
      if (hasDomain === "true") {
        // revalidate a custom domain link
        const link = await prisma.link.findUnique({
          where: { id: linkId },
          select: { domainSlug: true, slug: true },
        });
        if (!link) {
          throw new Error("Link not found");
        }
        console.log(
          "revalidating",
          `/view/domains/${link.domainSlug}/${link.slug}`,
        );
        await res.revalidate(`/view/domains/${link.domainSlug}/${link.slug}`);
      } else {
        console.log("revalidating", `/view/${linkId}`);
        // revalidate a regular papermark link
        await res.revalidate(`/view/${linkId}`);
      }
    }

    if (documentId) {
      // revalidate all links for this document
      const links = await prisma.link.findMany({
        where: {
          documentId: documentId,
        },
        select: { id: true, domainSlug: true, slug: true },
      });
      for (const link of links) {
        if (link.domainSlug && link.slug) {
          // revalidate a custom domain link
          console.log(
            "revalidating",
            `/view/domains/${link.domainSlug}/${link.slug}`,
          );
          await res.revalidate(`/view/domains/${link.domainSlug}/${link.slug}`);
        } else {
          // revalidate a regular papermark link
          console.log("revalidating document link", `/view/${link.id}`);
          await res.revalidate(`/view/${link.id}`);
        }
      }
    }

    if (teamId) {
      // revalidate all links for this team (both regular and custom domain)
      const allLinks = await prisma.link.findMany({
        where: {
          teamId: teamId,
          isArchived: false,
          deletedAt: null,
        },
        select: {
          id: true,
          domainSlug: true,
          slug: true,
        },
      });

      for (const link of allLinks) {
        if (link.domainSlug && link.slug) {
          console.log(
            "revalidating domain link",
            `/view/domains/${link.domainSlug}/${link.slug}`,
          );
          await res.revalidate(
            `/view/domains/${link.domainSlug}/${link.slug}`,
          );
        } else {
          console.log("revalidating link", `/view/${link.id}`);
          await res.revalidate(`/view/${link.id}`);
        }
      }
    }

    return res.json({ revalidated: true });
  } catch (err) {
    // If there was an error, Next.js will continue
    // to show the last successfully generated page
    console.error("Error during revalidation:", err);
    return res.status(500).send("Error revalidating");
  }
}
