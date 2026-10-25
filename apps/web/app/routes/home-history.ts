type DigestHistory = { date: string; preferenceVersion: number; itemCount: number };

/** The history API orders newest dates and highest preference versions first. */
export function oneDigestPerDay(history: DigestHistory[]): DigestHistory[] {
  const seen = new Set<string>();
  return history.filter(entry => {
    if (seen.has(entry.date)) return false;
    seen.add(entry.date);
    return true;
  });
}
