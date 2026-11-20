import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";

type GetFileForDocumentPageParams = {
  pageNumber: number;
  documentId: string;
  userId: string;
  versionNumber?: number;
};

export const getFileForDocumentPage = async ({
  pageNumber,
  documentId,
  userId,
  versionNumber,
}: GetFileForDocumentPageParams): Promise<string> => {
  const documentVersion = await prisma.documentVersion.findFirst({
    where: {
      documentId,
      document: {
        team: {
          users: {
            some: {
              userId,
            },
          },
        },
      },
      ...(versionNumber !== undefined ? { versionNumber } : { isPrimary: true }),
    },
    select: {
      id: true,
    },
    orderBy: {
      versionNumber: "desc",
    },
  });

  if (!documentVersion) {
    throw new Error(
      `Document version from document id ${documentId} not found`,
    );
  }

  const documentPage = await prisma.documentPage.findUnique({
    where: {
      pageNumber_versionId: {
        pageNumber: pageNumber,
        versionId: documentVersion.id,
      },
    },
    select: {
      file: true,
      storageType: true,
    },
  });

  if (!documentPage) {
    throw new Error(
      `Document page ${pageNumber} with version id ${documentId} not found`,
    );
  }

  return getFile({
    type: documentPage.storageType,
    data: documentPage.file,
  });
};
