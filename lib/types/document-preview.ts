export interface DocumentPreviewData {
  documentId: string;
  documentName: string;
  documentType: string;
  fileType: string;
  isVertical: boolean;
  numPages: number;
  advancedExcelEnabled?: boolean;
  pages?: {
    file: string | null;
    pageNumber: string;
    embeddedLinks: string[];
    pageLinks: {
      href: string;
      coords: string;
      isInternal?: boolean;
      targetPage?: number;
    }[];
    metadata: { width: number; height: number; scaleFactor: number };
  }[];
  file?: string;
  sheetData?: any;
}
