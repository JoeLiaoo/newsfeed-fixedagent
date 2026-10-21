export function toggleTagGroup(current: readonly string[], tags: readonly string[], next: boolean): string[] {
  if (next) return [...new Set([...current, ...tags])];
  const group = new Set(tags);
  return current.filter(tag => !group.has(tag));
}
