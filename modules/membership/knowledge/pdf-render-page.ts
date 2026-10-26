// One page of one PDF, rendered in a process of its own. The parent starts this program with the
// material in a private temporary file and the page it wants, and reads the picture back from the
// output. Nothing else happens here: the file is read, the page is drawn, the picture is written
// out. A PDF that misbehaves can only waste this process, never the worker.
import { readFile } from "node:fs/promises";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

const [, , file, pageText, scaleText, edgeText, pixelsText] = process.argv;

/**
 * The picture of one page. The scale is chosen so the page fits the limits the platform sets for
 * the images it shows: the longest edge and the pixel count. A very large page is drawn smaller
 * rather than refused, because a page that is too big to read is still better than no page.
 */
async function render(): Promise<void> {
  const page = Number(pageText);
  const maxScale = Number(scaleText);
  const maxEdge = Number(edgeText);
  const maxPixels = Number(pixelsText);
  const bytes = await readFile(file);
  const document = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const target = await document.getPage(page);
    const viewport = target.getViewport({ scale: 1 });
    const longest = Math.max(viewport.width, viewport.height);
    const fit = Math.min(maxScale, maxEdge / longest, Math.sqrt(maxPixels / (viewport.width * viewport.height)));
    const rendered = await renderPageAsImage(document, page, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: Math.max(0.2, fit),
    });
    const picture = Buffer.from(rendered);
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(picture, error => (error ? reject(error) : resolve()));
    });
  } finally {
    await document.loadingTask.destroy();
  }
}

render().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
