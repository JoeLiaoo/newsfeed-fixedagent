/** Only explicit labels are read as attribution; absent or unstructured values stay unknown. */
export type ExtractedMetadata = { title: string | null; author: string | null; organization: string | null; date: string | null; kind: string | null };

function validDate(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

function labeled(lines: string[], labels: string[]): string | null {
  const label = labels.join("|");
  const pattern = new RegExp(`^\\s*(?:${label})\\s*[:：]\\s*(.{1,120})\\s*$`, "i");
  for (const line of lines) {
    const value = pattern.exec(line)?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

/** Reads a small set of conventional, explicit title and attribution fields from the extracted text. */
export function extractSourceMetadata(text: string): ExtractedMetadata {
  const lines = text.split(/\r?\n/).slice(0, 80);
  const title = labeled(lines, ["title", "标题"]) ?? lines.map(line => /^\s{0,3}#\s+(.{2,200})\s*$/.exec(line)?.[1]?.trim()).find(Boolean) ?? null;
  const author = labeled(lines, ["author", "作者", "分析师", "撰写人"]);
  const organization = labeled(lines, ["organization", "机构", "研究机构", "来源机构"]);
  const rawDate = labeled(lines, ["date", "材料日期", "报告日期", "发布日期"]);
  const date = rawDate ? validDate(rawDate) : null;
  const kind = labeled(lines, ["kind", "材料类型", "文件类型"]);
  return { title, author, organization, date, kind };
}
