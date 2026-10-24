import { createHash, randomUUID } from "node:crypto";
import { detectFormat, extractMaterial, capExtraction } from "../knowledge/extract.ts";
import type { WikiFormat } from "../knowledge/catalog.ts";

export const MAX_MATERIALS = 3;
export const MAX_MATERIAL_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_MATERIAL_BYTES = 10 * 1024 * 1024;

export type TaskMaterial = { id: string; filename: string; format: WikiFormat; contentType: string; bytes: Buffer; sha256: string };

const CONTENT_TYPES: Record<WikiFormat, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", markdown: "text/markdown; charset=utf-8",
};

export function parseTaskMaterials(value: unknown): TaskMaterial[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MATERIALS) throw new Error("expert_material_count_invalid");
  let total = 0;
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object") throw new Error("expert_material_invalid");
    const { fileName, base64 } = item as Record<string, unknown>;
    if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 180 || /[\\/\r\n\0]/.test(fileName) || typeof base64 !== "string") throw new Error("expert_material_invalid");
    if (base64.length > Math.ceil(MAX_MATERIAL_BYTES / 3) * 4) throw new Error("expert_material_too_large");
    // Avoid a repeated-group regexp: multi-megabyte valid inputs can exhaust V8's regexp stack.
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(base64.slice(0, base64.length - padding))) throw new Error("expert_material_invalid");
    const bytes = Buffer.from(base64, "base64");
    total += bytes.length;
    if (!bytes.length || bytes.length > MAX_MATERIAL_BYTES || total > MAX_TOTAL_MATERIAL_BYTES) throw new Error("expert_material_too_large");
    const format = detectFormat(fileName, bytes);
    if (!format) throw new Error("expert_material_format_unsupported");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (seen.has(sha256)) throw new Error("expert_material_duplicate");
    seen.add(sha256);
    return { id: randomUUID(), filename: fileName.trim(), format, contentType: CONTENT_TYPES[format], bytes, sha256 };
  });
}

export async function materialContext(rows: Array<{ filename: string; format: WikiFormat; body: Buffer; sha256: string }>) {
  const materials = [];
  for (const row of rows) {
    let text: string;
    try {
      const result = await extractMaterial(row.format, row.body);
      if (result.status !== "available") throw new Error("expert_material_unreadable");
      text = capExtraction(result, 12_000).text;
    } catch { throw new Error("expert_material_unreadable"); }
    materials.push({ filename: row.filename, sha256: row.sha256, text });
  }
  return materials;
}
