import React, { ButtonHTMLAttributes, useState } from "react";

import { PlanEnum } from "@/ee/stripe/constants";
import { CrownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { UpgradePlanModal } from "@/components/billing/upgrade-plan-modal";
import { Button } from "@/components/ui/button";

interface UpgradeButtonProps {
  text: string;
  clickedPlan: PlanEnum;
  trigger: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  highlightItem?: string[];
  hideItems?: string[];
  onClick?: () => void;
  useModal?: boolean;
  customText?: string;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  disabled?: boolean;
}

export function UpgradeButton({
  text,
  clickedPlan,
  trigger,
  variant = "default",
  size = "default",
  className,
  highlightItem,
  hideItems,
  onClick,
  useModal = true,
  customText,
  type = "button",
  disabled,
}: UpgradeButtonProps) {
  const [open, setOpen] = useState(false);

  const buttonContent = (
    <Button
      disabled={disabled}
      type={type}
      variant={variant}
      size={size}
      className={cn("gap-1.5", className)}
      onClick={onClick ? onClick : useModal ? () => setOpen(true) : undefined}
    >
      {customText ? (
        <>
          <CrownIcon className="h-4 w-4" /> {customText}
        </>
      ) : (
        <>
          <CrownIcon className="h-4 w-4" />
          Upgrade to {text}
        </>
      )}
    </Button>
  );

  if (!useModal || onClick || disabled) {
    return buttonContent;
  }

  return (
    <>
      {buttonContent}
      <UpgradePlanModal
        clickedPlan={clickedPlan}
        trigger={trigger}
        open={open}
        setOpen={setOpen}
        highlightItem={highlightItem}
        hideItems={hideItems}
      />
    </>
  );
}

export function createUpgradeButton(
  text: string,
  clickedPlan: PlanEnum,
  trigger: string,
  options?: Partial<UpgradeButtonProps>,
) {
  return function UpgradeButtonComponent(props?: Partial<UpgradeButtonProps>) {
    return (
      <UpgradeButton
        text={text}
        clickedPlan={clickedPlan}
        trigger={trigger}
        {...options}
        {...props}
      />
    );
  };
}
