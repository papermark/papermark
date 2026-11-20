import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

import LoadingSpinner from "./loading-spinner";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 gap-2 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
        special: "text-white",
        orange:
          "bg-[#fb7a00] text-white hover:bg-[#fb7a00]/90 transition-colors",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors",
        ghost: "hover:bg-accent hover:text-accent-foreground transition-colors",
        link: "text-primary underline-offset-4 hover:underline transition-colors",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, disabled, loading, asChild = false, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {asChild ? (
          props.children
        ) : (
          <>
            {loading ? <LoadingSpinner className="mr-1 h-5 w-5" /> : null}
            {props.children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
