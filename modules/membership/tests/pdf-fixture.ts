// A synthetic PDF, built here so the tests carry their own material: pages with a text layer, pages
// with a drawing and no text (a scan), and as many pages as a test asks for. The bytes are a real
// PDF: a catalog, a page tree, a font, a content stream per page and a cross-reference table.
export type PdfPageSpec = {
  /** The lines the text layer of the page holds. */
  lines?: string[];
  /** Whether the page carries a drawing, the way a chart is drawn rather than typed. */
  drawing?: boolean;
};

const escapeText = (value: string) => value.replace(/[()\\]/g, "");

export function buildPdf(pages: PdfPageSpec[]): Buffer {
  const objects: string[] = [];
  const pageNumbers: number[] = [];
  let next = 4;
  for (const _page of pages) {
    pageNumbers.push(next);
    next += 2;
  }
  const fontNumber = next;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  pages.forEach((page, index) => {
    const lines = page.lines ?? [];
    let content = "";
    if (lines.length) {
      content += `BT /F1 12 Tf 72 720 Td ${lines.map((line, position) => `${position ? "0 -14 Td " : ""}(${escapeText(line)}) Tj`).join(" ")} ET\n`;
    }
    if (page.drawing) {
      // Three bars and a baseline: a picture the reader can see and the text layer cannot describe.
      content += "0.85 0.85 0.85 RG 2 w 72 300 m 400 300 l S\n";
      content += "0.20 0.40 0.80 rg 90 300 60 120 re f\n";
      content += "0.20 0.40 0.80 rg 180 300 60 200 re f\n";
      content += "0.20 0.40 0.80 rg 270 300 60 80 re f\n";
    }
    const pageNumber = pageNumbers[index]!;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageNumber + 1} 0 R /Resources << /Font << /F1 ${fontNumber} 0 R >> >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageNumbers.map(number => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
