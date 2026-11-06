import { SITE } from "@aihot/site";

export const MEMBER_SESSION_COOKIE = "citic_member_session";

/**
 * 会话 Cookie 只在站点地址是 https 时加 Secure。
 * 内网 HTTP（例如 http://10.236.133.2）即使 NODE_ENV 是 production 也不加，否则浏览器会丢掉登录状态。
 */
export function sessionCookieIsSecure(siteUrl?: string): boolean {
  const raw = (siteUrl ?? process.env.SITE_URL ?? "").trim() || SITE.defaultUrl;
  return raw.replace(/\/+$/, "").toLowerCase().startsWith("https://");
}

/** 登录写入和退出清除共用这一段，Secure 的判断保持一致。 */
export function memberSessionCookie(token: string, maxAgeSeconds: number, siteUrl?: string): string {
  const secure = sessionCookieIsSecure(siteUrl) ? "; Secure" : "";
  return `${MEMBER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}
