import type { PageLink } from "./page-link";

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
    pageLinks?: PageLink[] | null;
    metadata: { width: number; height: number; scaleFactor: number } | null;
  }[];
  file?: string;
  sheetData?: any;
  htmlContent?: string;
}
