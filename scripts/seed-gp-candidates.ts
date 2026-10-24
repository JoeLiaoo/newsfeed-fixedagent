// P3 candidate import; idempotent, deliberately never activates a watchlist entry.
import { sql, closeDb } from "@aihot/backend/db";

// The reference table identifies managers except where it explicitly says GP.
// These are candidate leads only; none are activated here.
const candidates = [
  [
    "candidate-001",
    "元禾璞华同芯（苏州）投资管理有限公司",
    "manager",
    ["元禾璞华同芯", "元禾璞华同芯投资管理"],
    "reference/母基金已投子基金管理人.md：南通产业链发展基金 / 江苏南通元禾璞华战新创业投资合伙企业；上交所债券募集说明书披露基金管理人为该公司"
  ],
  [
    "candidate-002",
    "中油昆仑（北京）私募基金管理有限公司",
    "manager",
    ["中油昆仑（北京）", "中油昆仑私募"],
    "reference/母基金已投子基金管理人.md：南通产业链发展基金 / 昆仑通州湾战新股权投资基金；天眼查标注"
  ],
  [
    "candidate-003",
    "上海孚腾私募基金管理有限公司",
    "manager",
    ["上海孚腾", "孚腾私募"],
    "reference/母基金已投子基金管理人.md：东莞产业链发展母基金 / 上海具身智创创业投资合伙企业；基金信息披露及中国基金报报道"
  ],
  [
    "candidate-004",
    "广东长石创业投资合伙企业（有限合伙）",
    "manager",
    ["广东长石创投", "广东长石"],
    "reference/母基金已投子基金管理人.md：东莞产业链发展母基金 / 四川长石创业投资合伙企业；深交所公告披露其为基金管理人"
  ],
  [
    "candidate-005",
    "前海琥珀永裕股权投资（深圳）合伙企业（有限合伙）",
    "gp",
    ["前海琥珀永裕", "琥珀永裕"],
    "reference/母基金已投子基金管理人.md：东莞产业链发展母基金 / 广州琥珀安云二期创业投资合伙企业；深信服公告披露其为普通合伙人，身份须管理员复核"
  ],
  [
    "candidate-006",
    "博原（上海）私募基金管理有限公司",
    "manager",
    ["博原上海", "博原私募"],
    "reference/母基金已投子基金管理人.md：东莞产业链发展母基金 / 无锡博原兴成创业投资合伙企业；无锡威孚公告披露管理人"
  ],
  [
    "candidate-007",
    "深圳风投侠基金管理企业（有限合伙）",
    "manager",
    ["风投侠", "深圳风投侠"],
    "reference/母基金已投子基金管理人.md：广西人工智能产业投资基金 / 上海天之际创业投资合伙企业；投资界报道披露其担任管理人"
  ],
  [
    "candidate-008",
    "西湖创新（杭州）私募基金管理有限公司",
    "manager",
    ["西湖创新", "西湖创新（杭州）"],
    "reference/母基金已投子基金管理人.md：广西人工智能产业投资基金 / 西湖创新（杭州）科创成果转化创业投资合伙企业；天眼查标注"
  ],
  [
    "candidate-009",
    "东莞市科创资本投资管理有限公司",
    "manager",
    ["东莞科创资本", "科创资本"],
    "reference/母基金已投子基金管理人.md：东莞产业链发展母基金 / 东莞科创建源集成电路股权投资基金；基金设立信息"
  ]
] as const;

try {
  for (const [id, name, role, aliases, source] of candidates) {
    await sql`INSERT INTO member_gp_watchlist(id,canonical_name,aliases,entity_role,source_ref)
      VALUES (${id},${name},${aliases},${role},${source})
      ON CONFLICT(canonical_name) DO UPDATE SET aliases=EXCLUDED.aliases,source_ref=EXCLUDED.source_ref,
        entity_role=CASE WHEN member_gp_watchlist.status='candidate' AND member_gp_watchlist.reviewed_by IS NULL
          AND NOT EXISTS(SELECT 1 FROM member_gp_snapshots WHERE gp_id=member_gp_watchlist.id)
          THEN EXCLUDED.entity_role ELSE member_gp_watchlist.entity_role END`;
  }
  console.log(JSON.stringify({ candidateCount: candidates.length, status: "imported_as_unverified" }));
} finally { await closeDb(); }
