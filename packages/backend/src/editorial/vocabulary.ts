// Tag normalization and company identity over the industry pack's vocabulary (industry/taxonomy.ts),
// which the topics (industry/topics.json) are built on.
import { CATEGORIES, CATEGORY_TAGS, ENTITIES, ENTITY_TAGS, PODCAST_SOURCE_TAG, RELEASE, TAG_SYNONYMS, TOPIC_TAGS } from "@aihot/industry/taxonomy";

export { CATEGORY_TAGS, ENTITIES, ENTITY_TAGS, ITEM_TYPES, TOPIC_TAGS } from "@aihot/industry/taxonomy";

const ALLOWED_TAGS = new Set<string>([...CATEGORY_TAGS, ...TOPIC_TAGS, ...ENTITY_TAGS]);

/**
 * Known tags only, synonyms mapped, duplicates dropped, at most six; the category tag goes first, and a
 * list without one gets the pack's last category tag (其他).
 */
export function normalizeTags(v: unknown, additionalTags: readonly string[] = []): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,，]/g) : [];
  const allowedTags = additionalTags.length ? new Set([...ALLOWED_TAGS, ...additionalTags]) : ALLOWED_TAGS;
  const tags: string[] = [];
  for (const x of raw) {
    const t = String(x ?? "").trim().replace(/^#/, "");
    const tag = TAG_SYNONYMS[t] ?? TAG_SYNONYMS[t.toLowerCase()] ?? t;
    if (tag && allowedTags.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  const isCategory = (t: string) => (CATEGORY_TAGS as readonly string[]).includes(t);
  const categoryIndex = tags.findIndex(isCategory);
  const category = categoryIndex >= 0 ? tags[categoryIndex]! : CATEGORY_TAGS[CATEGORY_TAGS.length - 1]!;
  return [category, ...tags.filter((t) => t !== category)].slice(0, 6);
}

/** The category boundaries the structure step reads, one line per category. */
export const CATEGORY_GUIDE = CATEGORIES.map((c) => `- ${c.key}（${c.label}）：${c.guide}`).join("\n");

const CATEGORY_TAG_SET = new Set<string>(CATEGORY_TAGS);

/**
 * Public category for one item. A source tagged 播客 is always tip, whatever the model or an override said.
 * tip on any other source is the old tutorial bucket and is published as opinion, so the 播客 chip stays podcast-only.
 * Topic tags such as 教程/实践 are left in place. Podcast items drop other category tags and keep 播客.
 * `feedCategorySql` in publication/items.ts must apply the same two branches to rows already stored.
 */
export function resolvePublishedCategory(category: string | null, tags: readonly string[], sourceTags: readonly string[] | undefined): { category: string | null; tags: string[] } {
  if (sourceTags?.includes(PODCAST_SOURCE_TAG)) {
    const rest = tags.filter((tag) => !CATEGORY_TAG_SET.has(tag));
    return { category: "tip", tags: [PODCAST_SOURCE_TAG, ...rest] };
  }
  if (category === "tip") return { category: "opinion", tags: [...tags] };
  return { category, tags: [...tags] };
}

/** The industry's headline launch (RELEASE): narrower than its category, which also holds prices and benchmarks. */
export const isRelease = (category: string | null, tags: readonly string[]) => RELEASE !== null && category === RELEASE.category && tags.includes(RELEASE.tag);

/** Every name the vocabulary knows a company by. */
export const entityNames = (e: (typeof ENTITIES)[string]) => [e.name, ...e.aliases, ...(e.orgNames ?? []), ...(e.otherNames ?? [])];

const key = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
/** Exact entity/alias only: mentions embedded in a sentence are not ownership. */
export function entityIdentity(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const normalized = key(value);
  const matches = Object.entries(ENTITIES).filter(([id, entity]) => [id, ...entityNames(entity)].some((alias) => key(alias) === normalized));
  return matches.length > 1 ? null : matches[0]?.[0] ?? null;
}
