import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cn("flex h-10 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-sm outline-none placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-hot aria-invalid:ring-2 aria-invalid:ring-hot/20", className)} {...props} />;
}
