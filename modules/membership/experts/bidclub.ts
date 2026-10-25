// The public podcast library the 前沿播客 expert reads. Every route below is a plain GET against a
// public service: no account, no key, no configuration. The client runs on the server only, keeps
// its own timeouts and reads the fields the service actually returned — a field that is absent stays
// absent, and a summary that is not published stays missing rather than being written out.

/** The public API root. Fixed on purpose: the service needs no credentials, so there is nothing to configure. */
export const PODCAST_API_BASE = "https://bidclub.ai";

/** How many episodes are read at the same time. The library asks for modest parallelism. */
export const PODCAST_FETCH_CONCURRENCY = 3;
/** The search's own limits: the query is 2–100 characters. */
export const PODCAST_QUERY_MIN = 2;
export const PODCAST_QUERY_MAX = 100;

const SEARCH_TIMEOUT_MS = 20_000;
const EPISODE_TIMEOUT_MS = 20_000;

export class PodcastSourceError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export type PodcastMatch = {
  slug: string;
  title: string | null;
  showName: string | null;
  date: string | null;
  publishedAt: string | null;
  durationMin: number | null;
  lang: string | null;
  dek: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
};

export type PodcastEpisode = PodcastMatch & {
  /** The points of the episode, in the editorial language the picker chose. */
  tldr: string | null;
  tldrLang: string | null;
  /** The episode summary, in the editorial language the picker chose. */
  digest: string | null;
  digestLang: string | null;
  /** The other language the record carries, when it has one. */
  altLang: string | null;
  /** The people the episode lists, as the library spells the names. */
  people: string[];
  /** The sector and focus tags, already named in Chinese. */
  sectors: string[];
  focus: string[];
};

/** High-confidence search aliases, available even when the model cannot expand a query. */
const BILINGUAL_TERMS: string[][] = [
  ["具身智能", "embodied intelligence", "robotics", "机器人", "embodied ai", "具身"],
  ["机器人", "robotics", "具身智能", "embodied intelligence", "robot", "具身"],
  ["宁德时代", "catl"],
  ["人工智能", "artificial intelligence"], ["半导体", "semiconductors"],
  ["大模型", "large language models", "llm"], ["自动驾驶", "autonomous driving"],
  ["生物技术", "biotechnology"], ["气候科技", "climate tech"],
];

export function podcastQueryVariants(query: string): string[] {
  const normalized = query.trim().toLocaleLowerCase();
  const preferredVariants: Record<string, string[]> = {
    "具身智能": ["embodied intelligence", "robotics"],
    "embodied intelligence": ["具身智能", "robotics"],
    "机器人": ["robotics", "具身智能"],
    robotics: ["机器人", "具身智能"],
  };
  if (preferredVariants[normalized]) return preferredVariants[normalized]!;
  const group = BILINGUAL_TERMS.find(terms => terms.some(term => term.toLocaleLowerCase() === normalized));
  return group ? group.filter(term => term.toLocaleLowerCase() !== normalized) : [];
}

function topicAliases(query: string, queries: string[]): string[] {
  const terms = [query, ...queries].map(term => term.trim().toLocaleLowerCase()).filter(Boolean);
  for (const group of BILINGUAL_TERMS) {
    if (group.some(term => terms.includes(term.toLocaleLowerCase()))) terms.push(...group.map(term => term.toLocaleLowerCase()));
  }
  return [...new Set(terms)];
}

/** Rank exact topic mentions above broad semantic/search matches while retaining every candidate. */
export function podcastMatchRelevance(match: PodcastMatch, query: string, queries: string[]): number {
  const aliases = topicAliases(query, queries);
  const title = (match.title ?? "").toLocaleLowerCase();
  const dek = (match.dek ?? "").toLocaleLowerCase();
  let score = 0;
  for (const alias of aliases) {
    const isOriginal = alias === query.trim().toLocaleLowerCase();
    if (title.includes(alias)) score = Math.max(score, isOriginal ? 110 : 100);
    else if (dek.includes(alias)) score = Math.max(score, isOriginal ? 30 : 20);
  }
  return score;
}

/** What one search answered. `partial` marks a fallback match over a window of recent episodes. */
export type PodcastSearchResult = {
  matches: PodcastMatch[];
  count: number;
  partial: boolean;
  searchedRecent: number | null;
};

export type PodcastClient = {
  search(query: string): Promise<PodcastSearchResult>;
  episode(slug: string): Promise<PodcastEpisode>;
};

export type PodcastClientOptions = {
  /** The API root; the tests point it at their own stub. */
  baseUrl?: string;
  /** The HTTP client; the tests hand it a stub instead of reaching the network. */
  fetchImpl?: typeof fetch;
};

/** The taxonomy the library publishes, named in Chinese so the employee reads a sector, not an id. */
const SECTOR_LABELS: Record<string, string> = {
  ai_software: "人工智能与软件",
  semis: "半导体",
  robotics: "机器人",
  biotech: "生物科技",
  consumer: "消费",
  finance: "金融",
  blockchain: "区块链",
  energy: "能源",
  space_defense: "航天与国防",
};
const FOCUS_LABELS: Record<string, string> = {
  investing: "投资",
  company_building: "公司建设",
  technical: "技术",
  macro: "宏观",
  policy: "政策",
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tags(value: unknown, labels: Record<string, string>): string[] {
  if (!Array.isArray(value)) return [];
  const named: string[] = [];
  for (const entry of value) {
    const id = text(entry);
    if (!id) continue;
    const label = labels[id];
    named.push(label ? `${label}` : id);
  }
  return named;
}

/** The people the episode lists: the library writes them as "person:名字". */
function people(chips: unknown): string[] {
  if (!Array.isArray(chips)) return [];
  const names: string[] = [];
  for (const chip of chips) {
    const value = text(chip);
    if (!value) continue;
    names.push(value.startsWith("person:") ? value.slice("person:".length) : value);
  }
  return names;
}

/**
 * The editorial text in the language the employee reads: Chinese first, because the library keeps a
 * Chinese edition of most episodes. When a record has no Chinese text, the language it does have is
 * returned with that language named, so nothing is presented as Chinese that is not.
 */
function pickEditorial(primary: string | null, primaryLang: string | null, alternate: string | null, alternateLang: string | null) {
  if (primaryLang === "ZH" && primary) return { text: primary, lang: "ZH" };
  if (alternateLang === "ZH" && alternate) return { text: alternate, lang: "ZH" };
  if (primary) return { text: primary, lang: primaryLang };
  if (alternate) return { text: alternate, lang: alternateLang };
  return { text: null, lang: null };
}

function toMatch(row: Record<string, unknown>): PodcastMatch | null {
  const slug = text(row.slug);
  if (!slug) return null;
  const shows = row.shows as { name?: unknown } | undefined;
  return {
    slug,
    title: text(row.title),
    showName: text(shows?.name) ?? text(row.show),
    date: text(row.date),
    publishedAt: text(row.published_at),
    durationMin: count(row.duration_min),
    lang: text(row.lang),
    dek: text(row.dek),
    sourceUrl: text(row.source_url),
    sourceLabel: text(row.source_label),
  };
}

function toEpisode(row: Record<string, unknown>): PodcastEpisode | null {
  const slug = text(row.slug);
  if (!slug) return null;
  const base = toMatch({ ...row, slug });
  if (!base) return null;
  const primaryLang = text(row.lang)?.toUpperCase() ?? null;
  const alternateLang = text(row.lang_alt)?.toUpperCase() ?? null;
  const tldr = pickEditorial(text(row.tldr_md), primaryLang, text(row.tldr_md_alt), alternateLang);
  const digest = pickEditorial(text(row.digest_md), primaryLang, text(row.digest_md_alt), alternateLang);
  return {
    ...base,
    tldr: tldr.text,
    tldrLang: tldr.lang,
    digest: digest.text,
    digestLang: digest.lang,
    altLang: alternateLang,
    people: people(row.chips),
    sectors: tags(row.tag_sectors, SECTOR_LABELS),
    focus: tags(row.tag_focus, FOCUS_LABELS),
  };
}

/** The download route for one episode's summary and points; the employee can open it directly. */
export function podcastSummaryUrl(baseUrl: string, slug: string) {
  return `${baseUrl.replace(/\/+$/, "")}/dl/${encodeURIComponent(slug)}/summary.md`;
}

/**
 * The client the worker uses. The HTTP client is looked up per request, so a test can replace the
 * global one; the base URL is fixed unless a caller says otherwise.
 */
export function createPodcastClient(options: PodcastClientOptions = {}): PodcastClient {
  const baseUrl = (options.baseUrl ?? PODCAST_API_BASE).replace(/\/+$/, "");
  const read = async (path: string, timeoutMs: number): Promise<Record<string, unknown>> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new PodcastSourceError(timedOut ? "podcast_source_timeout" : "podcast_source_unavailable");
    }
    if (response.status === 404) throw new PodcastSourceError("podcast_episode_missing");
    if (!response.ok) throw new PodcastSourceError("podcast_source_unavailable");
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new PodcastSourceError("podcast_response_invalid"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new PodcastSourceError("podcast_response_invalid");
    return payload as Record<string, unknown>;
  };
  return {
    async search(query: string): Promise<PodcastSearchResult> {
      const trimmed = query.trim();
      if (trimmed.length < PODCAST_QUERY_MIN) throw new PodcastSourceError("podcast_query_invalid");
      if (trimmed.length > PODCAST_QUERY_MAX) throw new PodcastSourceError("podcast_query_invalid");
      const payload = await read(`/api/v1/search?q=${encodeURIComponent(trimmed)}`, SEARCH_TIMEOUT_MS);
      const results = payload.results;
      if (!Array.isArray(results)) throw new PodcastSourceError("podcast_response_invalid");
      const matches = results.map((row) => (row && typeof row === "object" ? toMatch(row as Record<string, unknown>) : null)).filter((row): row is PodcastMatch => row !== null);
      return {
        matches,
        count: count(payload.count) ?? matches.length,
        partial: payload.partial === true,
        searchedRecent: count(payload.searched_recent),
      };
    },
    async episode(slug: string): Promise<PodcastEpisode> {
      const payload = await read(`/api/v1/episodes/${encodeURIComponent(slug)}`, EPISODE_TIMEOUT_MS);
      const episode = toEpisode(payload);
      if (!episode) throw new PodcastSourceError("podcast_response_invalid");
      return episode;
    },
  };
}

export type PodcastCollection = {
  episodes: PodcastEpisode[];
  /** The matches the search returned, whether or not their episode could be read. */
  matches: PodcastMatch[];
  partial: boolean;
  searchedRecent: number | null;
  count: number;
  /** How many of the chosen matches could not be read. */
  failed: number;
  /** Why an episode could not be read, when the reason is known; the report names it instead of blaming the topic. */
  failureCode: string | null;
  queries: string[];
  searchFailed: boolean;
  skippedWithoutChinese: number;
};

/**
 * Search both languages, then read every candidate with modest parallelism. A failed read does not stop the others;
 * its count travels with the result so the report can say so.
 */
export async function collectPodcastEpisodes(query: string, options: { client?: PodcastClient; expandQuery?: (query: string) => Promise<string[]> } = {}): Promise<PodcastCollection> {
  const client = options.client ?? createPodcastClient();
  const original = query.trim();
  if (original.length < PODCAST_QUERY_MIN || original.length > PODCAST_QUERY_MAX) throw new PodcastSourceError("podcast_query_invalid");
  const variants = podcastQueryVariants(original);
  if (!variants.length && options.expandQuery) variants.push(...await options.expandQuery(original));
  const queries = [...new Map([original, ...variants]
    .map(value => value.trim())
    .filter(value => value.length >= PODCAST_QUERY_MIN && value.length <= PODCAST_QUERY_MAX)
    .map(value => [value.toLocaleLowerCase(), value])).values()].slice(0, 3);
  const searches: { term: string; result: PodcastSearchResult }[] = [];
  let searchFailed = false;
  for (const term of queries) {
    try { searches.push({ term, result: await client.search(term) }); }
    catch (error) {
      if (term === original) throw error;
      searchFailed = true;
    }
  }
  const ordered: PodcastMatch[] = [];
  const seen = new Set<string>();
  const ranked = searches.map(({ term, result }) => {
    const preferred = /[\u3400-\u9fff]/u.test(term) ? "ZH" : "EN";
    return [
      ...result.matches.filter(match => match.lang?.toUpperCase() === preferred),
      ...result.matches.filter(match => match.lang?.toUpperCase() !== preferred),
    ];
  });
  const depth = Math.max(0, ...ranked.map(matches => matches.length));
  for (let index = 0; index < depth; index++) {
    for (const matches of ranked) {
      const match = matches[index];
      if (match && !seen.has(match.slug)) { seen.add(match.slug); ordered.push(match); }
    }
  }
  // Search results can rank broad AI mentions above episodes whose title names the requested topic.
  // Keep the library's order for ties and retain lower-scoring matches for recall.
  const relevance = new Map(ordered.map((match, index) => [match.slug, { score: podcastMatchRelevance(match, original, queries), index }]));
  ordered.sort((a, b) => {
    const left = relevance.get(a.slug)!;
    const right = relevance.get(b.slug)!;
    return right.score - left.score || left.index - right.index;
  });
  const episodes: PodcastEpisode[] = [];
  let failed = 0;
  let failureCode: string | null = null;
  let skippedWithoutChinese = 0;
  for (let start = 0; start < ordered.length;) {
    const batch = ordered.slice(start, start + PODCAST_FETCH_CONCURRENCY);
    start += batch.length;
    const read = await Promise.all(batch.map(async (match) => {
      try { return await client.episode(match.slug); }
      catch (error) {
        failureCode = error instanceof PodcastSourceError ? error.code : "podcast_source_unavailable";
        return null;
      }
    }));
    for (const episode of read) {
      if (!episode) { failed += 1; continue; }
      if (episode.lang?.toUpperCase() === "EN" && ((episode.tldr && episode.tldrLang !== "ZH") || (episode.digest && episode.digestLang !== "ZH") || (!episode.tldr && !episode.digest))) {
        skippedWithoutChinese += 1;
        continue;
      }
      episodes.push(episode);
    }
  }
  const windows = searches.map(search => search.result.searchedRecent).filter((value): value is number => value !== null);
  return { episodes, matches: ordered, partial: searches.some(search => search.result.partial) || searchFailed, searchedRecent: windows.length ? Math.min(...windows) : null, count: ordered.length, failed, failureCode, queries, searchFailed, skippedWithoutChinese };
}
