import { type ElementType, useEffect, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { Domain, LinkType } from "@prisma/client";
import { AlertTriangleIcon, CircleCheckIcon, InfoIcon } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import { useAnalytics } from "@/lib/analytics";
import { validDomainRegex } from "@/lib/domains";
import { usePlan } from "@/lib/swr/use-billing";
import useLimits from "@/lib/swr/use-limits";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LoadingSpinner from "@/components/ui/loading-spinner";

import { UpgradePlanModal } from "../billing/upgrade-plan-modal";
import { UpgradeButton } from "../ui/upgrade-button";

const sanitizeDomain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, "")
    .split("/")[0];

type DomainStatus =
  | "checking"
  | "has site"
  | "available"
  | "idle"
  | "invalid"
  | "error";

const STATUS_CONFIG: Record<
  DomainStatus,
  {
    prefix?: string;
    useStrong?: boolean;
    suffix?: string;
    icon?: ElementType;
    className?: string;
    message?: string;
  }
> = {
  checking: {
    prefix: "Checking availability for",
    useStrong: true,
    suffix: "...",
    icon: LoadingSpinner,
    className: "bg-neutral-100 text-neutral-500",
  },
  "has site": {
    suffix:
      "is currently pointing to an existing website. Only proceed if you're sure you want to use this domain for Papermark links.",
    icon: InfoIcon,
    className: "bg-blue-100 text-blue-800",
  },
  available: {
    suffix: "is ready to connect.",
    icon: CircleCheckIcon,
    className: "bg-emerald-100 text-emerald-600",
  },
  invalid: {
    message: "Enter a valid domain to check availability.",
    icon: AlertTriangleIcon,
    className: "bg-rose-100 text-rose-600",
  },
  idle: {
    message: "Enter a valid domain to check availability.",
    className: "bg-neutral-100 text-neutral-500",
  },
  error: {
    message: "We couldn't check this domain right now. Try again.",
    icon: AlertTriangleIcon,
    className: "bg-rose-100 text-rose-600",
  },
};

export function AddDomainModal({
  open,
  setOpen,
  onAddition,
  linkType,
  children,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onAddition?: (newDomain: Domain) => void;
  linkType?: Omit<LinkType, "WORKFLOW_LINK">;
  children?: React.ReactNode;
}) {
  const [domainInput, setDomainInput] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [domainStatus, setDomainStatus] = useState<DomainStatus>("idle");
  const [statusMessageOverride, setStatusMessageOverride] = useState<
    string | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);

  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { isFree, isPro, isBusiness } = usePlan();
  const { limits } = useLimits();
  const analytics = useAnalytics();

  useEffect(() => {
    if (!open) {
      setDomainInput("");
      setSubmitting(false);
      setDomainStatus("idle");
      setStatusMessageOverride(null);
    }
  }, [open]);

  const sanitizedDomain = sanitizeDomain(domainInput);
  const [debouncedDomain] = useDebounce(sanitizedDomain, 500);

  useEffect(() => {
    if (!open) return;
    if (!teamId) return;

    if (!debouncedDomain) {
      setDomainStatus("idle");
      setStatusMessageOverride(null);
      return;
    }

    if (debouncedDomain.includes("papermark")) {
      setDomainStatus("invalid");
      setStatusMessageOverride("Domain cannot contain 'papermark'.");
      return;
    }

    if (!validDomainRegex.test(debouncedDomain)) {
      setDomainStatus("idle");
      setStatusMessageOverride(null);
      return;
    }

    // Abort any in-flight validation request before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDomainStatus("checking");
    setStatusMessageOverride(null);

    fetch(
      `/api/teams/${teamId}/domains/${encodeURIComponent(
        debouncedDomain,
      )}/validate`,
      { signal: controller.signal },
    )
      .then(async (res) => res.json())
      .then((data) => {
        const nextStatus = data?.status as DomainStatus | undefined;
        if (
          nextStatus &&
          ["invalid", "has site", "available"].includes(nextStatus)
        ) {
          setDomainStatus(nextStatus);
        } else {
          setDomainStatus("error");
        }
      })
      .catch((err) => {
        // Ignore aborted requests – they are expected when the user types again
        if ((err as DOMException).name === "AbortError") return;
        setDomainStatus("error");
      });

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [debouncedDomain, open, teamId]);

  const saveDisabled =
    !["available", "has site"].includes(domainStatus) || submitting;

  const handleSubmit = async (event: any) => {
    event.preventDefault();
    event.stopPropagation();

    const normalizedDomain = sanitizeDomain(domainInput);
    if (!normalizedDomain || !validDomainRegex.test(normalizedDomain)) {
      return toast.error("Please enter a valid domain (e.g., example.com).");
    }

    if (normalizedDomain.includes("papermark")) {
      return toast.error("Domain cannot contain 'papermark'.");
    }

    if (saveDisabled) {
      return toast.error(
        statusMessageOverride ?? "Please enter a valid domain before adding.",
      );
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/domains`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domain: normalizedDomain,
        }),
      });

      if (!response.ok) {
        const { message } = await response.json();
        toast.error(message);
        return;
      }

      const newDomain = await response.json();

      analytics.capture("Domain Added", { slug: normalizedDomain });
      toast.success("Domain added successfully! 🎉");

      // Update local data with the new link
      onAddition && onAddition(newDomain);

      setOpen(false);

      !onAddition && window.open("/settings/domains", "_blank");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "An unknown error occurred";
      toast.error(`Failed to add domain: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // If the team is
  // - on a free plan
  // - on pro plan and has custom domain on pro plan disabled
  // - on business plan and has custom domain in dataroom disabled
  // => then show the upgrade modal
  if (
    isFree ||
    (isPro && !limits?.customDomainOnPro) ||
    (linkType === "DATAROOM_LINK" &&
      isBusiness &&
      !limits?.customDomainInDataroom)
  ) {
    if (children) {
      return (
        <UpgradeButton
          text="Add Domain"
          clickedPlan={
            linkType === "DATAROOM_LINK"
              ? PlanEnum.DataRooms
              : PlanEnum.Business
          }
          highlightItem={["custom-domain"]}
          trigger="add_domain_overview"
        />
      );
    } else {
      return (
        <UpgradePlanModal
          clickedPlan={
            linkType === "DATAROOM_LINK"
              ? PlanEnum.DataRooms
              : PlanEnum.Business
          }
          open={open}
          setOpen={setOpen}
          trigger={"add_domain_link_sheet"}
          highlightItem={["custom-domain"]}
        />
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader className="text-start">
          <DialogTitle>Add Domain</DialogTitle>
          <DialogDescription>
            Add a custom domain and verify it with DNS.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Label htmlFor="domain" className="opacity-80">
            Your domain
          </Label>
          {(() => {
            const currentStatus = STATUS_CONFIG[domainStatus];
            const StatusIcon = currentStatus.icon;
            return (
              <div
                className={cn(
                  "-m-1 mt-2 rounded-[0.625rem] p-1",
                  currentStatus.className || "bg-neutral-100 text-neutral-500",
                )}
              >
                <div className="flex rounded-md border border-neutral-300 bg-white">
                  <Input
                    id="domain"
                    placeholder="docs.yourdomain.com"
                    className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    value={domainInput}
                    onBlur={() => {
                      const normalized = sanitizeDomain(domainInput);
                      if (normalized && normalized !== domainInput) {
                        setDomainInput(normalized);
                      }
                    }}
                    onChange={(e) => {
                      // Cancel any in-flight validation so stale results
                      // don't overwrite the reset status below
                      abortRef.current?.abort();
                      abortRef.current = null;
                      setDomainStatus("idle");
                      setStatusMessageOverride(null);
                      setDomainInput(e.target.value);
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 p-2 text-sm">
                  <p>
                    {["checking", "has site", "available"].includes(
                      domainStatus,
                    ) ? (
                      <>
                        {currentStatus.prefix || "The domain"}{" "}
                        {currentStatus.useStrong ? (
                          <strong className="font-semibold underline underline-offset-2">
                            {sanitizedDomain || "this domain"}
                          </strong>
                        ) : (
                          <span className="font-semibold underline underline-offset-2">
                            {sanitizedDomain || "this domain"}
                          </span>
                        )}{" "}
                        {currentStatus.suffix}
                      </>
                    ) : (
                      statusMessageOverride ||
                      currentStatus.message ||
                      "Enter a valid domain to check availability."
                    )}
                  </p>
                  {StatusIcon && <StatusIcon className="h-5 w-5 shrink-0" />}
                </div>
              </div>
            );
          })()}

          <DialogFooter className="mt-6">
            <Button
              type="submit"
              className="h-9 w-full"
              disabled={saveDisabled}
            >
              {submitting ? "Adding domain..." : "Add domain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
