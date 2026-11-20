import React from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { LockIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UpgradeButton } from "@/components/ui/upgrade-button";

interface FeaturePreviewProps {
  title: string;
  description: string;
  requiredPlan: PlanEnum;
  trigger: string;
  children: React.ReactNode;
  className?: string;
  upgradeButtonText?: string;
  highlightItem?: string[];
}

/**
 * A reusable component that shows a preview of premium features with an upgrade overlay
 *
 * @example
 * ```tsx
 * <FeaturePreview
 *   title="Advanced Analytics"
 *   description="Get detailed insights into document engagement and user behavior"
 *   requiredPlan={PlanEnum.DataRooms}
 *   trigger="analytics_preview"
 * >
 *   <YourMockAnalyticsComponent />
 * </FeaturePreview>
 * ```
 */
export function FeaturePreview({
  title,
  description,
  requiredPlan,
  trigger,
  children,
  className,
  upgradeButtonText = "Unlock",
  highlightItem,
}: FeaturePreviewProps) {
  return (
    <div className={cn("relative", className)}>
      {/* Content with no interaction */}
      <div className="pointer-events-none">{children}</div>

      {/* Gradient overlay that fades the content into the upgrade section */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/90" />

      {/* Upgrade prompt positioned at the bottom */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-center pb-8">
        <Card className="max-w-md border-2 border-primary/20 bg-background/95 shadow-lg backdrop-blur-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <LockIcon className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription className="text-base">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <UpgradeButton
              text={upgradeButtonText}
              clickedPlan={requiredPlan}
              trigger={trigger}
              highlightItem={highlightItem}
              size="lg"
              className="w-full"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
