import { GP_TAGS } from "./core.ts";
import { PROVINCES } from "./province.ts";

/**
 * 已投 GP 导入文件。
 * JSON 形状：
 * {
 *   "gps": [{
 *     "canonical_name": "主体全称",
 *     "entity_id": "稳定实体编号",
 *     "source_ref": "至少 8 字的来源说明",
 *     "aliases": [],
 *     "credit_code": null,
 *     "status": "active",
 *     "project_groups": ["citic-alliance"],
 *     "project_group_basis": "分类时至少 8 字"
 *   }],
 *   "investments": [{
 *     "gp_name": "主体全称",
 *     "investee_key": "同一主体下的稳定键，重复导入会更新这一行",
 *     "investee_name": "被投企业",
 *     "sector_tags": ["人工智能"],
 *     "event_date": "2024-05-06",
 *     "source_url": null,
 *     "mother_fund_name": null,
 *     "subfund_name": null,
 *     "project_province": "浙江省"
 *   }]
 * }
 * CSV 是扁平行，表头用同样的字段名；主体列在每一行重复。没有 https 来源时写入方会标成导入占位，不会编造投资。
 */
export type GpDumpEntity = {
  canonicalName: string;
  entityId: string;
  sourceRef: string;
  aliases: string[];
  creditCode: string | null;
  status: "active" | "candidate" | "paused";
  projectGroups: Array<"citic-alliance">;
  projectGroupBasis: string | null;
};

export type GpDumpInvestment = {
  gpName: string;
  investeeKey: string;
  investeeName: string;
  sectorTags: string[];
  eventDate: string | null;
  sourceUrl: string | null;
  motherFundName: string | null;
  subfundName: string | null;
  projectProvince: string | null;
};

export type GpDump = { gps: GpDumpEntity[]; investments: GpDumpInvestment[] };

const PROVINCE_SET = new Set<string>(PROVINCES);

export function parseGpDump(text: string, filename = "dump.json"): GpDump {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error(`${filename} 是空的`);
  if (filename.toLowerCase().endsWith(".csv") || trimmed.startsWith("gp_name,") || trimmed.startsWith("canonical_name,")) {
    return parseCsvDump(trimmed, filename);
  }
  let value: unknown;
  try { value = JSON.parse(trimmed); }
  catch { throw new Error(`${filename} 不是合法 JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${filename} 必须是对象`);
  const record = value as Record<string, unknown>;
  const gps = Array.isArray(record.gps) ? record.gps.map((row, index) => parseEntity(row, `${filename} gps[${index}]`)) : [];
  if (!Array.isArray(record.investments)) throw new Error(`${filename} 缺少 investments 数组`);
  const investments = record.investments.map((row, index) => parseInvestment(row, `${filename} investments[${index}]`));
  return dedupe({ gps, investments });
}

export function importSourceUrl(investeeKey: string, sourceUrl: string | null): { url: string; placeholder: boolean } {
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol === "https:" && parsed.hostname) {
        const host = parsed.hostname.toLowerCase();
        const placeholder = ["example.org", "example.com", "example.net"].some((domain) => host === domain || host.endsWith(`.${domain}`));
        return { url: sourceUrl, placeholder };
      }
    } catch { /* 非法地址按占位处理 */ }
  }
  return { url: `https://example.org/gp-import/${encodeURIComponent(investeeKey)}`, placeholder: true };
}

function parseCsvDump(text: string, filename: string): GpDump {
  const rows = parseCsv(text);
  const header = rows[0]?.map((cell) => cell.trim());
  if (!header?.length) throw new Error(`${filename} 缺少表头`);
  const index = new Map(header.map((name, position) => [name, position]));
  const gps: GpDumpEntity[] = [];
  const investments: GpDumpInvestment[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const cell = (name: string) => (rows[rowIndex]?.[index.get(name) ?? -1] ?? "").trim();
    const where = `${filename} 第 ${rowIndex + 1} 行`;
    const gpName = cell("gp_name") || cell("canonical_name");
    if (cell("entity_id") || cell("source_ref")) {
      gps.push(parseEntity({
        canonical_name: gpName,
        entity_id: cell("entity_id"),
        source_ref: cell("source_ref"),
        aliases: splitList(cell("aliases")),
        credit_code: cell("credit_code") || null,
        status: cell("status") || undefined,
        project_groups: splitList(cell("project_groups")),
        project_group_basis: cell("project_group_basis") || null,
      }, where));
    }
    if (cell("investee_name") || cell("investee_key")) {
      investments.push(parseInvestment({
        gp_name: gpName,
        investee_key: cell("investee_key"),
        investee_name: cell("investee_name"),
        sector_tags: splitList(cell("sector_tags")),
        event_date: cell("event_date") || null,
        source_url: cell("source_url") || null,
        mother_fund_name: cell("mother_fund_name") || null,
        subfund_name: cell("subfund_name") || null,
        project_province: cell("project_province") || null,
      }, where));
    }
  }
  return dedupe({ gps, investments });
}

function parseEntity(value: unknown, where: string): GpDumpEntity {
  const row = objectRow(value, where);
  const canonicalName = text(row, "canonical_name", "canonicalName");
  const entityId = text(row, "entity_id", "entityId");
  const sourceRef = text(row, "source_ref", "sourceRef");
  const statusText = text(row, "status") || "active";
  if (!canonicalName || canonicalName.length > 180) throw new Error(`${where} 缺少主体名称`);
  if (!entityId || entityId.length > 128) throw new Error(`${where} 缺少 entity_id`);
  if (sourceRef.length < 8 || sourceRef.length > 1000) throw new Error(`${where} 的 source_ref 需要 8 到 1000 字`);
  if (statusText !== "active" && statusText !== "candidate" && statusText !== "paused") throw new Error(`${where} 的 status 无效`);
  const groups = stringList(row.project_groups ?? row.projectGroups);
  if (groups.some((group) => group !== "citic-alliance")) throw new Error(`${where} 的 project_groups 只能包含 citic-alliance`);
  const basis = text(row, "project_group_basis", "projectGroupBasis") || null;
  if (groups.length && (!basis || basis.length < 8)) throw new Error(`${where} 填写分类时需要至少 8 字依据`);
  const aliases = stringList(row.aliases);
  if (aliases.length > 20 || aliases.some((alias) => alias.length > 180)) throw new Error(`${where} 的别名无效`);
  const credit = text(row, "credit_code", "creditCode") || null;
  if (credit && credit.length > 32) throw new Error(`${where} 的统一社会信用代码过长`);
  return {
    canonicalName, entityId, sourceRef, aliases, creditCode: credit, status: statusText,
    projectGroups: groups as Array<"citic-alliance">, projectGroupBasis: basis,
  };
}

function parseInvestment(value: unknown, where: string): GpDumpInvestment {
  const row = objectRow(value, where);
  const gpName = text(row, "gp_name", "gpName");
  const investeeKey = text(row, "investee_key", "investeeKey");
  const investeeName = text(row, "investee_name", "investeeName");
  if (!gpName) throw new Error(`${where} 缺少 gp_name`);
  if (!investeeKey || investeeKey.length > 200) throw new Error(`${where} 缺少 investee_key`);
  if (!investeeName || investeeName.length > 180) throw new Error(`${where} 缺少被投企业名称`);
  const sectorTags = stringList(row.sector_tags ?? row.sectorTags);
  if (sectorTags.some((tag) => !GP_TAGS.includes(tag))) throw new Error(`${where} 含有平台赛道以外的标签`);
  const eventDate = optionalDate(text(row, "event_date", "eventDate"), where);
  const source = text(row, "source_url", "sourceUrl") || null;
  if (source && !/^https:\/\//i.test(source)) throw new Error(`${where} 的 source_url 需要是 https，或留空表示导入占位`);
  const province = text(row, "project_province", "projectProvince");
  const projectProvince = !province || province === "未知" ? null : province;
  if (projectProvince && !PROVINCE_SET.has(projectProvince)) throw new Error(`${where} 的省份不在省级名单里`);
  return {
    gpName, investeeKey, investeeName, sectorTags, eventDate, sourceUrl: source,
    motherFundName: optionalName(text(row, "mother_fund_name", "motherFundName")),
    subfundName: optionalName(text(row, "subfund_name", "subfundName")),
    projectProvince,
  };
}

function dedupe(dump: GpDump): GpDump {
  const gps = new Map<string, GpDumpEntity>();
  for (const gp of dump.gps) gps.set(gp.canonicalName, gp);
  const investments = new Map<string, GpDumpInvestment>();
  for (const investment of dump.investments) investments.set(`${investment.gpName}\u0000${investment.investeeKey}`, investment);
  for (const investment of investments.values()) {
    if (!gps.has(investment.gpName)) throw new Error(`投资“${investment.investeeName}”没有对应主体“${investment.gpName}”`);
  }
  return { gps: [...gps.values()], investments: [...investments.values()] };
}

function optionalName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) throw new Error("基金或机构名称超过 120 字");
  return trimmed;
}

function optionalDate(value: string, where: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${where} 的日期需要是 YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${where} 的日期无效`);
  return value;
}

function objectRow(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where} 必须是对象`);
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return splitList(value);
  return [];
}

function splitList(value: string): string[] {
  return value.split(/[|,，、]/).map((item) => item.trim()).filter(Boolean);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(cell); cell = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}
