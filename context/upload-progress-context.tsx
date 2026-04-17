import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { UploadNotificationDrawer } from "@/components/upload-notification";
import {
  RejectedFile,
  UploadBatchState,
  UploadItemState,
} from "@/components/upload-zone";

interface UploadProgressContextType {
  uploadBatch: UploadBatchState | null;
  setUploadBatch: React.Dispatch<
    React.SetStateAction<UploadBatchState | null>
  >;
  rejectedFiles: RejectedFile[];
  setRejectedFiles: React.Dispatch<React.SetStateAction<RejectedFile[]>>;
  showDrawer: boolean;
  setShowDrawer: (show: boolean) => void;
  cancelUpload: (() => void) | null;
  addCancelFn: (fn: () => void) => void;
  cancelItem: (itemId: string) => void;
  cancelledItemIds: Set<string>;
  cancelledItemIdsRef: React.RefObject<Set<string>>;
}

const UploadProgressContext = createContext<UploadProgressContextType | null>(
  null,
);

function getActiveUploadByteTotals(items: UploadItemState[]) {
  let bytesUploaded = 0;
  let bytesTotal = 0;

  for (const item of items) {
    if (item.cancelled) continue;
    bytesUploaded += item.bytesUploaded ?? 0;
    bytesTotal += item.bytesTotal ?? 0;
  }

  return { bytesUploaded, bytesTotal };
}

export function UploadProgressProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [uploadBatch, setUploadBatch] = useState<UploadBatchState | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedFile[]>([]);
  const [showDrawer, setShowDrawer] = useState(false);
  const [hasCancelFns, setHasCancelFns] = useState(false);
  const cancelFnsRef = useRef<(() => void)[]>([]);
  const [cancelledItemIds, setCancelledItemIds] = useState<Set<string>>(
    new Set(),
  );
  const cancelledItemIdsRef = useRef(cancelledItemIds);
  cancelledItemIdsRef.current = cancelledItemIds;

  const addCancelFn = useCallback((fn: () => void) => {
    cancelFnsRef.current.push(fn);
    setHasCancelFns(true);
  }, []);

  const cancelUpload = useCallback(() => {
    cancelFnsRef.current.forEach((fn) => fn());
    cancelFnsRef.current = [];
    setHasCancelFns(false);
    setUploadBatch((prev) => {
      if (!prev) return prev;
      let addedCompleted = 0;
      const updatedItems = prev.items.map((it) => {
        if (it.cancelled) return it;
        const remaining =
          it.totalEntries - it.completedEntries - it.failedEntries;
        if (remaining > 0) {
          addedCompleted += remaining;
          return {
            ...it,
            cancelled: true,
            completedEntries: it.totalEntries - it.failedEntries,
          } as UploadItemState;
        }
        return it;
      });
      const { bytesUploaded, bytesTotal } =
        getActiveUploadByteTotals(updatedItems);
      return {
        ...prev,
        cancelled: true,
        completedEntries: prev.completedEntries + addedCompleted,
        bytesUploaded,
        bytesTotal,
        items: updatedItems,
      };
    });
  }, []);

  const cancelItem = useCallback((itemId: string) => {
    setCancelledItemIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    setUploadBatch((prev) => {
      if (!prev) return prev;
      const target = prev.items.find((it) => it.itemId === itemId);
      if (!target || target.cancelled) return prev;
      const remaining =
        target.totalEntries - target.completedEntries - target.failedEntries;
      const updatedItems = prev.items.map((it) =>
        it.itemId === itemId
          ? ({
              ...it,
              cancelled: true,
              completedEntries: it.totalEntries - it.failedEntries,
            } as UploadItemState)
          : it,
      );
      const { bytesUploaded, bytesTotal } =
        getActiveUploadByteTotals(updatedItems);
      return {
        ...prev,
        completedEntries: prev.completedEntries + remaining,
        bytesUploaded,
        bytesTotal,
        items: updatedItems,
      };
    });
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setShowDrawer(false);
    setUploadBatch(null);
    setRejectedFiles([]);
    setCancelledItemIds(new Set());
    cancelFnsRef.current = [];
    setHasCancelFns(false);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    setShowDrawer(open);
    if (!open) {
      setUploadBatch(null);
      setRejectedFiles([]);
      setCancelledItemIds(new Set());
      cancelFnsRef.current = [];
      setHasCancelFns(false);
    }
  }, []);

  const value = useMemo<UploadProgressContextType>(
    () => ({
      uploadBatch,
      setUploadBatch,
      rejectedFiles,
      setRejectedFiles,
      showDrawer,
      setShowDrawer,
      cancelUpload: hasCancelFns ? cancelUpload : null,
      addCancelFn,
      cancelItem,
      cancelledItemIds,
      cancelledItemIdsRef,
    }),
    [
      uploadBatch,
      rejectedFiles,
      showDrawer,
      hasCancelFns,
      cancelUpload,
      addCancelFn,
      cancelItem,
      cancelledItemIds,
    ],
  );

  return (
    <UploadProgressContext.Provider value={value}>
      {children}
      {showDrawer ? (
        <UploadNotificationDrawer
          open={showDrawer}
          onOpenChange={handleOpenChange}
          batch={uploadBatch}
          setBatch={setUploadBatch}
          rejectedFiles={rejectedFiles}
          setRejectedFiles={setRejectedFiles}
          handleCloseDrawer={handleCloseDrawer}
          onCancel={hasCancelFns ? cancelUpload : undefined}
          onCancelItem={cancelItem}
        />
      ) : null}
    </UploadProgressContext.Provider>
  );
}

export function useUploadProgress() {
  const ctx = useContext(UploadProgressContext);
  if (!ctx) {
    throw new Error(
      "useUploadProgress must be used within UploadProgressProvider",
    );
  }
  return ctx;
}

/** Stable callbacks for wiring UploadZone to the shared upload-progress context. */
export function useUploadCallbacks() {
  const { setUploadBatch, setRejectedFiles, setShowDrawer, addCancelFn } =
    useUploadProgress();

  const onTraversalStart = useCallback(
    (preliminaryItems?: { name: string; isFolder: boolean }[]) => {
      setUploadBatch((prev) => {
        const isDone =
          prev &&
          (prev.cancelled ||
            (prev.totalEntries > 0 &&
              prev.completedEntries + prev.failedEntries >=
                prev.totalEntries));
        const baseBatch = isDone ? null : prev;
        if (!preliminaryItems?.length) return baseBatch;
        const newItems = preliminaryItems.map((pi) => ({
          itemId: crypto.randomUUID(),
          name: pi.name,
          type: (pi.isFolder ? "folder" : "file") as "folder" | "file",
          totalEntries: 0,
          completedEntries: 0,
          failedEntries: 0,
        }));
        if (!baseBatch) {
          return {
            batchId: crypto.randomUUID(),
            items: newItems,
            startedAt: Date.now(),
            totalEntries: 0,
            completedEntries: 0,
            failedEntries: 0,
          };
        }
        return {
          ...baseBatch,
          items: [...baseBatch.items, ...newItems],
        };
      });
      setShowDrawer(true);
    },
    [setUploadBatch, setShowDrawer],
  );

  const onUploadBatchStart = useCallback(
    (batch: UploadBatchState, cancelFn: () => void) => {
      addCancelFn(cancelFn);
      setUploadBatch((prev) => {
        if (!prev || prev.cancelled) return batch;
        const isPreliminary = prev.totalEntries === 0;
        if (isPreliminary) {
          const realNames = new Set(batch.items.map((it) => it.name));
          const kept = prev.items
            .filter((it) => !realNames.has(it.name))
            .map((it) => ({ ...it, cancelled: true }));
          return {
            ...batch,
            items: [...batch.items, ...kept],
            totalEntries: batch.totalEntries,
            completedEntries: batch.completedEntries,
            failedEntries: batch.failedEntries,
          };
        }
        const isActive =
          prev.completedEntries + prev.failedEntries < prev.totalEntries;
        if (isActive) {
          return {
            ...prev,
            items: [...prev.items, ...batch.items],
            totalEntries: prev.totalEntries + batch.totalEntries,
            completedEntries:
              prev.completedEntries + batch.completedEntries,
            failedEntries: prev.failedEntries + batch.failedEntries,
            bytesUploaded: (prev.bytesUploaded ?? 0) + (batch.bytesUploaded ?? 0),
            bytesTotal: (prev.bytesTotal ?? 0) + (batch.bytesTotal ?? 0),
          };
        }
        return batch;
      });
      setShowDrawer(true);
    },
    [addCancelFn, setUploadBatch, setShowDrawer],
  );

  const onUploadBatchUpdate = useCallback(
    (_batchId: string, update: Partial<UploadBatchState>) => {
      setUploadBatch((prev) => {
        if (!prev || prev.cancelled) return prev;
        const mergedItems = [...prev.items];
        if (update.items) {
          const indexMap = new Map<string, number>();
          for (let i = 0; i < mergedItems.length; i++) {
            indexMap.set(mergedItems[i].itemId, i);
          }
          for (const incoming of update.items) {
            const idx = indexMap.get(incoming.itemId);
            if (idx !== undefined && !mergedItems[idx].cancelled) {
              mergedItems[idx] = incoming;
            }
          }
        }
        let totalEntries = 0;
        let completedEntries = 0;
        let failedEntries = 0;
        for (const it of mergedItems) {
          totalEntries += it.totalEntries;
          completedEntries += it.completedEntries;
          failedEntries += it.failedEntries;
        }
        const { bytesUploaded, bytesTotal } =
          getActiveUploadByteTotals(mergedItems);
        return {
          ...prev,
          items: mergedItems,
          totalEntries,
          completedEntries,
          failedEntries,
          bytesUploaded,
          bytesTotal,
        };
      });
    },
    [setUploadBatch],
  );

  const onUploadRejected = useCallback(
    (rejected: RejectedFile[]) => {
      setRejectedFiles((prevRejected) => [...prevRejected, ...rejected]);
      const rejectedNames = new Set(rejected.map((r) => r.fileName));
      setUploadBatch((prev) => {
        if (!prev) return prev;
        let changed = false;
        const updatedItems = prev.items.map((it) => {
          if (
            it.totalEntries === 0 &&
            !it.cancelled &&
            rejectedNames.has(it.name)
          ) {
            changed = true;
            return { ...it, cancelled: true };
          }
          return it;
        });
        return changed ? { ...prev, items: updatedItems } : prev;
      });
      setShowDrawer(true);
    },
    [setRejectedFiles, setUploadBatch, setShowDrawer],
  );

  const onUploadAborted = useCallback(() => {
    setUploadBatch((prev) => {
      if (!prev) return prev;
      const updatedItems = prev.items.map((it) =>
        it.totalEntries === 0 && !it.cancelled
          ? { ...it, cancelled: true }
          : it,
      );
      return { ...prev, items: updatedItems };
    });
  }, [setUploadBatch]);

  return {
    onTraversalStart,
    onUploadBatchStart,
    onUploadBatchUpdate,
    onUploadRejected,
    onUploadAborted,
  };
}
