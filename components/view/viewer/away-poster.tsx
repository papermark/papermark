import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface AwayPosterProps {
  isVisible: boolean;
  inactivityThreshold: number;
  onDismiss?: () => void;
  className?: string;
}

export function AwayPoster({
  isVisible,
  inactivityThreshold,
  onDismiss,
  className,
}: AwayPosterProps) {
  const { t } = useTranslation("viewer");
  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return remainingSeconds > 0
        ? t("awayPoster.minSec", "{{minutes}}min {{seconds}}sec", { minutes, seconds: remainingSeconds })
        : t("awayPoster.minOnly", "{{minutes}}min", { minutes });
    }
    return t("awayPoster.secOnly", "{{seconds}}sec", { seconds });
  };

  if (!isVisible) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[99998] bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="away-poster-title"
        aria-describedby="away-poster-description"
        className={cn(
          "fixed bottom-4 left-4 right-4 z-[99999] w-full max-w-md rounded-md border bg-card p-4 text-card-foreground shadow-lg",
          "sm:bottom-6 sm:left-6 sm:right-auto sm:w-auto sm:max-w-lg",
          "animate-in fade-in slide-in-from-bottom",
          className,
        )}
      >
        <h2 id="away-poster-title" className="sr-only">
          {t("awayPoster.ariaTitle", "Auto-paused session notification")}
        </h2>

        <p id="away-poster-description" className="sr-only">
          {t("awayPoster.ariaDescription", "Your session was paused due to inactivity. Click continue or move your mouse to resume.")}
        </p>

        <div className="space-y-5">
          <div className="flex items-center space-x-2">
            <Badge
              variant="outline"
              className="border-orange-400 bg-orange-100 text-orange-600"
            >
              {t("awayPoster.badge", "Auto-paused")}
            </Badge>
            <span className="mr-6 text-xs text-muted-foreground">
              {t("awayPoster.idleFor", "{{duration}} idle", {
                duration: formatTime(inactivityThreshold),
              })}
            </span>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold">{t("awayPoster.title", "We paused to protect your session")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("awayPoster.description", "You were inactive since {{duration}}, so we paused the document preview to keep session safe.", {
                duration: formatTime(inactivityThreshold),
              })}
            </p>
          </div>

          <div className="pt-2">
            <Button onClick={onDismiss} className="w-full">
              <Play className="mr-2 h-4 w-4" />
              {t("awayPoster.resume", "Continue where you left off")}
            </Button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            {t("awayPoster.moveHint", "Or just move your mouse or press any key to continue")}
          </p>
        </div>
      </div>
    </>
  );
}