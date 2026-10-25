// The experts the platform ships: their rows, their skill text and the status the employee catalog
// shows them under. The api seeds them when it serves the catalog, and the setup seeds them when a
// release is installed, so a database converges on the current catalog instead of keeping the rows an
// earlier release wrote.
//
// The seed is idempotent: every row is written again, and a row that already exists has its content
// and its status written back. A database that still carries an earlier status (the retired entry
// left at `coming_soon`, or the sector-peer card inserted before its status was settled) is corrected
// by the next seed instead of staying in the catalog under a badge that no longer matches the card.
import { sql } from "@aihot/backend/db";
import { BUILTIN_EXPERT, COMING_SOON_EXPERT, FRONTIER_PODCAST_EXPERT, HIDDEN_EXPERT_STATUS, PANORAMA_EXPERT, SECTOR_PEER_EXPERT } from "./catalog.ts";

export async function seedBuiltinExperts(): Promise<void> {
  // The one-layer expert keeps its row, its skill text and its worker, but the employee platform no
  // longer offers it: its status is `hidden`, so the catalog drops it and no new task starts on it.
  // The conflict branch writes the status back, so an already deployed `available` row flips on the
  // next seed.
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${BUILTIN_EXPERT.slug}, NULL, ${BUILTIN_EXPERT.name}, ${BUILTIN_EXPERT.description}, ${BUILTIN_EXPERT.version}, ${BUILTIN_EXPERT.skillMd}, ${sql.json({ tools: ["fuzzy_search_company_list", "get_company_profile", "get_direct_investment"] })}, ${HIDDEN_EXPERT_STATUS}, ${sql.array(BUILTIN_EXPERT.missingDependencies)}::text[])
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, version=EXCLUDED.version,
      skill_md=EXCLUDED.skill_md, manifest=EXCLUDED.manifest, status=EXCLUDED.status, missing_dependencies=EXCLUDED.missing_dependencies`;
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${PANORAMA_EXPERT.slug}, NULL, ${PANORAMA_EXPERT.name}, ${PANORAMA_EXPERT.description}, ${PANORAMA_EXPERT.version}, ${PANORAMA_EXPERT.skillMd}, ${sql.json({ tools: ["fuzzy_search_company_list", "get_company_profile", "get_direct_investment", "get_company_shareholder", "get_company_can_rev", "get_history_company_name", "get_company_annual_report_base_info", "get_company_annual_report_investment_info"] })}, 'available', ${sql.array(PANORAMA_EXPERT.missingDependencies)}::text[])
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, version=EXCLUDED.version,
      skill_md=EXCLUDED.skill_md, manifest=EXCLUDED.manifest, missing_dependencies=EXCLUDED.missing_dependencies`;
  // Retain the old row for historical tasks, but remove the entry from every employee catalog.
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${COMING_SOON_EXPERT.slug}, NULL, ${COMING_SOON_EXPERT.name}, ${COMING_SOON_EXPERT.description}, ${COMING_SOON_EXPERT.version}, ${COMING_SOON_EXPERT.skillMd}, ${sql.json({ tools: [] })}, ${HIDDEN_EXPERT_STATUS}, ${sql.array(COMING_SOON_EXPERT.missingDependencies)}::text[])
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, version=EXCLUDED.version,
      skill_md=EXCLUDED.skill_md, manifest=EXCLUDED.manifest, status=EXCLUDED.status, missing_dependencies=EXCLUDED.missing_dependencies`;
  // The sector-peer card is a platform entry: it is available by contract, so the conflict branch
  // writes the status back as well. A row an earlier release left at another status (the retired
  // `coming_soon` badge) is corrected here, so the catalog shows the card as runnable and the task
  // endpoint does not refuse it as a coming-soon entry.
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${SECTOR_PEER_EXPERT.slug}, NULL, ${SECTOR_PEER_EXPERT.name}, ${SECTOR_PEER_EXPERT.description}, ${SECTOR_PEER_EXPERT.version}, ${SECTOR_PEER_EXPERT.skillMd}, ${sql.json({ tools: [] })}, 'available', ${sql.array(SECTOR_PEER_EXPERT.missingDependencies)}::text[])
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, version=EXCLUDED.version,
      skill_md=EXCLUDED.skill_md, manifest=EXCLUDED.manifest, status=EXCLUDED.status, missing_dependencies=EXCLUDED.missing_dependencies`;
  // The podcast expert is a platform entry too: it reads a public library over plain HTTP, so it
  // declares no tool and is available by contract. The conflict branch writes the status back, so a
  // row an earlier release left at another status is corrected instead of staying wrong in the catalog.
  await sql`INSERT INTO member_experts(slug, owner_id, name, description, version, skill_md, manifest, status, missing_dependencies)
    VALUES (${FRONTIER_PODCAST_EXPERT.slug}, NULL, ${FRONTIER_PODCAST_EXPERT.name}, ${FRONTIER_PODCAST_EXPERT.description}, ${FRONTIER_PODCAST_EXPERT.version}, ${FRONTIER_PODCAST_EXPERT.skillMd}, ${sql.json({ tools: [] })}, 'available', ${sql.array(FRONTIER_PODCAST_EXPERT.missingDependencies)}::text[])
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, version=EXCLUDED.version,
      skill_md=EXCLUDED.skill_md, manifest=EXCLUDED.manifest, status=EXCLUDED.status, missing_dependencies=EXCLUDED.missing_dependencies`;
}
