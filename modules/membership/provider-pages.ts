export type ProviderPage<Row> = { rows: Row[]; total: number | null; hasMore: boolean | null; nextOffset?: number | null };

export type ProviderPageCollection<Row> = {
  rows: Row[];
  rawRows: Row[];
  total: number | null;
  fetched: number;
  complete: boolean;
  reason: "complete" | "empty_before_end" | "repeated_page" | "duplicate_rows" | "missing_identity" | "total_changed" | "count_mismatch" | "page_limit" | "no_completion_signal" | "invalid_next_offset";
};

/**
 * Shared, conservative pagination for provider inventories. A baseline advances only when a provider
 * completion signal, stable identities, and any declared total all agree.
 */
export async function collectProviderPages<Row>(options: {
  pageSize: number;
  maxPages: number;
  identity: (row: Row) => string | null;
  fetchPage: (offset: number, limit: number) => Promise<ProviderPage<Row>>;
}): Promise<ProviderPageCollection<Row>> {
  const unique = new Map<string, Row>();
  const rowsWithoutIdentity: Row[] = [];
  const rawRows: Row[] = [];
  const pageFingerprints = new Set<string>();
  let total: number | null = null;
  let fetched = 0;
  let nextOffset = 0;
  let sawDuplicate = false;
  let sawMissingIdentity = false;

  for (let pageNumber = 0; pageNumber < options.maxPages; pageNumber++) {
    const requestedOffset = nextOffset;
    const page = await options.fetchPage(requestedOffset, options.pageSize);
    rawRows.push(...page.rows);
    fetched += page.rows.length;
    if (page.total !== null) {
      if (total !== null && total !== page.total) return result("total_changed");
      total = page.total;
    }

    const pageIds: string[] = [];
    let pageHasMissingIdentity = false;
    for (const row of page.rows) {
      const id = options.identity(row);
      if (!id) {
        sawMissingIdentity = true;
        pageHasMissingIdentity = true;
        rowsWithoutIdentity.push(row);
        continue;
      }
      pageIds.push(id);
      if (unique.has(id)) sawDuplicate = true;
      else unique.set(id, row);
    }
    pageIds.sort();
    if (pageIds.length) {
      const fingerprint = pageIds.join("\n");
      if (pageFingerprints.has(fingerprint)) return result("repeated_page");
      pageFingerprints.add(fingerprint);
    }
    if (page.rows.length === 0) {
      if (total === 0 && page.hasMore !== true) return result("complete", true);
      return result("empty_before_end");
    }

    const count = unique.size + rowsWithoutIdentity.length;
    if (page.hasMore === false) {
      if (total !== null && (fetched !== total || count !== total)) return result("count_mismatch");
      if (sawMissingIdentity) return result("missing_identity");
      if (sawDuplicate) return result("duplicate_rows");
      return result("complete", true);
    }
    if (page.hasMore === true && total !== null && fetched >= total) return result("count_mismatch");
    if (page.hasMore === null && total !== null && fetched >= total) {
      if (fetched !== total || count !== total) return result("count_mismatch");
      if (sawMissingIdentity) return result("missing_identity");
      if (sawDuplicate) return result("duplicate_rows");
      return result("complete", true);
    }
    if (page.hasMore === null && total === null && page.rows.length < options.pageSize) return result("no_completion_signal");
    if (page.hasMore === true) {
      if (page.nextOffset !== undefined) {
        if (page.nextOffset === null || !Number.isSafeInteger(page.nextOffset) || page.nextOffset <= requestedOffset) return result("invalid_next_offset");
        nextOffset = page.nextOffset;
      } else nextOffset = requestedOffset + options.pageSize;
    }
    if (pageNumber === options.maxPages - 1) return result("page_limit");
  }
  return result("page_limit");

  function result(reason: ProviderPageCollection<Row>["reason"], complete = false): ProviderPageCollection<Row> {
    return { rows: [...unique.values(), ...rowsWithoutIdentity], rawRows, total, fetched, complete, reason };
  }
}

/** Provider inventory rows need a stable identity; names alone are not sufficient for a baseline. */
export function investmentRowIdentity(row: Record<string, unknown>): string | null {
  for (const key of ["record_id", "investment_id", "investee_id", "company_id", "comp_id_iwudao", "comp_id", "credit_code", "unified_social_credit_code"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return `${key}:${value.trim()}`;
    if (typeof value === "number" && Number.isFinite(value)) return `${key}:${value}`;
  }
  return null;
}
