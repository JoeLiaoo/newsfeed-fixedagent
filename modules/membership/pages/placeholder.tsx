import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";

/**
 * A page that is not built yet: its name, a way back, and nothing else. No sample content, no
 * control that would do nothing.
 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PhoneBar back={{ to: "/more", label: "我的" }} title={title} />
      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-3">开发中，敬请期待</p>
      </main>
    </>
  );
}
