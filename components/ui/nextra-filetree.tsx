"use client";

/**
 * This component is based on the nextra's filetree component from @shuding
 * https://github.com/shuding/nextra/blob/main/packages/nextra/src/components/file-tree.tsx
 *
 */
import React, {
  CSSProperties,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";

import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ctx = createContext(0);
const prefersLightTextCtx = createContext(false);

function useIndent() {
  return useContext(ctx);
}

export function usePrefersLightText() {
  return useContext(prefersLightTextCtx);
}

interface FolderProps {
  name: string;
  label?: ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  active?: boolean;
  childActive?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
  disable?: boolean;
}

interface FileProps {
  name: string;
  label?: ReactElement;
  active?: boolean;
  onToggle?: (active: boolean) => void;
}

function Tree({
  children,
  prefersLightText,
  style,
}: {
  children: ReactNode;
  prefersLightText?: boolean;
  style?: CSSProperties;
}): ReactElement {
  return (
    <prefersLightTextCtx.Provider value={prefersLightText ?? false}>
      <div
        className={cn("nextra-filetree !mt-0 w-full select-none text-sm")}
        style={style}
      >
        <div className="block space-y-1 rounded-lg">{children}</div>
      </div>
    </prefersLightTextCtx.Provider>
  );
}

function Ident(): ReactElement {
  const length = useIndent();
  return (
    <>
      {Array.from({ length }, (_, i) => (
        <span className="w-5 shrink-0" key={i} />
      ))}
    </>
  );
}

const Folder = memo<FolderProps>(
  ({
    label,
    name,
    open,
    children,
    active,
    childActive,
    defaultOpen = false,
    onToggle,
    className,
    disable,
  }) => {
    const indent = useIndent();
    const prefersLightText = usePrefersLightText();
    const [isOpen, setIsOpen] = useState(defaultOpen || childActive);

    useEffect(() => {
      if (childActive) {
        setIsOpen(true);
      }
    }, [childActive]);

    const handleFolderClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle?.(!isOpen);
      },
      [isOpen, onToggle],
    );

    const handleChevronClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
      },
      [isOpen],
    );

    const isFolderOpen = open === undefined ? isOpen : open;
    const hasChildren = React.Children.count(children) > 0;

    return (
      <li
        className={cn(
          "flex w-full min-w-0 list-none flex-col",
          hasChildren && "space-y-1",
        )}
      >
        <div
          title={name}
          className={cn(
            "flex w-full min-w-0 cursor-pointer items-center",
            "rounded-md duration-100",
            prefersLightText
              ? "text-[var(--viewer-text)] hover:bg-[var(--viewer-control-bg)]"
              : "text-foreground hover:bg-gray-100 hover:dark:bg-muted",
            "px-3 py-1.5 leading-6",
            active &&
              (prefersLightText
                ? "bg-[var(--viewer-panel-active)] font-semibold"
                : "bg-gray-100 font-semibold dark:bg-muted"),
            disable && "pointer-events-none cursor-auto opacity-50",
            className,
          )}
          onClick={handleFolderClick}
        >
          <Ident />
          <div
            className="-m-1 -ml-2 flex h-full shrink-0 items-center justify-center rounded p-2"
            onClick={handleChevronClick}
          >
            <ChevronRightIcon
              className={cn(
                "chevron h-4 w-4 shrink-0 transition-transform duration-150",
                isFolderOpen && "rotate-90",
              )}
            />
          </div>
          {isFolderOpen ? (
            <FolderOpenIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <FolderIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <span
            className="ml-2 min-w-0 flex-1 truncate whitespace-nowrap"
            title={(label ?? name) as string}
          >
            {label ?? name}
          </span>
        </div>
        {isFolderOpen && (
          <ul>
            <ctx.Provider value={indent + 1}>{children}</ctx.Provider>
          </ul>
        )}
      </li>
    );
  },
);
Folder.displayName = "Folder";

const File = memo<FileProps>(({ label, name, active, onToggle }) => {
  const prefersLightText = usePrefersLightText();
  const toggle = useCallback(() => {
    onToggle?.(!active);
  }, [active, onToggle]);

  return (
    <li
      className={cn(
        "flex min-w-0 list-none",
        "rounded-md duration-100",
        prefersLightText
          ? "text-[var(--viewer-muted-text)] hover:bg-[var(--viewer-control-bg)]"
          : "text-foreground hover:bg-gray-100 hover:dark:bg-muted",
        "px-3 py-1.5 leading-6",
        active &&
          (prefersLightText
            ? "bg-[var(--viewer-panel-active)] text-[var(--viewer-text)] font-semibold"
            : "bg-gray-100 font-semibold dark:bg-muted"),
      )}
    >
      <span
        className="ml-5 flex w-full min-w-0 cursor-default items-center"
        onClick={toggle}
      >
        <Ident />
        <FileIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span
          className="ml-2 min-w-0 flex-1 truncate whitespace-nowrap"
          title={(label ?? name) as string}
        >
          {label ?? name}
        </span>
      </span>
    </li>
  );
});
File.displayName = "File";

export const FileTree = Object.assign(Tree, { Folder, File });
