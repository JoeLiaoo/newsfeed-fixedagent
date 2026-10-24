import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

/** A shared action menu with keyboard navigation and managed focus. */
export function Menu({ trigger, label, children }: { trigger: ReactNode; label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        title={label}
        className="inline-flex size-8 items-center justify-center rounded-control text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink data-[state=open]:bg-bg-sunk data-[state=open]:text-ink"
      >
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[168px] overflow-hidden rounded-tile border border-line bg-raised py-1 shadow-[var(--shadow-pop)]"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One entry of a Menu (a button or a link). */
export function MenuItem({ icon, children, onSelect, href, download }: { icon?: ReactNode; children: ReactNode; onSelect?: () => void; href?: string; download?: boolean }) {
  const cls = "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-2 outline-none transition-colors data-[highlighted]:bg-bg-sunk data-[highlighted]:text-ink";
  const inner = (
    <>
      {icon && <span aria-hidden="true" className="text-ink-4">{icon}</span>}
      {children}
    </>
  );
  return (
    <DropdownMenu.Item asChild onSelect={onSelect}>
      {href ? <a href={href} download={download} className={cls}>{inner}</a> : <button type="button" className={cls}>{inner}</button>}
    </DropdownMenu.Item>
  );
}
