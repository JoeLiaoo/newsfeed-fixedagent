import { extractText, getDocumentProxy } from "unpdf";

export type ListedIssuer = { code: string; name: string; region: string };
export type ListedFundInput = { region: string; startDate: string; endDate: string; stockCodes: string[]; maxIssuers: number; maxAnnouncements: number; maxPdfExtracts: number };
export type ListedAnnouncement = { issuer: ListedIssuer; title: string; date: string | null; url: string; announcementId: string; text: string | null };
export type FundRegistration = { fundName: string; registrationNumber: string | null; managerName: string | null; status: string | null };
export type ParticipationRow = { issuer: ListedIssuer; fundName: string; registrationNumber: string | null; managerName: string | null; role: string | null; subscribedAmount: string | null; paidAmount: string | null; disclosureDate: string | null; announcementTitle: string; announcementUrl: string; reason: string };
export type ListedFundReport = { region: string; startDate: string; endDate: string; issuers: ListedIssuer[]; announcements: Array<{ issuer: ListedIssuer; date: string | null; title: string; url: string; note: string }>; rows: ParticipationRow[]; issuerHeat: Array<{ issuer: ListedIssuer; count: number }>; managerHeat: Array<{ manager: string; count: number }>; coInvestFunds: Array<{ fundName: string; issuerCount: number; issuers: string[] }>; identityVerification: { verified: string[]; pending: string[] }; gaps: string[]; budgets: { maxIssuers: number; maxAnnouncements: number; maxPdfExtracts: number; issuersRead: number; announcementsRead: number; pdfsRead: number; truncated: boolean }; generatedAt: string };

/** Small, explicitly incomplete seed sample. Its source and snapshot date are printed in every report. */
export const LISTED_ISSUER_SEED_SOURCE = "交易所上市公司资料与公司公开简介人工整理，平台样本快照 2026-10-26；不是完整地区名录";
export const LISTED_ISSUER_SEEDS: ListedIssuer[] = [
  { code: "600120", name: "浙江东方集团股份有限公司", region: "杭州市" },
  { code: "600126", name: "杭州钢铁股份有限公司", region: "杭州市" },
  { code: "600704", name: "物产中大集团股份有限公司", region: "杭州市" },
  { code: "600797", name: "浙大网新科技股份有限公司", region: "杭州市" },
  { code: "600177", name: "雅戈尔集团股份有限公司", region: "宁波市" },
];

export const LISTED_FUND_DEFAULT_BUDGET = { maxIssuers: 40, maxAnnouncements: 200, maxPdfExtracts: 80 } as const;
export const ANNOUNCEMENT_KEYWORDS = ["产业基金", "股权投资", "参与出资", "私募基金", "合作投资", "基金合伙", "合伙企业"] as const;
const asText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const norm = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}（）()【】]/gu, "");
let lastExternalRequestAt = 0;
let externalRequestQueue: Promise<void> = Promise.resolve();
async function reserveExternalSlot(fixture: boolean) {
  if (fixture) return () => undefined;
  let release!: () => void;
  const previous = externalRequestQueue;
  externalRequestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const wait = Math.max(0, 250 - (Date.now() - lastExternalRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastExternalRequestAt = Date.now();
  return release;
}
async function externalRequest(fetcher: typeof fetch, url: URL | string, init: RequestInit, fixture: boolean, timeoutMs = 12_000): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const release = await reserveExternalSlot(fixture);
    try {
      const response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      if (response.status >= 500 && attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 200)); continue; }
      return response;
    } catch (error) {
      lastError = error;
    } finally { release(); }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError instanceof Error ? lastError : new Error("listed_fund_request_failed");
}
async function jsonResponse(response: Response, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error("listed_fund_response_too_large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("listed_fund_response_too_large");
  return JSON.parse(text) as unknown;
}
const safeDate = (value: unknown): string | null => {
  const raw = asText(value);
  const match = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
};

export function parseListedFundInput(input: Record<string, unknown>, now = new Date()): ListedFundInput {
  const region = asText(input.region).replace(/[\s　]+/g, "");
  if (region.length < 2 || region.length > 40) throw new Error("listed_fund_region_invalid");
  const rawYear = input.year === undefined || input.year === null ? "" : String(input.year).trim();
  const yearValue = Number(rawYear);
  if (rawYear && (!Number.isInteger(yearValue) || yearValue < 1990 || yearValue > now.getUTCFullYear())) throw new Error("listed_fund_year_invalid");
  const year = Number.isInteger(yearValue) && yearValue >= 1990 && yearValue <= now.getUTCFullYear() ? yearValue : null;
  const defaultEnd = `${now.getUTCFullYear()}-12-31`;
  const defaultStart = `${now.getUTCFullYear() - 2}-01-01`;
  const startDate = asText(input.startDate) || (year ? `${year}-01-01` : defaultStart);
  const endDate = asText(input.endDate) || (year ? `${year}-12-31` : defaultEnd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate || !safeDate(startDate) || !safeDate(endDate)) throw new Error("listed_fund_date_range_invalid");
  const rawCodes = input.stockCodes;
  const stockCodes = Array.isArray(rawCodes) ? rawCodes.map((value) => String(value).trim()).filter(Boolean) : typeof rawCodes === "string" ? rawCodes.split(/[\s,，;；]+/).filter(Boolean) : [];
  if (stockCodes.some((code) => !/^\d{6}$/.test(code))) throw new Error("listed_fund_stock_code_invalid");
  if (new Set(stockCodes).size !== stockCodes.length) throw new Error("listed_fund_stock_code_duplicate");
  const budget = (key: keyof typeof LISTED_FUND_DEFAULT_BUDGET) => {
    const value = Number(input[key]);
    return Number.isInteger(value) && value > 0 ? Math.min(value, LISTED_FUND_DEFAULT_BUDGET[key]) : LISTED_FUND_DEFAULT_BUDGET[key];
  };
  return { region, startDate, endDate, stockCodes, maxIssuers: budget("maxIssuers"), maxAnnouncements: budget("maxAnnouncements"), maxPdfExtracts: budget("maxPdfExtracts") };
}

export function resolveListedIssuers(input: ListedFundInput, seeds = LISTED_ISSUER_SEEDS): { issuers: ListedIssuer[]; gaps: string[] } {
  if (input.stockCodes.length) {
    const seedByCode = new Map(seeds.map((issuer) => [issuer.code, issuer]));
    const issuers = input.stockCodes.slice(0, input.maxIssuers).map((code) => seedByCode.get(code) ?? { code, name: "发行人名称未提供", region: input.region });
    const gaps = issuers.filter((issuer) => issuer.name === "发行人名称未提供").map((issuer) => `${issuer.code} 不在平台静态样本中，发行人名称及地区归属未核。`);
    for (const issuer of issuers) {
      if (issuer.name !== "发行人名称未提供" && norm(input.region) !== norm("浙江省") && norm(input.region) !== norm(issuer.region)) gaps.push(`${issuer.code} 的样本地区为「${issuer.region}」，与输入地区「${input.region}」不一致，地区待核。`);
    }
    if (input.stockCodes.length > input.maxIssuers) gaps.push(`证券代码共 ${input.stockCodes.length} 个，按发行人上限 ${input.maxIssuers} 个执行；其余未查询。`);
    return { issuers, gaps };
  }
  const regionKey = norm(input.region);
  const match = (issuer: ListedIssuer) => norm(issuer.region) === regionKey || (regionKey === norm("浙江省") && ["杭州市", "宁波市"].includes(issuer.region));
  const candidates = seeds.filter(match);
  return { issuers: candidates.slice(0, input.maxIssuers), gaps: candidates.length ? [] : [`平台地区代码样本中没有「${input.region}」发行人；请补充证券代码或由管理员扩充样本。`] };
}

function announcementDate(item: Record<string, unknown>) { return safeDate(item.notice_date ?? item.noticeDate ?? item.announcementTime ?? item.date); }
function eastmoneyPdfUrl(item: Record<string, unknown>, artCode: string) {
  const attachUrl = asText(item.attach_url ?? item.attachUrl ?? item.adjunct_url ?? item.pdf_url ?? item.pdfUrl);
  if (attachUrl) {
    try {
      const parsed = new URL(attachUrl, "https://pdf.dfcfw.com");
      if (parsed.protocol === "https:" && parsed.hostname === "pdf.dfcfw.com" && parsed.pathname.toLowerCase().endsWith(".pdf")) return parsed.toString();
    } catch { /* use the stable public PDF route below */ }
  }
  return /^[\w-]+$/.test(artCode) ? `https://pdf.dfcfw.com/pdf/H2_${artCode}_1.pdf` : "";
}
const inDateRange = (date: string | null, input: ListedFundInput) => Boolean(date && date >= input.startDate && date <= input.endDate);
const hasAnnouncementKeyword = (title: string) => ANNOUNCEMENT_KEYWORDS.some((keyword) => title.includes(keyword));

/** Public per-issuer disclosure adapter. Default tests inject fixtures and never use live HTTP. */
export async function fetchIssuerAnnouncements(issuer: ListedIssuer, input: ListedFundInput, deps: { fetch?: typeof fetch; beforeRequest?: () => Promise<void> } = {}): Promise<{ items: ListedAnnouncement[]; gaps: string[] }> {
  const fetcher = deps.fetch ?? fetch;
  const items: ListedAnnouncement[] = [];
  const gaps: string[] = [];
  let pageIndex = 1;
  let totalPages = 1;
  while (pageIndex <= totalPages && pageIndex <= 500) {
    await deps.beforeRequest?.();
    const url = new URL("https://np-anotice-stock.eastmoney.com/api/security/ann");
    url.searchParams.set("sr", "-1");
    url.searchParams.set("page_size", "30");
    url.searchParams.set("page_index", String(pageIndex));
    url.searchParams.set("ann_type", "A");
    url.searchParams.set("stock_list", issuer.code);
    url.searchParams.set("f_node", "0");
    url.searchParams.set("s_node", "0");
    let response: Response;
    try {
      response = await externalRequest(fetcher, url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ListedFundDisclosure/1.0)", accept: "application/json,text/plain,*/*" } }, Boolean(deps.fetch));
    } catch {
      gaps.push(`${issuer.code} 公告检索服务请求失败；未能读取披露列表。`);
      break;
    }
    if (!response.ok) { gaps.push(`${issuer.code} 公告检索服务返回 HTTP ${response.status}；未能读取披露列表。`); break; }
    let payload: { data?: { list?: unknown[]; total_pages?: unknown; total_count?: unknown } };
    try { payload = await jsonResponse(response) as typeof payload; }
    catch { gaps.push(`${issuer.code} 公告检索服务响应无法解析；未能读取披露列表。`); break; }
    const data = payload.data;
    if (!data || !Array.isArray(data.list)) { gaps.push(`${issuer.code} 公告检索服务返回的列表结构不可用；未能读取披露列表。`); break; }
    const rows = data.list;
    totalPages = Math.max(1, Math.min(500, Number(data.total_pages) || 1));
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const date = announcementDate(item);
      const title = asText(item公告Title(item));
      const announcementId = asText(item.art_code ?? item.announcementId ?? item.id);
      const pdfUrl = eastmoneyPdfUrl(item, announcementId);
      if (!title || !hasAnnouncementKeyword(title)) continue;
      if (!date) { gaps.push(`${issuer.code}《${title}》缺少可解析披露日期，日期范围待核。`); continue; }
      if (!inDateRange(date, input) || !announcementId || !pdfUrl) continue;
      items.push({ issuer, title, date, url: pdfUrl, announcementId, text: null });
    }
    if (!rows.length || pageIndex >= totalPages || items.length >= input.maxAnnouncements) break;
    pageIndex += 1;
  }
  if (!items.length && !gaps.length) gaps.push(`${issuer.code} 公告检索返回空列表或没有匹配报告期和关键词的公告；本次检索不能确认不存在相关披露。`);
  if (items.length >= input.maxAnnouncements) gaps.push(`公告达到上限 ${input.maxAnnouncements} 条；后续页面未读取。`);
  const unique = new Map<string, ListedAnnouncement>();
  for (const item of items) unique.set(`${item.issuer.code}:${item.announcementId}`, item);
  const sorted = [...unique.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.issuer.code.localeCompare(b.issuer.code));
  return { items: sorted.slice(0, input.maxAnnouncements), gaps };
}

function item公告Title(item: Record<string, unknown>) { return item.announcementTitle ?? item.title ?? item.announcementName; }

/** Extract disclosure body text from a PDF, with strict byte and character limits. */
export async function extractAnnouncementText(url: string, deps: { fetch?: typeof fetch; beforeRequest?: () => Promise<void> } = {}): Promise<string> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || !["static.cninfo.com.cn", "pdf.dfcfw.com"].includes(parsedUrl.hostname)) throw new Error("listed_fund_pdf_url_invalid");
  const fetcher = deps.fetch ?? fetch;
  await deps.beforeRequest?.();
  const response = await externalRequest(fetcher, url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ListedFundDisclosure/1.0)", accept: "application/pdf,*/*" } }, Boolean(deps.fetch), 20_000);
  if (!response.ok) throw new Error(`listed_fund_pdf_http_${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("pdf") && !url.toLowerCase().includes(".pdf")) throw new Error("listed_fund_pdf_type_invalid");
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > 15 * 1024 * 1024) throw new Error("listed_fund_pdf_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("listed_fund_pdf_too_large");
  const proxy = await getDocumentProxy(bytes);
  return (await extractText(proxy, { mergePages: true })).text.slice(0, 80_000);
}

/** Optional registered-fund master adapter; no endpoint means an explicit, non-fatal coverage gap. */
export async function lookupFundRegistrations(names: string[], deps: { endpoint?: string; fetch?: typeof fetch; beforeRequest?: () => Promise<void> } = {}): Promise<{ records: FundRegistration[]; gaps: string[] }> {
  if (!deps.endpoint) return { records: [], gaps: ["基金备案公示主数据未配置；本次不核实基金备案号、管理人或公示状态。"] };
  let endpoint: URL;
  try { endpoint = new URL(deps.endpoint); if (endpoint.protocol !== "https:" || endpoint.hostname !== "gs.amac.org.cn") throw new Error(); }
  catch { return { records: [], gaps: ["基金备案公示主数据地址配置无效。"] }; }
  const fetcher = deps.fetch ?? fetch;
  const records: FundRegistration[] = [];
  const gaps: string[] = [];
  for (const name of [...new Set(names)]) {
    await deps.beforeRequest?.();
    const url = new URL(endpoint);
    url.searchParams.set("name", name);
    try {
      const response = await externalRequest(fetcher, url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ListedFundDisclosure/1.0)", accept: "application/json" } }, Boolean(deps.fetch));
      if (!response.ok) { gaps.push(`「${name}」备案查询返回 HTTP ${response.status}。`); continue; }
      const payload = await jsonResponse(response) as { records?: unknown[]; items?: unknown[] } | unknown[];
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : Array.isArray(payload.items) ? payload.items : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const value = row as Record<string, unknown>;
        const fundName = asText(value.fundName ?? value.name ?? value.productName);
        if (fundName && norm(fundName) === norm(name)) records.push({ fundName, registrationNumber: asText(value.registrationNumber ?? value.fundCode ?? value.recordNumber) || null, managerName: asText(value.managerName ?? value.manager) || null, status: asText(value.status ?? value.fundStatus) || null });
      }
    } catch { gaps.push(`「${name}」备案查询失败或响应无法解析。`); }
  }
  return { records, gaps };
}

const ROLE = /有限合伙人|普通合伙人|基金管理人|管理人|投资人|出资人|认缴|实缴/;
const AMOUNT = /(?:人民币)?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(亿元|万元|元|万股|股)/;
const FUND_WORD = /(?:产业基金|股权投资基金|创业投资基金|投资基金|私募基金|基金合伙企业|合伙企业)/;
export function candidateFundNames(text: string): string[] {
  const matches = text.match(/[^，。；;\n]{2,100}(?:产业基金|股权投资基金|创业投资基金|投资基金|私募基金|基金合伙企业|合伙企业)/g) ?? [];
  return [...new Set(matches.map((value) => value.trim().replace(/^.*(?:参与|出资|投资于|认购|认缴|拟设立|共同设立)/, "").trim()).filter((value) => value.length >= 3 && value.length <= 80 && FUND_WORD.test(value)))];
}
export function extractParticipationRows(announcements: ListedAnnouncement[], registrations: FundRegistration[]): { rows: ParticipationRow[]; gaps: string[] } {
  const rows: ParticipationRow[] = [];
  const gaps: string[] = [];
  const byName = new Map(registrations.map((item) => [norm(item.fundName), item]));
  for (const announcement of announcements) {
    if (!announcement.text) { gaps.push(`${announcement.issuer.code}《${announcement.title}》正文未解析；仅保留公告元数据。`); continue; }
    const text = announcement.text.replace(/[\r\t]+/g, " ").replace(/\s+/g, " ");
    const names = candidateFundNames(text);
    if (!names.length && /基金|合伙/.test(text)) gaps.push(`${announcement.issuer.code}《${announcement.title}》提及基金但无法稳定提取基金名称或参与关系。`);
    for (const fundName of names.slice(0, 20)) {
      const start = Math.max(0, text.indexOf(fundName) - 220);
      const context = text.slice(start, Math.min(text.length, start + fundName.length + 320));
      const roleMatch = context.match(/(?:作为|担任|成为)?\s*(有限合伙人|普通合伙人|基金管理人|管理人|投资人|出资人)/);
      const amountMatch = context.match(AMOUNT);
      const registration = byName.get(norm(fundName));
      rows.push({ issuer: announcement.issuer, fundName, registrationNumber: registration?.registrationNumber ?? null, managerName: registration?.managerName ?? null, role: roleMatch?.[1] ?? null, subscribedAmount: /认缴/.test(context) ? amountMatch?.[0]?.trim() ?? null : null, paidAmount: /实缴/.test(context) ? amountMatch?.[0]?.trim() ?? null : null, disclosureDate: announcement.date, announcementTitle: announcement.title, announcementUrl: announcement.url, reason: "由公告正文规则提取，待人工核对" });
    }
  }
  const deduped = new Map<string, ParticipationRow>();
  for (const row of rows) deduped.set(`${row.issuer.code}|${norm(row.fundName)}|${row.disclosureDate}|${row.announcementUrl}`, row);
  return { rows: [...deduped.values()], gaps };
}

export function buildListedFundReport(input: ListedFundInput, issuers: ListedIssuer[], announcements: ListedAnnouncement[], registrations: FundRegistration[], gaps: string[], generatedAt = new Date().toISOString(), identityVerification: { verified: string[]; pending: string[] } = { verified: [], pending: [] }): ListedFundReport {
  const extracted = extractParticipationRows(announcements, registrations);
  const issuerCounts = new Map<string, { issuer: ListedIssuer; count: number }>();
  const managerCounts = new Map<string, number>();
  const fundIssuers = new Map<string, Map<string, string>>();
  for (const row of extracted.rows) {
    const issuer = issuerCounts.get(row.issuer.code) ?? { issuer: row.issuer, count: 0 };
    issuer.count += 1; issuerCounts.set(row.issuer.code, issuer);
    if (row.managerName) managerCounts.set(row.managerName, (managerCounts.get(row.managerName) ?? 0) + 1);
    const fund = fundIssuers.get(norm(row.fundName)) ?? new Map<string, string>();
    fund.set(row.issuer.code, `${row.issuer.name}（${row.issuer.code}）`); fundIssuers.set(norm(row.fundName), fund);
  }
  const fundLabels = new Map(extracted.rows.map((row) => [norm(row.fundName), row.fundName]));
  const announcementRows = announcements.map((item) => {
    const count = extracted.rows.filter((row) => row.announcementUrl === item.url).length;
    return { issuer: item.issuer, date: item.date, title: item.title, url: item.url, note: !item.text ? "正文未解析，仅保留公告元数据" : count ? `提取到 ${count} 条待核候选` : "正文已解析，规则未提取到稳定的参与明细；不代表不存在参与" };
  });
  return { region: input.region, startDate: input.startDate, endDate: input.endDate, issuers, announcements: announcementRows, rows: extracted.rows,
    issuerHeat: [...issuerCounts.values()].sort((a, b) => b.count - a.count || a.issuer.code.localeCompare(b.issuer.code)),
    managerHeat: [...managerCounts].map(([manager, count]) => ({ manager, count })).sort((a, b) => b.count - a.count || a.manager.localeCompare(b.manager)),
    coInvestFunds: [...fundIssuers].filter(([, members]) => members.size >= 2).map(([key, members]) => ({ fundName: fundLabels.get(key) ?? "未提供", issuerCount: members.size, issuers: [...members.values()].sort() })).sort((a, b) => b.issuerCount - a.issuerCount || a.fundName.localeCompare(b.fundName)),
    identityVerification,
    gaps: [...new Set([...gaps, ...extracted.gaps])], budgets: { maxIssuers: input.maxIssuers, maxAnnouncements: input.maxAnnouncements, maxPdfExtracts: input.maxPdfExtracts, issuersRead: issuers.length, announcementsRead: announcements.length, pdfsRead: announcements.filter((item) => item.text !== null).length, truncated: gaps.some((gap) => /达到上限|其余未查询/.test(gap)) }, generatedAt };
}

export function renderListedFundMarkdown(report: ListedFundReport): string {
  const rows = report.rows.map((row) => `| ${escapeMd(row.issuer.name)} | ${row.issuer.code} | ${escapeMd(row.fundName)} | ${escapeMd(row.registrationNumber ?? "未提供")} | ${escapeMd(row.managerName ?? "未提供")} | ${escapeMd(row.role ?? "未提供")} | ${escapeMd(row.subscribedAmount ?? "未提供")} | ${escapeMd(row.paidAmount ?? "未提供")} | ${row.disclosureDate ?? "未提供"} | [公告](${row.announcementUrl}) | ${escapeMd(row.reason)} |`).join("\n");
  const gaps = report.gaps.length ? report.gaps.map((gap) => `- ${escapeMd(gap)}`).join("\n") : "- 本次执行未记录到额外缺口；这不代表地区或市场范围完整。";
  const issuerHeat = report.issuerHeat.map((row) => `| ${escapeMd(row.issuer.name)} | ${row.issuer.code} | ${row.count} |`).join("\n") || "| — | — | 0 |";
  const managerHeat = report.managerHeat.map((row) => `| ${escapeMd(row.manager)} | ${row.count} |`).join("\n") || "| 未提供 | — |";
  const coInvest = report.coInvestFunds.map((row) => `| ${escapeMd(row.fundName)} | ${row.issuerCount} | ${escapeMd(row.issuers.join("、"))} |`).join("\n") || "| 本次无多家发行人共同参与的可复核基金 | — | — |";
  const announcementRows = report.announcements.map((item) => `| ${escapeMd(item.issuer.name)}（${item.issuer.code}） | ${item.date ?? "未提供"} | ${escapeMd(item.title)} | [公告来源](${item.url}) | ${escapeMd(item.note)} |`).join("\n") || "| — | — | 未检索到可用公告元数据 | — | 请查看公告检索缺口 |";
  const identity = `- 已核验主体：${report.identityVerification.verified.map(escapeMd).join("、") || "无"}\n- 待核主体：${report.identityVerification.pending.map(escapeMd).join("、") || "无"}`;
  return `# ${report.region}上市公司基金参与

> 覆盖范围：公开披露检索可得记录。不是全市场 LP 排名，也不是完整工商穿透。发行人范围来自有限代码样本或用户提供代码，不代表当地全部上市公司。

- 报告期：${report.startDate} 至 ${report.endDate}
- 生成时间：${report.generatedAt}
- 发行人样本：${report.issuers.map((issuer) => `${escapeMd(issuer.name)}（${issuer.code}）`).join("、") || "无"}
- 发行人样本来源：${LISTED_ISSUER_SEED_SOURCE}
- 基金备案来源：平台当前配置的基金备案公示查询能力；未配置或名称未精确命中时不认定备案状态。
- 查询预算：发行人 ${report.budgets.maxIssuers} 家、公告 ${report.budgets.maxAnnouncements} 条、PDF ${report.budgets.maxPdfExtracts} 份；实际读取 ${report.budgets.issuersRead} 家、${report.budgets.announcementsRead} 条、解析 ${report.budgets.pdfsRead} 份
- 结果状态：${report.budgets.truncated || report.gaps.length ? "不完整（存在核实缺口或预算截断）" : "本次范围内已完成检索；不代表全市场完整"}

## 主体身份核验

${identity}

## 参与明细

| 发行人 | 代码 | 基金 | 备案号 | 管理人 | 角色 | 认缴 | 实缴 | 披露日 | 公告 | 纳入说明 |
|---|---|---|---|---|---|---|---|---|---|---|
${rows || "| — | — | 本次未能提取可复核的参与明细 | 未提供 | 未提供 | 未提供 | 未提供 | 未提供 | 未提供 | — | 仍需检查公告和缺口 |"}

## 发行人参与热度

| 发行人 | 代码 | 披露记录数 |
|---|---|---|
${issuerHeat}

## 管理人参与热度

| 管理人 | 披露记录数 |
|---|---|
${managerHeat}

## 多家发行人共同参与

| 基金 | 发行人数 | 发行人 |
|---|---:|---|
${coInvest}

## 公告检索记录

| 发行人 | 披露日 | 公告 | 来源 | 解析状态 |
|---|---|---|---|---|
${announcementRows}

## 缺口与未核事项

${gaps}

## 口径说明

- 公告正文规则提取仅作候选明细，必须回到公告核对；没有解析成功的正文保留为缺口。
- 备案对齐仅接受基金名称规范化后的精确匹配；无命中不代表未备案。
- 角色、金额、备案号、管理人或日期缺失时保留“未提供”，不填零、不推断。
- 本报告不覆盖未披露的出资关系、未命中的公告、历史退出、基金底层资产或完整地区发行人名录。
`;
}

export function renderListedFundHtml(report: ListedFundReport): string {
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const rowHtml = report.rows.map((row) => `<tr><td>${esc(row.issuer.name)}<br><small>${row.issuer.code}</small></td><td>${esc(row.fundName)}</td><td>${esc(row.registrationNumber ?? "未提供")}</td><td>${esc(row.managerName ?? "未提供")}</td><td>${esc(row.role ?? "未提供")}</td><td>${esc(row.subscribedAmount ?? "未提供")}</td><td>${esc(row.paidAmount ?? "未提供")}</td><td>${esc(row.disclosureDate ?? "未提供")}</td><td><a href="${esc(row.announcementUrl)}" rel="noreferrer">公告来源</a></td></tr>`).join("");
  const issuerHeat = report.issuerHeat.map((row) => `<tr><td>${esc(row.issuer.name)}</td><td>${row.issuer.code}</td><td>${row.count}</td></tr>`).join("") || "<tr><td colspan=\"3\">暂无可复核记录</td></tr>";
  const managerHeat = report.managerHeat.map((row) => `<tr><td>${esc(row.manager)}</td><td>${row.count}</td></tr>`).join("") || "<tr><td colspan=\"2\">未提供</td></tr>";
  const coInvest = report.coInvestFunds.map((row) => `<tr><td>${esc(row.fundName)}</td><td>${row.issuerCount}</td><td>${esc(row.issuers.join("、"))}</td></tr>`).join("") || "<tr><td colspan=\"3\">本次没有提取到多家发行人共同参与的可复核基金。</td></tr>";
  const verifiedIdentities = report.identityVerification.verified.map(esc).join("、") || "无";
  const pendingIdentities = report.identityVerification.pending.map(esc).join("、") || "无";
  const announcementRows = report.announcements.map((item) => `<tr><td>${esc(item.issuer.name)}<br><small>${item.issuer.code}</small></td><td>${esc(item.date ?? "未提供")}</td><td>${esc(item.title)}</td><td><a href="${esc(item.url)}" rel="noreferrer">公告来源</a></td><td>${esc(item.note)}</td></tr>`).join("") || "<tr><td colspan=\"5\">未检索到可用公告元数据，请查看公告检索缺口。</td></tr>";
  const gaps = report.gaps.map((gap) => `<li>${esc(gap)}</li>`).join("") || "<li>本次执行未记录到额外缺口；这不代表地区或市场范围完整。</li>";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.region)}上市公司基金参与</title>
<style>body{margin:0;background:#f5f6f7;color:#222;font:15px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif}.wrap{max-width:1180px;margin:0 auto;padding:32px 20px}header,.panel{background:white;border:1px solid #e5e7eb;border-radius:14px;padding:24px;margin-bottom:16px}h1{margin:0 0 8px;font-size:26px}h2{margin:0 0 14px;font-size:19px}.notice{border-left:4px solid #b42318;background:#fff5f4;padding:12px 16px;margin-top:14px}.meta{color:#667085;font-size:13px}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:700px;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #eaecf0;padding:10px}th{color:#475467;background:#f9fafb}a{color:#9a3412}small{color:#667085}.gap li{margin:6px 0}footer{color:#667085;font-size:12px;margin:20px 2px}</style>
<main class="wrap"><header><p class="meta">披露驱动的基金参与分析 · ${report.startDate} 至 ${report.endDate}</p><h1>${esc(report.region)}上市公司基金参与</h1><p>发行人样本 ${report.budgets.issuersRead} 家 · 公告 ${report.budgets.announcementsRead} 条 · 可复核明细 ${report.rows.length} 条</p><div class="notice">覆盖公开披露检索可得记录，不是全市场 LP 排名或完整工商穿透。地区发行人样本有限，不代表当地全部上市公司。</div></header>
<section class="panel"><h2>主体身份核验</h2><p>已核验：${verifiedIdentities}</p><p>待核：${pendingIdentities}</p></section>
<section class="panel"><h2>参与明细</h2><div class="table"><table><thead><tr><th>发行人</th><th>基金</th><th>备案号</th><th>管理人</th><th>角色</th><th>认缴</th><th>实缴</th><th>披露日</th><th>来源</th></tr></thead><tbody>${rowHtml || "<tr><td colspan=\"9\">本次未能提取可复核明细；请查看缺口和公告。</td></tr>"}</tbody></table></div></section>
<section class="panel"><h2>发行人参与热度</h2><div class="table"><table><thead><tr><th>发行人</th><th>代码</th><th>记录数</th></tr></thead><tbody>${issuerHeat}</tbody></table></div></section>
<section class="panel"><h2>管理人参与热度</h2><div class="table"><table><thead><tr><th>管理人</th><th>记录数</th></tr></thead><tbody>${managerHeat}</tbody></table></div></section>
<section class="panel"><h2>多家发行人共同参与</h2><div class="table"><table><thead><tr><th>基金</th><th>发行人数</th><th>发行人</th></tr></thead><tbody>${coInvest}</tbody></table></div></section>
<section class="panel"><h2>公告检索记录</h2><div class="table"><table><thead><tr><th>发行人</th><th>披露日</th><th>公告</th><th>来源</th><th>解析状态</th></tr></thead><tbody>${announcementRows}</tbody></table></div></section>
<section class="panel"><h2>发行人范围与预算</h2><p>${esc(LISTED_ISSUER_SEED_SOURCE)}</p><p>基金备案来源：平台当前配置的基金备案公示查询能力；未配置或名称未精确命中时不认定备案状态。</p><p>预算：发行人 ${report.budgets.maxIssuers} 家、公告 ${report.budgets.maxAnnouncements} 条、PDF ${report.budgets.maxPdfExtracts} 份；解析 ${report.budgets.pdfsRead} 份。实际发行人：${report.issuers.map((issuer) => `${esc(issuer.name)}（${issuer.code}）`).join("、") || "无"}</p></section>
<section class="panel"><h2>缺口与未核事项</h2><ul class="gap">${gaps}</ul></section><footer>生成于 ${esc(report.generatedAt)} · Markdown 底稿与此页均仅供核验。</footer></main></html>`;
}

function escapeMd(value: string) { return value.replace(/[|\n\r]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\[/g, "\\[").replace(/\]/g, "\\]"); }
