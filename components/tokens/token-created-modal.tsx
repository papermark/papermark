import {
  Dispatch,
  SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import { CheckIcon, CopyIcon } from "lucide-react";

import { copyToClipboard } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TokenCreatedModalProps {
  showModal: boolean;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  token: string;
}

function TokenCreatedModal({
  showModal,
  setShowModal,
  token,
}: TokenCreatedModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(token, "API key copied to clipboard");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog
      open={showModal}
      onOpenChange={(open) => {
        setShowModal(open);
        if (!open) {
          setCopied(false);
        }
      }}
    >
      <DialogContent className="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your new API key</DialogTitle>
          <DialogDescription>
            Copy your API key now. For security, it won&apos;t be shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
          <code className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900 dark:text-gray-100">
            {token}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="shrink-0"
          >
            {copied ? (
              <>
                <CheckIcon className="!h-4 !w-4" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="!h-4 !w-4" />
                Copy
              </>
            )}
          </Button>
        </div>

        <Button
          type="button"
          onClick={() => setShowModal(false)}
          className="w-full bg-gray-900 text-gray-50 hover:bg-gray-900/90"
        >
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function useTokenCreatedModal({ token }: { token: string }) {
  const [showTokenCreatedModal, setShowTokenCreatedModal] = useState(false);

  const TokenCreatedModalCallback = useCallback(
    () => (
      <TokenCreatedModal
        showModal={showTokenCreatedModal}
        setShowModal={setShowTokenCreatedModal}
        token={token}
      />
    ),
    [showTokenCreatedModal, token],
  );

  return useMemo(
    () => ({
      showTokenCreatedModal,
      setShowTokenCreatedModal,
      TokenCreatedModal: TokenCreatedModalCallback,
    }),
    [showTokenCreatedModal, TokenCreatedModalCallback],
  );
}
