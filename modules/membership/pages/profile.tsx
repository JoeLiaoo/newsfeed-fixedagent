import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { pageMeta } from "@aihot/web/lib/seo";
import { Alert } from "@aihot/web/components/member-ui/alert";
import { Button } from "@aihot/web/components/member-ui/button";

export const meta = () => pageMeta({ title: "个人资料", path: "/settings/profile", noindex: true });

type Member = { realName: string; username: string };

export default function ProfilePage() {
  const [member, setMember] = useState<Member | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/v1/membership/me", { cache: "no-store" })
      .then(async response => {
        if (response.status === 401) { location.href = "/login"; return; }
        if (!response.ok) throw new Error("profile_unavailable");
        const result = await response.json() as { user?: Member };
        if (!result.user) throw new Error("profile_unavailable");
        setMember(result.user);
      })
      .catch(() => setError(true));
  }, []);

  return <main className="mx-auto w-full max-w-2xl px-5 py-8">
    <Button asChild variant="ghost" size="sm"><Link to="/more"><ArrowLeft size={14} aria-hidden="true" />我的</Link></Button>
    <h1 className="mt-5 text-2xl font-semibold text-ink">个人资料</h1>
    {error && <Alert className="mt-5" variant="destructive">账号信息暂时不可用，请刷新重试。</Alert>}
    {member && <section className="mt-5 rounded-card border border-line bg-surface p-5" aria-label="当前登录账号">
      <p className="break-words text-lg font-medium text-ink">{member.realName}</p>
      <p className="mt-1 break-all text-sm text-ink-3">@{member.username}</p>
    </section>}
  </main>;
}
