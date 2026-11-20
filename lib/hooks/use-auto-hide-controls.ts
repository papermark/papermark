import { useCallback, useEffect, useRef, useState } from "react";

type UseAutoHideControlsOptions = {
  /** Auto-hiding is only active while this is true (e.g. in fullscreen). */
  active: boolean;
  /** Changing this re-shows the controls then restarts the hide timer (e.g. page number). */
  resetKey?: unknown;
  delayMs?: number;
};

/**
 * Shows a set of overlay controls, then fades them after `delayMs` so the
 * content is unobstructed. `reveal()` brings them back and restarts the timer.
 * While `active` is false the controls stay permanently visible.
 */
export function useAutoHideControls({
  active,
  resetKey,
  delayMs = 3000,
}: UseAutoHideControlsOptions) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), delayMs);
  }, [delayMs]);

  const reveal = useCallback(() => {
    setVisible(true);
    if (active) scheduleHide();
  }, [active, scheduleHide]);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setVisible(true);
      return;
    }
    setVisible(true);
    scheduleHide();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, resetKey, scheduleHide]);

  return { visible, reveal };
}
