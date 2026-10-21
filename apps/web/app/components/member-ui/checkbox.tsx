import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export function Checkbox({ checked, className, ...props }: ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  const indeterminate = checked === "indeterminate";
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      className={cn("peer size-4 shrink-0 rounded-[4px] border border-line-strong bg-surface shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-contrast data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-contrast", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {indeterminate ? <Minus className="size-3.5" strokeWidth={3} aria-hidden="true" /> : <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
