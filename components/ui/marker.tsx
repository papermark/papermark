import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const markerVariants = cva(
  "flex items-center gap-2 text-xs font-medium text-muted-foreground",
  {
    variants: {
      variant: {
        default: "",
        border: "border-b border-border pb-2",
        // Divider lines are decorative pseudo-elements that flex to fill the
        // space on each side of the centered label.
        separator:
          "before:h-px before:flex-1 before:bg-border before:content-[''] after:h-px after:flex-1 after:bg-border after:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface MarkerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof markerVariants> {
  asChild?: boolean;
}

const Marker = React.forwardRef<HTMLDivElement, MarkerProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="marker"
        className={cn(markerVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
Marker.displayName = "Marker";

const MarkerIcon = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    aria-hidden="true"
    data-slot="marker-icon"
    className={cn(
      "flex shrink-0 items-center [&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
MarkerIcon.displayName = "MarkerIcon";

const MarkerContent = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="marker-content"
    className={cn("min-w-0", className)}
    {...props}
  />
));
MarkerContent.displayName = "MarkerContent";

export { Marker, MarkerIcon, MarkerContent, markerVariants };
