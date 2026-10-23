import { Slot } from "@radix-ui/react-slot";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/** A box of the member pages. With `asChild` it takes the shape of its child, so a card that is a
 *  link keeps the card's own look instead of a second set of classes somewhere else. */
export function Card({ className, asChild = false, ...props }: HTMLAttributes<HTMLElement> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "section";
  return <Component className={cn("rounded-card border border-line bg-surface text-ink shadow-sm", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm leading-relaxed text-ink-3", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
