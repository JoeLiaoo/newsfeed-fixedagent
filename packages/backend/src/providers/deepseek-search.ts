// Public web search and page fetch. Every billable request is recorded through receipts; the
// membership expert applies a stricter per-task call cap before reaching these primitives.
import { credential, config } from "../config.ts";
import { guardedFetch, type GuardedFetchOptions } from "../lib/http-fetch.ts";
import { assertPublicUrl } from "../lib/url.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { assertAccepted, paidRequest, ProviderRejectedError, type CallOutcome } from "./receipts.ts";

export type PublicSearchSource = {
  id: string;
  queryGroup: "peers" | "stage" | "capital" | "us";
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  date: string | null;
  siteName: string;
};
export type PublicSearchResearch = { sources: PublicSearchSource[]; gaps: string[] };

export class PublicSearchUnavailableError extends Error {
  readonly reason: "disabled" | "key_missing";
  constructor(reason: "disabled" | "key_missing") { super(reason); this.reason = reason; }
}

export class PublicSearchResponseError extends Error {}
export class PublicSearchRequestRejectedError extends Error {}

function apiRoot() {
  return (credential("models", "DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com").replace(/\/+$/, "");
}

function apiKey() {
  return credential("models", "DEEPSEEK_API_KEY") ?? credential("models", "LLM_API_KEY");
}

async function sourceUrl(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    await assertPublicUrl(url.toString());
    return url.toString();
  } catch { return null; }
}

function str(value: unknown, max = 12_000): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

async function request(path: "search" | "fetch", payload: Record<string, unknown>, opts: {
  taskId: string; userId: string; purpose: string; identity: Record<string, unknown>;
}, fetcher: (url: string, options: GuardedFetchOptions) => ReturnType<typeof guardedFetch>) {
  if (!config.modelCallsEnabled) throw new PublicSearchUnavailableError("disabled");
  const key = apiKey();
  if (!key) throw new PublicSearchUnavailableError("key_missing");
  // Search and Fetch share the existing DeepSeek receipt budget and admin cost reporting; distinct
  // purposes keep them identifiable without a new service row or schema migration.
  const req = { service: "deepseek", model: null, purpose: opts.purpose,
    subject: `expert:sector-peer-landscape:${opts.taskId}`, memberUserId: opts.userId, memberTaskId: opts.taskId,
    identity: { ...opts.identity, taskId: opts.taskId }, requestSummary: { endpoint: path, identityHash: sha256(stableJson(opts.identity)) } };
  let receipt;
  try { receipt = await paidRequest(req, async (): Promise<CallOutcome> => {
    const res = await fetcher(`${apiRoot()}/v1/tools/${path}`, {
      method: "POST", route: "direct", timeoutMs: 60_000, maxBytes: 4 * 1024 * 1024,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const body = res.text();
    assertAccepted("deepseek", res.status, body);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = { __invalid_json: true }; }
    const billable = path === "search"
      ? Array.isArray((parsed as { results?: unknown[] } | null)?.results) && (parsed as { results: unknown[] }).results.length > 0
      : typeof (parsed as { content?: unknown } | null)?.content === "string" && !!(parsed as { content: string }).content.trim();
    const outcome = { response: parsed, requestId: res.headers.get("x-request-id"), usage: { responseBytes: res.body.length }, cost: { amount: billable ? 0.005 : 0, currency: "CNY", basis: "estimated" as const } };
    return outcome;
  }); } catch (error) {
    if (error instanceof ProviderRejectedError) throw new PublicSearchRequestRejectedError("Public search or fetch request was rejected");
    throw error;
  }
  if (!receipt.response || typeof receipt.response !== "object" || (receipt.response as { __invalid_json?: boolean }).__invalid_json) {
    throw new PublicSearchResponseError("Search service returned invalid JSON");
  }
  return receipt.response as Record<string, unknown>;
}

const QUERIES = [
  { group: "peers" as const, terms: "中国 同业 竞争格局 企业 lang:zh" },
  { group: "stage" as const, terms: "中国 产品 客户 产能 公告 lang:zh" },
  { group: "capital" as const, terms: "中国 人民币 融资 并购 IPO lang:zh" },
  { group: "us" as const, terms: "United States peers funding public companies" },
];

/** Four bounded searches and at most three page fetches; no pagination or model-generated browsing. */
export async function searchSectorPeerSources(input: { query: string; taskId: string; userId: string; beforeRequest?: () => Promise<void> }, fetcher = guardedFetch): Promise<PublicSearchResearch> {
  const sources: PublicSearchSource[] = [];
  const gaps: string[] = [];
  for (const spec of QUERIES) {
    await input.beforeRequest?.();
    const query = `${input.query.trim().slice(0, 80)} ${spec.terms}`.slice(0, 128);
    const response = await request("search", { query, count: 5, need_content: true }, {
      ...input, purpose: "expert_search", identity: { query, count: 5, need_content: true },
    }, fetcher);
    if (!Array.isArray(response.results)) throw new PublicSearchResponseError("Search response has no results array");
    let validResults = 0;
    for (const item of response.results.slice(0, 5)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const url = await sourceUrl(row.url);
      if (!url) continue;
      validResults += 1;
      const source: PublicSearchSource = {
        id: `S${sources.length + 1}`, queryGroup: spec.group,
        title: str(row.title, 500) || url, url, snippet: str(row.snippet, 1200),
        summary: str(row.summary, 2000), content: str(row.content, 4000),
        date: str(row.date, 80) || null, siteName: str(row.site_name, 200),
      };
      const prior = sources.find(existing => existing.url === source.url && existing.queryGroup === spec.group);
      if (prior) {
        prior.content ||= source.content;
        prior.summary ||= source.summary;
        prior.snippet ||= source.snippet;
        prior.date ||= source.date;
      } else sources.push(source);
    }
    if (validResults === 0) {
      const labels = { peers: "中国同业与竞争边界", stage: "产品、客户与产能信号", capital: "人民币融资、境内并购与 IPO", us: "美国参考" };
      gaps.push(`${labels[spec.group]}：未检索到带有效公开 URL 的结果。`);
    }
  }
  // Fetch up to three pages only when Search did not provide enough body text.
  const fetchTargets = sources.filter(source => source.content.length < 500 && source.url).slice(0, 3);
  for (const source of fetchTargets) {
    await input.beforeRequest?.();
    try {
      const response = await request("fetch", { url: source.url }, {
        ...input, purpose: "expert_fetch", identity: { url: source.url },
      }, fetcher);
      const content = str(response.content, 10_000);
      if (content) source.content = content;
      const title = str(response.title, 500);
      if (title) source.title = title;
      if (!content) gaps.push(`来源 ${source.id} 未返回可用网页正文；本项仅依据搜索摘要判断。`);
    } catch (error) {
      if (!(error instanceof PublicSearchRequestRejectedError || error instanceof PublicSearchResponseError)) throw error;
      gaps.push(`来源 ${source.id} 网页抓取失败；本项仅依据搜索摘要判断。`);
    }
  }
  return { sources, gaps };
}
