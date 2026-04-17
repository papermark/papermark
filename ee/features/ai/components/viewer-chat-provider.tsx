"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { DataroomFolder } from "@prisma/client";

import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface DataroomDocumentForChat {
  dataroomDocumentId: string;
  id: string;
  name: string;
  folderId: string | null;
}

interface ViewerChatConfig {
  dataroomId?: string;
  dataroomName?: string;
  documentId?: string;
  documentName?: string;
  linkId?: string;
  viewId?: string;
  viewerId?: string;
}

interface ViewerChatContextType {
  // State
  isOpen: boolean;
  isEnabled: boolean;
  config: ViewerChatConfig;
  documents: DataroomDocumentForChat[];
  folders: DataroomFolder[];

  // Actions
  open: () => void;
  close: () => void;
  toggle: () => void;
}

// ============================================================================
// Context
// ============================================================================

const ViewerChatContext = createContext<ViewerChatContextType | null>(null);

/**
 * Hook to access chat state and actions.
 * Throws if used outside ViewerChatProvider.
 */
export function useViewerChat() {
  const context = useContext(ViewerChatContext);
  if (!context) {
    throw new Error("useViewerChat must be used within ViewerChatProvider");
  }
  return context;
}

/**
 * Safe hook that returns null if not within ViewerChatProvider.
 * Useful for components that may or may not be within a chat context.
 */
export function useViewerChatSafe() {
  return useContext(ViewerChatContext);
}

// ============================================================================
// Provider
// ============================================================================

interface ViewerChatProviderProps {
  children: ReactNode;
  enabled?: boolean;
  dataroomId?: string;
  dataroomName?: string;
  documentId?: string;
  documentName?: string;
  linkId?: string;
  viewId?: string;
  viewerId?: string;
  documents?: DataroomDocumentForChat[];
  folders?: DataroomFolder[];
}

export function ViewerChatProvider({
  children,
  enabled = false,
  dataroomId,
  dataroomName,
  documentId,
  documentName,
  linkId,
  viewId,
  viewerId,
  documents = [],
  folders = [],
}: ViewerChatProviderProps) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const config: ViewerChatConfig = useMemo(
    () => ({
      dataroomId,
      dataroomName,
      documentId,
      documentName,
      linkId,
      viewId,
      viewerId,
    }),
    [dataroomId, dataroomName, documentId, documentName, linkId, viewId, viewerId],
  );

  const value: ViewerChatContextType = useMemo(
    () => ({
      isOpen,
      isEnabled: enabled,
      config,
      documents,
      folders,
      open,
      close,
      toggle,
    }),
    [isOpen, enabled, config, documents, folders, open, close, toggle],
  );

  return (
    <ViewerChatContext.Provider value={value}>
      {children}
    </ViewerChatContext.Provider>
  );
}

// ============================================================================
// Layout Component - Applies padding when chat is open
// ============================================================================

interface ViewerChatLayoutProps {
  children: ReactNode;
  className?: string;
}

/**
 * Layout wrapper that applies padding when chat panel is open.
 * Use this to wrap content that should shrink when chat opens.
 */
export function ViewerChatLayout({
  children,
  className,
}: ViewerChatLayoutProps) {
  const context = useViewerChatSafe();

  // If not in provider or not enabled, just render children
  if (!context || !context.isEnabled) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn(
        "transition-all duration-300",
        context.isOpen && "pr-[400px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
