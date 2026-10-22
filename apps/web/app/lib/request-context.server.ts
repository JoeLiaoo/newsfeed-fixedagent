import { AsyncLocalStorage } from "node:async_hooks";

// The HTTP server imports this source file while the React Router server build bundles its own
// copy. Both copies must use the same storage instance or route loaders lose the request cookie.
const contexts = globalThis as unknown as Record<symbol, AsyncLocalStorage<string> | undefined>;
const context = contexts[Symbol.for("aihot.web.requestCookie")] ??= new AsyncLocalStorage<string>();

export function requestCookie() { return context.getStore() ?? ""; }
export function withRequestCookie<T>(cookie: string, run: () => T): T { return context.run(cookie, run); }
