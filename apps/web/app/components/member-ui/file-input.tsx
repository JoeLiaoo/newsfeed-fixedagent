import { useState, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/** A native, keyboard accessible file control with labels controlled by the app locale. */
export function FileInput({ id, className, onChange, multiple, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [names, setNames] = useState("");
  return <span className={cn("relative flex min-h-10 w-full min-w-0 items-center gap-3 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25", className)}>
    <input {...props} id={id} type="file" multiple={multiple} className="sr-only" onChange={event => {
      setNames(Array.from(event.target.files ?? []).map(file => file.name).join("、"));
      onChange?.(event);
    }} />
    <label htmlFor={id} className="cursor-pointer whitespace-nowrap font-medium text-accent">选择文件</label>
    <span className="min-w-0 truncate text-ink-3">{names || "未选择文件"}</span>
  </span>;
}
