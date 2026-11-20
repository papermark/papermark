import { useState } from "react";

import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { getEmbedUrl } from "@/lib/utils/embed";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EmbedCodeModalProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  linkId: string;
  linkName: string;
  domain?: string | null;
  slug?: string | null;
}

export default function EmbedCodeModal({
  isOpen,
  setIsOpen,
  linkId,
  linkName,
  domain,
  slug,
}: EmbedCodeModalProps) {
  const [copied, setCopied] = useState(false);

  const embedCode = `<iframe
  src="${getEmbedUrl({ linkId, domain, slug })}"
  style="width: 100%; height: 100%; border: none; border-radius: 8px;"
  allow="fullscreen"
  loading="lazy">
</iframe>`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(embedCode);
    toast.success("Embed code copied to clipboard");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-normal">
            Embed Code for <span className="font-bold">{linkName}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <pre className="max-h-[200px] overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-secondary p-4 font-mono text-sm text-secondary-foreground">
              <code className="block w-full pr-8">{embedCode}</code>
            </pre>
            <Button
              size="sm"
              variant="ghost"
              className="absolute right-2 top-2"
              onClick={copyToClipboard}
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Copy and paste this code into your website to embed the document
            link.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
