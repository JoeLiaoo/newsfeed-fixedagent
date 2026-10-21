import type { LabelHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none text-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)} {...props} />;
}
