import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const alertVariants = cva("relative w-full rounded-control border p-4 text-sm", {
  variants: {
    variant: {
      default: "border-line bg-surface text-ink",
      success: "border-ok/30 bg-ok-soft text-ok-ink",
      destructive: "border-hot/30 bg-hot-soft text-hot",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Alert({ className, children, variant, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode } & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>{children}</div>;
}
