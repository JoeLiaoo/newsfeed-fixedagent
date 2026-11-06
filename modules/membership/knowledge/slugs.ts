/** The base the library held before it had more than one. Every material and page that was
 *  published before the bases existed belongs to it. */
export const DEFAULT_BASE_ID = "shared";

/**
 * The key of a target inside a base. The default base keeps the keys its pages already carry; every
 * other base has a key space of its own, so two bases may hold a page about the same target without
 * taking each other's place.
 */
export function scopedTargetKey(baseId: string, targetKey: string): string {
  return baseId === DEFAULT_BASE_ID ? targetKey : `${baseId}|${targetKey}`;
}

/**
 * The slug of a page inside a base. As with the key, the default base keeps the slugs its pages
 * already carry; another base prefixes its own, so a page of one base is never the page of another.
 */
export function scopedSlug(baseId: string, wanted: string): string {
  return baseId === DEFAULT_BASE_ID ? wanted : `${baseId}-${wanted}`;
}

/** The slug a base's pages carry, with the base's own prefix taken off. */
export function baseSlugOf(slug: string, baseId: string): string {
  if (baseId === DEFAULT_BASE_ID) return slug;
  const prefix = `${baseId}-`;
  return slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
}
