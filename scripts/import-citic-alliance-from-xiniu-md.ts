// 把烯牛抄录的中信金石、中信建投资本项目导入 citic-alliance。
// 用法：
//   node --env-file-if-exists=.env scripts/import-citic-alliance-from-xiniu-md.ts --dry-run
//   node --env-file-if-exists=.env scripts/import-citic-alliance-from-xiniu-md.ts --file uploads/nf-alliance-pages.zip
// 重复运行按机构 + 公司名更新同一行。没有 https 来源时写入 example.org 占位，员工页显示“演示/导入占位”。
// 审核时间固定为 2010-01-01，融资日期只写入事件日期。这样历史导入不会被当成新的当日投资去推送。
// 需要数据库里已有一名启用的管理员：npm run member:bootstrap-admin
import { readFileSync } from "node:fs";
import {
  ALLIANCE_GROUP_BASIS, allianceEntityId, allianceGpId, alliancePlaceholderUrl, allianceSourceRef, parseAllianceZip,
} from "../modules/membership/gp/alliance-xiniu.ts";
import type { AllianceInstitution } from "../modules/membership/gp/alliance.ts";
import { parseArgs } from "./lib/cli.ts";

const args = parseArgs(process.argv.slice(2));
if (args.has("help")) {
  console.log("用法：node --env-file-if-exists=.env scripts/import-citic-alliance-from-xiniu-md.ts [--file uploads/nf-alliance-pages.zip] [--dry-run]");
  process.exit(0);
}
const file = typeof args.get("file") === "string" ? args.get("file") as string : "uploads/nf-alliance-pages.zip";
const parsed = parseAllianceZip(readFileSync(file));
const byInstitution = new Map<AllianceInstitution, number>();
let missingDate = 0;
let unknownProvince = 0;
for (const project of parsed.projects) {
  byInstitution.set(project.institution, (byInstitution.get(project.institution) ?? 0) + 1);
  if (!project.eventDate) missingDate++;
  if (!project.projectProvince) unknownProvince++;
}
const summary = {
  file,
  files: parsed.files,
  skippedRows: parsed.skipped,
  projects: parsed.projects.length,
  institutions: Object.fromEntries(byInstitution),
  missingDate,
  unknownProvince,
  dryRun: args.has("dry-run"),
};
console.log(JSON.stringify(summary, null, 2));
if (args.has("dry-run")) process.exit(0);

const { sql, closeDb } = await import("@aihot/backend/db");
try {
  const [admin] = await sql<{ id: string }[]>`SELECT id FROM member_users WHERE role='admin' AND status='active' ORDER BY created_at, id LIMIT 1`;
  if (!admin) throw new Error("需要先有一名已启用的管理员。请先运行 npm run member:bootstrap-admin。");
  await sql.begin(async (tx) => {
    const gpIds = new Map<AllianceInstitution, string>();
    for (const institution of byInstitution.keys()) {
      const [gp] = await tx<{ id: string }[]>`INSERT INTO member_gp_watchlist(
          id, canonical_name, aliases, entity_id, entity_role, status, source_ref, project_groups, project_group_basis, reviewed_by, reviewed_at
        ) VALUES (
          ${allianceGpId(institution)}, ${institution}, ${[]}, ${allianceEntityId(institution)}, 'gp', 'active', ${allianceSourceRef(institution)},
          ${["citic-alliance"]}, ${ALLIANCE_GROUP_BASIS}, ${admin.id}, now()
        )
        ON CONFLICT (canonical_name) DO UPDATE SET
          entity_id = COALESCE(member_gp_watchlist.entity_id, EXCLUDED.entity_id),
          entity_role = CASE WHEN member_gp_watchlist.status = 'active' THEN member_gp_watchlist.entity_role ELSE 'gp' END,
          status = CASE WHEN member_gp_watchlist.status = 'paused' THEN member_gp_watchlist.status ELSE 'active' END,
          project_groups = ARRAY(SELECT DISTINCT unnest(member_gp_watchlist.project_groups || EXCLUDED.project_groups)),
          project_group_basis = CASE WHEN length(btrim(coalesce(member_gp_watchlist.project_group_basis, ''))) >= 8
            THEN member_gp_watchlist.project_group_basis ELSE EXCLUDED.project_group_basis END,
          reviewed_by = COALESCE(member_gp_watchlist.reviewed_by, EXCLUDED.reviewed_by),
          reviewed_at = COALESCE(member_gp_watchlist.reviewed_at, EXCLUDED.reviewed_at)
        RETURNING id`;
      gpIds.set(institution, gp!.id);
    }
    for (const project of parsed.projects) {
      const gpId = gpIds.get(project.institution)!;
      const approvedAt = "2010-01-01T00:00:00.000Z";
      const id = `inv-${project.institution === "中信金石" ? "js" : "jj"}-${project.investeeKey}`;
      await tx`INSERT INTO member_gp_investments(
          id, gp_id, investee_key, investee_name, raw_evidence, status, sector_tags, sector_reason, classification_state,
          approved_event_date, approved_source_url, approved_by, approved_at, mother_fund_name, subfund_name, project_province, province_source
        ) VALUES (
          ${id}, ${gpId}, ${project.investeeKey}, ${project.companyName}, ${tx.json({
            summary: project.summary, industry: project.industry, region: project.region, round: project.round,
            inferredRound: project.inferredRound, amount: project.amount, investors: project.investors, foundedOn: project.foundedOn,
            source: "xiniu-markdown-import",
          })}, 'verified', ${project.sectorTags}, ${`烯牛行业：${project.industry || "空白"}`}, 'reviewed',
          ${project.eventDate}::date, ${alliancePlaceholderUrl(project.institution, project.investeeKey)}, ${admin.id}, ${approvedAt},
          ${project.institution}, ${null}, ${project.projectProvince}, ${project.projectProvince ? "xiniu_region" : null}
        )
        ON CONFLICT (gp_id, investee_key) DO UPDATE SET
          investee_name = EXCLUDED.investee_name,
          raw_evidence = EXCLUDED.raw_evidence,
          status = 'verified',
          sector_tags = EXCLUDED.sector_tags,
          sector_reason = EXCLUDED.sector_reason,
          classification_state = 'reviewed',
          approved_event_date = EXCLUDED.approved_event_date,
          approved_source_url = EXCLUDED.approved_source_url,
          approved_by = COALESCE(member_gp_investments.approved_by, EXCLUDED.approved_by),
          approved_at = COALESCE(member_gp_investments.approved_at, EXCLUDED.approved_at),
          mother_fund_name = EXCLUDED.mother_fund_name,
          subfund_name = NULL,
          project_province = EXCLUDED.project_province,
          province_source = EXCLUDED.province_source`;
    }
  });
  console.log(JSON.stringify({ wrote: parsed.projects.length }));
} finally {
  await closeDb();
}
