import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";

export type DigestItem = {
  article_id: string;
  source_key: string;
  title: string;
  summary: string | null;
  url: string;
  tags: string[];
  source_name: string;
  published_at: Date | null;
  timeline_at: Date;
};

export type DailyDigest = {
  local_date: string;
  preference_version: number;
  window_start: Date;
  cutoff_at: Date;
  tags: string[];
  items: DigestItem[];
  generated_at: Date;
};

/**
 * The one user/day edition used by both the web page and notification channels. It snapshots the
 * preference version, source window, cutoff, and stable source keys in one database transaction.
 */
export async function getDailyDigest(userId: string, date: string, now = new Date()): Promise<DailyDigest | null> {
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const [account] = await tx<{ interests_version: number }[]>`SELECT interests_version FROM member_users WHERE id=${userId} FOR UPDATE`;
    if (!account) return null;
    if (date > beijingDate(now)) return null;

    if (date < beijingDate(now)) {
      const past = await tx<DailyDigest[]>`SELECT local_date::text AS local_date,preference_version,window_start,cutoff_at,tags,items,generated_at
        FROM member_daily_digests WHERE user_id=${userId} AND local_date=${date}::date
        ORDER BY preference_version DESC LIMIT 1`;
      return past[0] ?? null;
    }

    const existing = await tx<DailyDigest[]>`SELECT local_date::text AS local_date,preference_version,window_start,cutoff_at,tags,items,generated_at
      FROM member_daily_digests WHERE user_id=${userId} AND local_date=${date}::date AND preference_version=${account.interests_version}`;
    if (existing[0]) return existing[0];

    const tagRows = await tx<{ tag: string }[]>`SELECT tag FROM member_interest_tags WHERE user_id=${userId} ORDER BY tag`;
    const tags = tagRows.map(row => row.tag);
    const previous = await tx<{ cutoff_at: Date }[]>`SELECT cutoff_at FROM member_daily_digests
      WHERE user_id=${userId} AND local_date<${date}::date ORDER BY local_date DESC,preference_version DESC LIMIT 1`;
    const windowStart = previous[0]?.cutoff_at ?? beijingMidnight(date);
    const cutoff = now;
    const items = tags.length ? await tx<DigestItem[]>`
      SELECT DISTINCT ON (COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id))
        p.article_id,
        COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id) AS source_key,
        p.title,p.summary,p.url,p.tags,s.name AS source_name,p.published_at,p.timeline_at
      FROM publications p JOIN sources s ON s.id=p.source_id
      WHERE ${listedCondition(cutoff)} AND p.timeline_at>=${windowStart} AND p.timeline_at<${cutoff}
        AND EXISTS(SELECT 1 FROM member_interest_tags t WHERE t.user_id=${userId} AND t.tag=ANY(p.tags))
      ORDER BY COALESCE('story:'||p.story_id::text,'fact:'||p.fact_id::text,'article:'||p.article_id),p.timeline_at DESC
    ` : [];
    const snapshot = await tx<DailyDigest[]>`INSERT INTO member_daily_digests(user_id,local_date,preference_version,window_start,cutoff_at,tags,items)
      VALUES(${userId},${date}::date,${account.interests_version},${windowStart},${cutoff},${tx.array(tags)}::text[],${tx.json(items as never)})
      RETURNING local_date::text AS local_date,preference_version,window_start,cutoff_at,tags,items,generated_at`;
    return snapshot[0] ?? null;
  });
}
