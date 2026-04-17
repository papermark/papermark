"use client";

import { useCallback, useMemo, useState } from "react";

import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Youtube from "@tiptap/extension-youtube";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading1,
  Heading2,
  ImageIcon,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo,
  Undo,
} from "lucide-react";

import { Youtube as YoutubeIcon } from "@/components/shared/icons/youtube";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Validates if a given URL is a valid YouTube URL.
 * Supports:
 * - youtube.com/watch?v=VIDEO_ID
 * - youtu.be/VIDEO_ID
 * - youtube.com/embed/VIDEO_ID
 * - www.youtube.com variants
 * - youtube-nocookie.com variants
 */
function isValidYouTubeUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;

  try {
    const parsedUrl = new URL(url.trim());
    const hostname = parsedUrl.hostname.toLowerCase();

    // Check for valid YouTube hostnames
    const validHostnames = [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "www.youtu.be",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com",
    ];

    if (!validHostnames.includes(hostname)) return false;

    // For youtu.be short URLs, the video ID is in the pathname
    if (hostname === "youtu.be" || hostname === "www.youtu.be") {
      const videoId = parsedUrl.pathname.slice(1); // Remove leading slash
      return videoId.length > 0 && /^[\w-]+$/.test(videoId);
    }

    // For youtube.com/watch URLs, check for 'v' parameter
    if (parsedUrl.pathname === "/watch") {
      const videoId = parsedUrl.searchParams.get("v");
      return videoId !== null && videoId.length > 0 && /^[\w-]+$/.test(videoId);
    }

    // For youtube.com/embed/VIDEO_ID URLs
    if (parsedUrl.pathname.startsWith("/embed/")) {
      const videoId = parsedUrl.pathname.replace("/embed/", "").split("/")[0];
      return videoId.length > 0 && /^[\w-]+$/.test(videoId);
    }

    // For youtube.com/v/VIDEO_ID URLs (legacy)
    if (parsedUrl.pathname.startsWith("/v/")) {
      const videoId = parsedUrl.pathname.replace("/v/", "").split("/")[0];
      return videoId.length > 0 && /^[\w-]+$/.test(videoId);
    }

    return false;
  } catch {
    // URL parsing failed
    return false;
  }
}

interface RichTextEditorProps {
  content?: any;
  onChange?: (content: any) => void;
  placeholder?: string;
  onImageUpload?: (file: File) => Promise<string>;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = "Start typing...",
  onImageUpload,
}: RichTextEditorProps) {
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeUrlError, setYoutubeUrlError] = useState<string | null>(null);

  // Memoize URL validation to avoid recalculating on every render
  const isYoutubeUrlValid = useMemo(
    () => isValidYouTubeUrl(youtubeUrl),
    [youtubeUrl],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          class: "rounded-lg max-w-full h-auto",
        },
      }),
      Youtube.configure({
        controls: true,
        nocookie: true,
        HTMLAttributes: {
          class: "rounded-lg w-full aspect-video",
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    immediatelyRender: false, // Fix SSR hydration issues
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON());
    },
    editorProps: {
      handleDrop: (view, event, slice, moved) => {
        if (
          !moved &&
          event.dataTransfer &&
          event.dataTransfer.files &&
          event.dataTransfer.files[0]
        ) {
          const file = event.dataTransfer.files[0];

          // Check if it's an image file
          if (file.type.startsWith("image/") && onImageUpload) {
            event.preventDefault();

            // Upload the image
            onImageUpload(file)
              .then((url) => {
                const { state } = view;
                const { selection } = state;
                const position = selection.empty
                  ? selection.from
                  : selection.to;

                const node = state.schema.nodes.image.create({ src: url });
                const transaction = state.tr.insert(position, node);
                view.dispatch(transaction);
              })
              .catch((error) => {
                console.error("Failed to upload dropped image:", error);
              });

            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event, slice) => {
        const items = event.clipboardData?.items;
        if (items && onImageUpload) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith("image/")) {
              event.preventDefault();

              const file = item.getAsFile();
              if (file) {
                onImageUpload(file)
                  .then((url) => {
                    const { state } = view;
                    const { selection } = state;
                    const position = selection.empty
                      ? selection.from
                      : selection.to;

                    const node = state.schema.nodes.image.create({ src: url });
                    const transaction = state.tr.insert(position, node);
                    view.dispatch(transaction);
                  })
                  .catch((error) => {
                    console.error("Failed to upload pasted image:", error);
                  });
              }

              return true;
            }
          }
        }
        return false;
      },
    },
  });

  const addImage = useCallback(
    async (e?: React.MouseEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (!editor || !onImageUpload) return;

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            const url = await onImageUpload(file);
            editor.chain().focus().setImage({ src: url }).run();
          } catch (error) {
            console.error("Failed to upload image:", error);
          }
        }
      };
      input.click();
    },
    [editor, onImageUpload],
  );

  const addYoutubeVideo = useCallback(() => {
    if (!editor || !youtubeUrl) return;

    const trimmed = youtubeUrl.trim();

    // Re-validate URL before inserting
    if (!isValidYouTubeUrl(trimmed)) {
      setYoutubeUrlError(
        "Please enter a valid YouTube URL (e.g., youtube.com/watch?v=..., youtu.be/...)",
      );
      return;
    }

    editor.commands.setYoutubeVideo({
      src: trimmed,
    });

    setYoutubeUrl("");
    setYoutubeUrlError(null);
    setYoutubeDialogOpen(false);
  }, [editor, youtubeUrl]);

  // Clear error and URL when dialog closes
  const handleYoutubeDialogChange = useCallback((open: boolean) => {
    setYoutubeDialogOpen(open);
    if (!open) {
      setYoutubeUrl("");
      setYoutubeUrlError(null);
    }
  }, []);

  if (!editor) {
    return null;
  }

  return (
    <div className="rounded-md border border-input">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 border-b border-input p-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          className={editor.isActive("heading", { level: 1 }) ? "bg-muted" : ""}
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          className={editor.isActive("heading", { level: 2 }) ? "bg-muted" : ""}
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive("bold") ? "bg-muted" : ""}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive("italic") ? "bg-muted" : ""}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive("bulletList") ? "bg-muted" : ""}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive("orderedList") ? "bg-muted" : ""}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={editor.isActive("blockquote") ? "bg-muted" : ""}
        >
          <Quote className="h-4 w-4" />
        </Button>
        {onImageUpload && (
          <>
            <div className="mx-1 h-6 w-px bg-border" />
            <Button variant="ghost" size="sm" onClick={addImage} type="button">
              <ImageIcon className="h-4 w-4" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setYoutubeDialogOpen(true)}
        >
          <YoutubeIcon className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-6 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor */}
      <div className="min-h-[200px] p-3">
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none focus:outline-none [&_.ProseMirror]:min-h-[150px] [&_.ProseMirror]:focus:outline-none"
        />
      </div>

      {/* YouTube Dialog */}
      <Dialog open={youtubeDialogOpen} onOpenChange={handleYoutubeDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add YouTube Video</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="youtube-url">YouTube URL</Label>
              <Input
                id="youtube-url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => {
                  setYoutubeUrl(e.target.value);
                  // Clear error when user starts typing
                  if (youtubeUrlError) setYoutubeUrlError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addYoutubeVideo();
                  }
                }}
                className={youtubeUrlError ? "border-destructive" : ""}
              />
              {youtubeUrlError ? (
                <p className="text-xs text-destructive">{youtubeUrlError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paste a YouTube video URL (e.g., youtube.com/watch?v=...,
                  youtu.be/...)
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleYoutubeDialogChange(false)}
            >
              Cancel
            </Button>
            <Button onClick={addYoutubeVideo} disabled={!isYoutubeUrlValid}>
              Add Video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
