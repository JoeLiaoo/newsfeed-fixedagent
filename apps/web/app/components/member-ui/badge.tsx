import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2", {
  variants: {
    variant: {
      default: "border-transparent bg-accent text-accent-contrast",
      secondary: "border-transparent bg-bg-sunk text-ink-2",
      outline: "border-line-strong text-ink-2",
      success: "border-transparent bg-ok-soft text-ok-ink",
      warning: "border-transparent bg-amber-soft text-amber-ink",
      destructive: "border-transparent bg-hot-soft text-hot",
    },
  },
  defaultVariants: { variant: "secondary" },
});

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
