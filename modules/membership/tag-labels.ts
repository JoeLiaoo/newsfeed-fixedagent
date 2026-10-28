import { ENTITIES } from "@aihot/backend/editorial/vocabulary";

/** Internal subject keys remain in stored tags for matching, but members see names. */
export const ENTITY_TAG_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITIES).map(([id, entity]) => [`entity:${id}`, entity.displayTag ?? entity.name]),
);

export function memberTagLabel(tag: string): string | null {
  if (!tag.startsWith("entity:")) return tag;
  return ENTITY_TAG_LABELS[tag] ?? null;
}

export function memberDisplayTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(memberTagLabel).filter((tag): tag is string => tag !== null))];
}
