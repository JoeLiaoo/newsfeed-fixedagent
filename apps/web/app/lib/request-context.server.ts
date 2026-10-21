import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<string>();

export function requestCookie() { return context.getStore() ?? ""; }
export function withRequestCookie<T>(cookie: string, run: () => T): T { return context.run(cookie, run); }
