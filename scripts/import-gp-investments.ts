// 把一份 GP 主体和已核实投资的 JSON 或 CSV 写入空库，或按稳定键更新。
// 不会编造投资：文件里没有的行不会出现。样例只在测试夹具里，不要把它导入中信环境。
//
// JSON / CSV 字段见 modules/membership/gp/dump.ts 文件头。
// 用法：
//   node --env-file-if-exists=.env scripts/import-gp-investments.ts --file dump.json --dry-run
//   node --env-file-if-exists=.env scripts/import-gp-investments.ts --file dump.csv
// source_url 留空时写入 https://example.org/gp-import/... 占位，员工页显示“演示/导入占位”。
// 需要一名已启用管理员：npm run member:bootstrap-admin
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { importSourceUrl, parseGpDump } from "../modules/membership/gp/dump.ts";
import { parseArgs } from "./lib/cli.ts";

const args = parseArgs(process.argv.slice(2));
if (args.has("help") || typeof args.get("file") !== "string") {
  console.log("用法：node --env-file-if-exists=.env scripts/import-gp-investments.ts --file <dump.json|dump.csv> [--dry-run]");
  process.exit(args.has("help") ? 0 : 1);
}
const file = args.get("file") as string;
const dump = parseGpDump(readFileSync(file, "utf8"), file);
const summary = {
  file,
  gps: dump.gps.length,
  investments: dump.investments.length,
  placeholders: dump.investments.filter((row) => importSourceUrl(row.investeeKey, row.sourceUrl).placeholder).length,
  dryRun: args.has("dry-run"),
};
console.log(JSON.stringify(summary, null, 2));
if (args.has("dry-run")) process.exit(0);

const { sql, closeDb } = await import("@aihot/backend/db");
try {
  const [admin] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE role='admin' AND status='active' ORDER BY created_at, id LIMIT 1`;
  if (!admin) throw new Error("需要先有一名已启用的管理员。请先运行 npm run member:bootstrap-admin。");
  await sql.begin(async (tx) => {
    const ids = new Map<string, string>();
    for (const gp of dump.gps) {
      const id = `gp-import-${createHash("sha256").update(gp.canonicalName).digest("hex").slice(0, 32)}`;
      const [row] = await tx<{ id: string }[]>`INSERT INTO member_gp_watchlist(
          id, canonical_name, aliases, entity_id, credit_code, entity_role, status, source_ref,
          project_groups, project_group_basis, reviewed_by, reviewed_at
        ) VALUES (
          ${id}, ${gp.canonicalName}, ${gp.aliases}, ${gp.entityId}, ${gp.creditCode}, 'gp', ${gp.status}, ${gp.sourceRef},
          ${gp.projectGroups}, ${gp.projectGroupBasis}, ${gp.status === "active" ? admin.id : null}, ${gp.status === "active" ? new Date() : null}
        )
        ON CONFLICT (canonical_name) DO UPDATE SET
          aliases = CASE WHEN cardinality(member_gp_watchlist.aliases) = 0 THEN EXCLUDED.aliases ELSE member_gp_watchlist.aliases END,
          entity_id = COALESCE(member_gp_watchlist.entity_id, EXCLUDED.entity_id),
          credit_code = COALESCE(member_gp_watchlist.credit_code, EXCLUDED.credit_code),
          source_ref = EXCLUDED.source_ref,
          status = CASE WHEN member_gp_watchlist.status = 'paused' THEN 'paused' ELSE EXCLUDED.status END,
          entity_role = CASE WHEN member_gp_watchlist.status = 'active' THEN member_gp_watchlist.entity_role ELSE 'gp' END,
          project_groups = ARRAY(SELECT DISTINCT unnest(member_gp_watchlist.project_groups || EXCLUDED.project_groups)),
          project_group_basis = CASE WHEN length(btrim(coalesce(member_gp_watchlist.project_group_basis, ''))) >= 8
            THEN member_gp_watchlist.project_group_basis ELSE EXCLUDED.project_group_basis END,
          reviewed_by = COALESCE(member_gp_watchlist.reviewed_by, EXCLUDED.reviewed_by),
          reviewed_at = COALESCE(member_gp_watchlist.reviewed_at, EXCLUDED.reviewed_at)
        RETURNING id`;
      ids.set(gp.canonicalName, row!.id);
    }
    for (const investment of dump.investments) {
      const gpId = ids.get(investment.gpName)!;
      const source = importSourceUrl(investment.investeeKey, investment.sourceUrl);
      const approvedAt = "2010-01-01T00:00:00.000Z";
      const investmentId = `inv-import-${createHash("sha256").update(`${investment.gpName}\0${investment.investeeKey}`).digest("hex").slice(0, 32)}`;
      await tx`INSERT INTO member_gp_investments(
          id, gp_id, investee_key, investee_name, raw_evidence, status, sector_tags, classification_state,
          approved_event_date, approved_source_url, approved_by, approved_at, mother_fund_name, subfund_name, project_province
        ) VALUES (
          ${investmentId}, ${gpId}, ${investment.investeeKey}, ${investment.investeeName},
          ${tx.json({ source: "gp-dump-import", placeholder: source.placeholder })}, 'verified', ${investment.sectorTags}, 'reviewed',
          ${investment.eventDate}::date, ${source.url}, ${admin.id}, ${approvedAt},
          ${investment.motherFundName}, ${investment.subfundName}, ${investment.projectProvince}
        )
        ON CONFLICT (gp_id, investee_key) DO UPDATE SET
          investee_name = EXCLUDED.investee_name,
          sector_tags = EXCLUDED.sector_tags,
          status = 'verified',
          classification_state = 'reviewed',
          approved_event_date = EXCLUDED.approved_event_date,
          approved_source_url = EXCLUDED.approved_source_url,
          approved_at = COALESCE(member_gp_investments.approved_at, EXCLUDED.approved_at),
          mother_fund_name = EXCLUDED.mother_fund_name,
          subfund_name = EXCLUDED.subfund_name,
          project_province = EXCLUDED.project_province,
          raw_evidence = EXCLUDED.raw_evidence`;
    }
  });
  console.log(JSON.stringify({ wroteGps: dump.gps.length, wroteInvestments: dump.investments.length }));
} finally {
  await closeDb();
}
