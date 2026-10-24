export type EntityCandidate = {
  id: string;
  name: string;
  status: string | null;
  creditCode: string | null;
  address: string | null;
  startDate: string | null;
};

/**
 * The provider's time filter. Its tools read a mapped date field (the profile reads start_date, the
 * investment list capi_date) and without a window they use the rolling three years ending today, which
 * leaves out every subject registered earlier. A wide window asks for the whole record; records
 * without a date come last.
 */
export const XINHUA_ALL_TIME = { start: "1900-01-01", end: null, missing_policy: "include_missing_last" };

/** The legal forms a registered name is often written with; the provider matches the name without them too. */
const NAME_SUFFIXES = ["股份有限公司", "有限责任公司", "有限公司", "普通合伙企业", "合伙企业", "有限合伙"];

/**
 * Shorter forms of a typed name to try when the provider matched nothing: the parenthetical and the
 * legal form are the parts a name is often written with, and the provider matches what is left of it.
 */
export function relaxedCompanyKeywords(name: string): string[] {
  const trimmed = name.trim();
  const withoutParenthetical = trimmed.replace(/[（(][^）)]*[）)]\s*$/, "").trim();
  const variants: string[] = [];
  if (withoutParenthetical && withoutParenthetical !== trimmed) variants.push(withoutParenthetical);
  for (const suffix of NAME_SUFFIXES) {
    if (withoutParenthetical.endsWith(suffix) && withoutParenthetical.length - suffix.length >= 2) {
      variants.push(withoutParenthetical.slice(0, -suffix.length).trim());
    }
  }
  return [...new Set(variants.filter((variant) => variant.length >= 2))];
}

export type InvestmentEvidence = {
  id: string;
  name: string;
  pct: string | null;
  subscribed: string | null;
  date: string | null;
  source: string;
};

export type InvestmentPage = { rows: Record<string, unknown>[]; total: number | null; hasMore: boolean | null; nextOffset?: number | null };
export type XinhuaCall = (tool: "get_company_profile", args: Record<string, unknown>) => Promise<unknown>;

export function normalizeText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return null;
}

export function textField(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = normalizeText(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function parseObject(value: unknown): unknown {
  if (typeof value === "string") {
    try { return JSON.parse(value) as unknown; } catch { return value; }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (row.structuredContent !== undefined) return parseObject(row.structuredContent);
    if (Array.isArray(row.content)) {
      const texts = row.content.filter((part): part is { text: string } => !!part && typeof part === "object" && "text" in part && typeof part.text === "string").map(part => part.text);
      if (texts.length) {
        const parsed = parseObject(texts.join("\n"));
        if (parsed !== texts.join("\n")) return parsed;
      }
    }
  }
  return value;
}

export function extractObject(value: unknown): Record<string, unknown> {
  const parsed = parseObject(value);
  if (Array.isArray(parsed)) return { __rows: parsed };
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

export function findArrays(value: unknown, keys: string[]): Record<string, unknown>[][] {
  const parsed = parseObject(value);
  if (Array.isArray(parsed)) {
    const rows = parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
    return rows.length ? [rows] : [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const row = parsed as Record<string, unknown>;
  const matches: Record<string, unknown>[][] = [];
  for (const key of keys) {
    if (Array.isArray(row[key])) {
      const values = (row[key] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
      matches.push(values);
    }
  }
  if (matches.length) return matches;
  for (const child of Object.values(row)) matches.push(...findArrays(child, keys));
  return matches;
}

/** The keys the provider's candidate list is published under. */
const CANDIDATE_LIST_KEYS = ["results", "company_list", "company_info"];

/**
 * The provider's candidate list, and whether the answer carried one at all: an empty list is the
 * provider's answer, an answer without a list cannot be read as one.
 */
export function candidateSearchOutcome(raw: unknown): { present: boolean; rows: Record<string, unknown>[] } {
  const parsed = parseObject(raw);
  if (Array.isArray(parsed)) {
    const rows = parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
    return { present: true, rows };
  }
  if (!parsed || typeof parsed !== "object") return { present: false, rows: [] };
  const row = parsed as Record<string, unknown>;
  for (const key of CANDIDATE_LIST_KEYS) {
    if (Array.isArray(row[key])) {
      const rows = (row[key] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
      return { present: true, rows };
    }
  }
  // The provider wraps its answer (result, data); the list is looked up inside those objects.
  for (const child of Object.values(row)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const found = candidateSearchOutcome(child);
    if (found.present) return found;
  }
  return { present: false, rows: [] };
}

/** The candidate rows the provider returned, with the fields this adapter reads. */
export function mapCompanyCandidates(rows: Record<string, unknown>[], fallbackName: string): EntityCandidate[] {
  return rows.map(row => ({
    id: textField(row, "company_id", "comp_id_iwudao", "comp_id") ?? "",
    name: textField(row, "company_name", "comp_name", "name") ?? fallbackName,
    status: textField(row, "company_status_name", "company_status", "status"),
    creditCode: textField(row, "credit_code", "unified_social_credit_code"),
    address: textField(row, "address", "registered_address"),
    startDate: textField(row, "start_date", "establish_date"),
  }));
}

export function parseInvestmentPage(value: unknown, keys = ["direct_investment_info", "results", "items", "data"]): InvestmentPage {
  const root = extractObject(value);
  const groups = findArrays(root, keys);
  const rows = groups.flat();
  const findField = (candidate: unknown, names: string[]): unknown => {
    if (!candidate || typeof candidate !== "object") return undefined;
    if (Array.isArray(candidate)) {
      for (const item of candidate) { const found = findField(item, names); if (found !== undefined) return found; }
      return undefined;
    }
    const object = candidate as Record<string, unknown>;
    for (const name of names) if (object[name] !== undefined) return object[name];
    for (const child of Object.values(object)) { const found = findField(child, names); if (found !== undefined) return found; }
    return undefined;
  };
  const pagination = root.pagination && typeof root.pagination === "object" && !Array.isArray(root.pagination)
    ? root.pagination as Record<string, unknown>
    : {};
  // The live Xinhua contract uses pagination.count for this page's row count, not the full inventory.
  // Do not treat it as a total; that would stop a multi-page snapshot after page one.
  const totalRaw = root.total ?? root.total_count ?? root.totalCount
    ?? pagination.total ?? pagination.total_count ?? pagination.totalCount
    ?? findField(root, ["total", "total_count", "totalCount"]);
  const totalValue = typeof totalRaw === "number" ? totalRaw : typeof totalRaw === "string" ? Number(totalRaw) : NaN;
  const total = Number.isSafeInteger(totalValue) && totalValue >= 0 ? totalValue : null;
  const moreRaw = findField(root, ["has_more", "hasMore", "next_page", "nextPage"]);
  const nextOffsetRaw = pagination.next_offset;
  const hasMore = typeof moreRaw === "boolean" ? moreRaw
    : moreRaw !== undefined ? Boolean(moreRaw)
    : Object.hasOwn(pagination, "next_offset") ? nextOffsetRaw !== null && nextOffsetRaw !== undefined
    : null;
  const nextOffset = Object.hasOwn(pagination, "next_offset")
    ? typeof nextOffsetRaw === "number" && Number.isSafeInteger(nextOffsetRaw) && nextOffsetRaw >= 0
      ? nextOffsetRaw
      : nextOffsetRaw === null ? null : Number.NaN
    : undefined;
  return { rows, total, hasMore, nextOffset };
}

export function mapInvestmentEvidence(rows: Record<string, unknown>[], source: string, cap = 500): InvestmentEvidence[] {
  return rows.slice(0, cap).map((row, index) => ({
    id: `S${index + 1}`,
    name: textField(row, "company_name", "investee_name", "name") ?? "名称未提供",
    pct: textField(row, "stock_percent", "stock_proportion", "holding_ratio"),
    subscribed: textField(row, "should_capi", "should_capi_value", "should_capital", "subscribed_capital", "capital"),
    date: textField(row, "shoud_date", "should_date", "invest_date", "include_date", "establish_date"),
    source,
  }));
}

export function verifySelectedEntity(entity: EntityCandidate, profile: Record<string, unknown>): { ok: true } | { ok: false; reason: string } {
  const profileId = textField(profile, "company_id", "comp_id_iwudao", "comp_id", "id");
  const profileCode = textField(profile, "credit_code", "unified_social_credit_code");
  const profileName = textField(profile, "company_name", "comp_name", "name");
  if (profileId && profileId !== entity.id) return { ok: false, reason: "entity_id_mismatch" };
  if (entity.creditCode && profileCode && profileCode.toUpperCase() !== entity.creditCode.toUpperCase()) return { ok: false, reason: "entity_credit_code_mismatch" };
  if (!profileId && !entity.creditCode) return { ok: false, reason: "entity_identity_unverified" };
  if (!profileId && entity.creditCode && profileCode !== entity.creditCode) return { ok: false, reason: "entity_identity_unverified" };
  if (!profileName || profileName.trim() !== entity.name.trim()) return { ok: false, reason: "entity_name_mismatch" };
  return { ok: true };
}

export async function querySelectedCompanyProfile(call: XinhuaCall, entity: EntityCandidate) {
  let query = entity.creditCode?.trim() || entity.name;
  let queryType = entity.creditCode?.trim() ? "credit_code" : "company_name";
  // The profile is read over the whole record: the tool's own default window covers three years of
  // establishment dates and answers not_found for every subject registered before that.
  let profile = extractObject(await call("get_company_profile", { query, query_type: queryType, time: XINHUA_ALL_TIME }));
  // Some accounts resolve an exact legal name even when a supplied credit code has no current profile.
  // Always verify the returned ID/name/code before allowing it to seed an expert or GP query.
  if (profile.not_found && queryType === "credit_code") {
    query = entity.name;
    queryType = "company_name";
    profile = extractObject(await call("get_company_profile", { query, query_type: queryType, time: XINHUA_ALL_TIME }));
  }
  const identity = verifySelectedEntity(entity, profile);
  if (!identity.ok) throw new Error(identity.reason === "entity_identity_unverified" ? "xinhua_identity_unverified" : "xinhua_entity_mismatch");
  return { profile, query, queryType };
}
