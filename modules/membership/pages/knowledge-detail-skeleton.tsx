import { Card, CardContent, CardHeader } from "@aihot/web/components/member-ui/card";

/** Match the detail header and first content card while the read is pending. */
export function KnowledgeDetailSkeleton({ kind }: { kind: "document" | "target" }) {
  const document = kind === "document";
  return <div role="status" className="mt-5" aria-label={document ? "正在加载材料…" : "正在加载知识页…"}>
    <span className="sr-only">{document ? "正在加载材料…" : "正在加载知识页…"}</span>
    <div aria-hidden="true" className="motion-safe:animate-pulse">
      <div className="h-7 w-2/5 max-w-72 rounded-mark bg-bg-sunk" />
      <div className="mt-3 h-3 w-3/5 max-w-96 rounded-mark bg-bg-sunk" />
      <div className="mt-3 h-3 w-24 rounded-mark bg-bg-sunk" />
      <Card className="mt-6">
        {document && <CardHeader><div className="h-5 w-16 rounded-mark bg-bg-sunk" /></CardHeader>}
        <CardContent className={document ? "" : "pt-5"}>
          <div className="h-4 w-4/5 rounded-mark bg-bg-sunk" />
          <div className="mt-3 h-4 w-full rounded-mark bg-bg-sunk" />
          <div className="mt-3 h-4 w-2/3 rounded-mark bg-bg-sunk" />
        </CardContent>
      </Card>
    </div>
  </div>;
}
