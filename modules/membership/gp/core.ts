import { createHash } from "node:crypto";
import { DIRECTIONS } from "../catalog.ts";
import { textField } from "../experts/data.ts";

export const GP_TAGS: string[] = DIRECTIONS.filter(d => d.name !== "战略配售").flatMap(d => [...d.tags]);
export type Investment = { key: string; name: string; investeeId: string | null; dataDate: string | null; updatedAt: string | null; investmentDate: string | null; raw: Record<string,unknown> };

export function normalizeInvestment(raw: Record<string,unknown>): Investment | null {
  const name = textField(raw, "company_name", "investee_name", "investee_company_name", "name");
  if (!name) return null;
  const investeeId = textField(raw, "investee_id", "company_id", "comp_id", "comp_id_iwudao", "credit_code", "unified_social_credit_code");
  const key = (investeeId ? "id:" + investeeId : "name:" + name.replace(/\s+/g,"").toLowerCase());
  return {
    key: createHash("sha256").update(key).digest("hex"), name, investeeId,
    dataDate: textField(raw,"data_date","data_dt","as_of_date"),
    updatedAt: textField(raw,"update_time","updated_at","include_date","ingestion_time"),
    investmentDate: textField(raw,"invest_date","investment_date"),
    raw,
  };
}

export function uniqueInvestments(rows: readonly Record<string,unknown>[]) {
  const seen = new Map<string,Investment>();
  let missing = 0;
  for (const raw of rows) {
    const row = normalizeInvestment(raw);
    if (!row) { missing++; continue; }
    if (!seen.has(row.key)) seen.set(row.key,row);
  }
  return { records:[...seen.values()],missing };
}

export function validSectorTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > GP_TAGS.length || value.some(t=>typeof t !== "string" || !GP_TAGS.includes(t))) return null;
  return [...new Set(value as string[])];
}

export function matchInterests(tags: readonly string[],selected: readonly string[]) {
  const wanted = new Set(selected);
  return tags.some(t=>GP_TAGS.includes(t) && wanted.has(t));
}

export function offDay(date: string, holidays: readonly string[], makeupWorkdays: readonly string[]) {
  const day = new Date(date+"T00:00:00Z").getUTCDay();
  return !makeupWorkdays.includes(date) && (holidays.includes(date) || day === 0 || day === 6);
}

export function splitMessageLines(lines: readonly string[], limit = 1600) {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    for (let i=0; i<Math.max(1,line.length); i+=limit) {
      const slice=line.slice(i,i+limit);
      if (current && current.length+slice.length+1>limit) { chunks.push(current); current=""; }
      current += (current ? "\n" : "")+slice;
    }
  }
  if(current) chunks.push(current);
  return chunks.length?chunks:["今日无更新"];
}

/** A historical baseline or a retracted item can never become a newly approved investment. */
export function canReviewInvestment(from:string,to:string) {
  const allowed:Record<string,string[]>={
    baseline:["baseline","retracted"],observed:["observed","verified","retracted"],
    verified:["verified","retracted"],retracted:["retracted"],
  };
  return allowed[from]?.includes(to)??false;
}

/** Schedules can be delayed after a restart, but only one digest per calendar edition is created. */
export function dueNotificationKinds(hour:number,isOffDay:boolean):("news"|"gp")[] {
  const due:("news"|"gp")[]=[];
  if(hour>=(isOffDay?11:9)) due.push("news");
  if(hour>=(isOffDay?12:10)) due.push("gp");
  return due;
}
