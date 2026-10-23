// Reading a research material: what it is, and what can be read out of it. The material is data: this
// file reads bytes and text, and never runs anything the material contains.
import { unzipSync } from "fflate";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { FORMAT_EXTENSIONS, MAX_EXTRACTED_CHARS, type WikiFormat } from "./catalog.ts";

export type ExtractionSection = { label: string; text: string };

export type ExtractionResult = {
  status: "available" | "unavailable";
  text: string;
  sections: ExtractionSection[];
  note: string | null;
};

/** The biggest XML part one office file may hold, so a small archive cannot expand into a huge one. */
const MAX_XML_BYTES = 20 * 1024 * 1024;

/**
 * What the material really is. The name says one thing and the bytes another, so the bytes decide:
 * a PDF starts with its own marker, an office file is a zip whose entries say whether it is a Word or
 * a PowerPoint document, and plain text has to decode as UTF-8.
 */
export function detectFormat(fileName: string, bytes: Uint8Array): WikiFormat | null {
  const name = fileName.toLowerCase();
  const byExtension = (Object.keys(FORMAT_EXTENSIONS) as WikiFormat[]).find(format =>
    FORMAT_EXTENSIONS[format].some(extension => name.endsWith(`.${extension}`)));
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "pdf";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const entries = zipEntryNames(bytes);
    if (entries.includes("word/document.xml")) return "docx";
    if (entries.some(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry))) return "pptx";
    return null;
  }
  // Plain text has no marker of its own: its name says so, and the bytes have to decode as text.
  return byExtension === "markdown" ? "markdown" : null;
}

/** The names inside a zip, read from its central directory without inflating anything. */
function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return names;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The text runs of one XML part, one line per paragraph. */
function xmlParagraphs(xml: string, runTag: string): string[] {
  const paragraphs: string[] = [];
  const paragraph = new RegExp(`<${runTag === "w:t" ? "w:p" : "a:p"}(?:\\s[^>]*)?>([\\s\\S]*?)</${runTag === "w:t" ? "w:p" : "a:p"}>`, "g");
  const run = new RegExp(`<${runTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${runTag}>`, "g");
  for (const match of xml.matchAll(paragraph)) {
    let text = "";
    for (const piece of match[1]!.matchAll(run)) text += decodeXml(piece[1]!);
    const line = text.replace(/\s+/g, " ").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs;
}

async function fromPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  const document = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractPdfText(document, { mergePages: false });
  const pages = (text as string[]).map((page, index) => ({ label: `第 ${index + 1} 页`, text: (page ?? "").replace(/[ \t]+\n/g, "\n").trim() }));
  const sections = pages.filter(page => page.text);
  const body = sections.map(page => `<!-- ${page.label} -->\n${page.text}`).join("\n\n");
  if (!body.trim()) return { status: "unavailable", text: "", sections: [], note: "PDF 没有可提取的文字层（可能是扫描件），未生成知识页。" };
  return { status: "available", text: body, sections, note: `共 ${totalPages} 页` };
}

function fromOffice(bytes: Uint8Array, format: "docx" | "pptx"): ExtractionResult {
  const wanted = format === "docx"
    ? (name: string) => name === "word/document.xml"
    : (name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name);
  const files = unzipSync(bytes, { filter: file => wanted(file.name) && file.originalSize <= MAX_XML_BYTES });
  const names = Object.keys(files).sort((left, right) => (format === "pptx" ? slideNumber(left) - slideNumber(right) : left.localeCompare(right)));
  if (!names.length) return { status: "unavailable", text: "", sections: [], note: "文档结构无法读取，未生成知识页。" };
  const sections: ExtractionSection[] = [];
  for (const name of names) {
    const xml = new TextDecoder("utf-8", { fatal: false }).decode(files[name]!);
    const paragraphs = xmlParagraphs(xml, format === "docx" ? "w:t" : "a:t");
    const text = paragraphs.join("\n");
    if (!text.trim()) continue;
    sections.push({ label: format === "docx" ? "正文" : `第 ${slideNumber(name)} 页幻灯片`, text });
  }
  if (!sections.length) return { status: "unavailable", text: "", sections: [], note: "文档没有可提取的文字，未生成知识页。" };
  return { status: "available", text: sections.map(section => `<!-- ${section.label} -->\n${section.text}`).join("\n\n"), sections, note: null };
}

function slideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : 0;
}

function fromMarkdown(bytes: Uint8Array): ExtractionResult {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { status: "unavailable", text: "", sections: [], note: "文件不是 UTF-8 文本，无法读取。" }; }
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return { status: "unavailable", text: "", sections: [], note: "文件为空，未生成知识页。" };
  return { status: "available", text: cleaned, sections: [{ label: "正文", text: cleaned }], note: null };
}

/** Reads the material out. A failure is reported, never guessed around. */
export async function extractMaterial(format: WikiFormat, bytes: Uint8Array): Promise<ExtractionResult> {
  try {
    if (format === "pdf") return await fromPdf(bytes);
    if (format === "docx" || format === "pptx") return fromOffice(bytes, format);
    return fromMarkdown(bytes);
  } catch (error) {
    return { status: "unavailable", text: "", sections: [], note: `文件无法读取：${(error as Error).message.slice(0, 200)}` };
  }
}

/** The text of a section as it is written into the material: its anchor, then its content. */
function sectionText(section: ExtractionSection): string {
  return `<!-- ${section.label} -->\n${section.text}`;
}

/**
 * The head of a text that is longer than the room left: the last whole line that fits, or the last
 * whole sentence, or the plain cut. A material that is one long section still gives the build
 * something to read.
 */
function prefixOf(text: string, room: number): string {
  if (room <= 0) return "";
  if (text.length <= room) return text;
  const head = text.slice(0, room);
  const line = head.lastIndexOf("\n");
  if (line >= room / 2) return head.slice(0, line);
  const sentence = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"), head.lastIndexOf(".\n"));
  if (sentence >= room / 2) return head.slice(0, sentence + 1);
  return head;
}

/**
 * Keeps the material inside the budget the build allows. The budget counts the anchors and the
 * separators too, so the text that comes out never exceeds it; a section that does not fit whole
 * leaves a readable prefix behind instead of nothing at all.
 */
export function capExtraction(result: ExtractionResult, limit = MAX_EXTRACTED_CHARS): { text: string; sections: ExtractionSection[]; truncated: boolean } {
  const whole = result.sections.map(sectionText).join("\n\n");
  if (whole.length <= limit) return { text: whole, sections: result.sections, truncated: false };
  const sections: ExtractionSection[] = [];
  let used = 0;
  for (const section of result.sections) {
    const separator = sections.length ? 2 : 0;
    const anchor = sectionText({ label: section.label, text: "" }).length;
    const room = limit - used - separator - anchor;
    if (room <= 0) break;
    if (section.text.length <= room) {
      sections.push(section);
      used += separator + anchor + section.text.length;
      continue;
    }
    const prefix = prefixOf(section.text, room);
    if (!prefix) break;
    sections.push({ label: section.label, text: prefix });
    used += separator + anchor + prefix.length;
    break;
  }
  return { text: sections.map(sectionText).join("\n\n"), sections, truncated: true };
}
