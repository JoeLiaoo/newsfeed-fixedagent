import { createHash } from "node:crypto";
import sharp from "sharp";

/** The decode limits of one image: what may be read, how large it may be, and how it is normalized. */
export const FIGURE_IMAGE_LIMITS = {
  /** Bytes one image download may carry. */
  maxBytes: 4 * 1024 * 1024,
  /** Pixels one image may decode to; a larger file is refused rather than scaled down. */
  maxPixels: 20_000_000,
  /** Pixels the image sent to a model may have. */
  modelPixels: 2_000_000,
  /** The longest edge of the image sent to a model. */
  modelEdge: 1600,
  /** Bytes one normalized image may have. */
  normalizedBytes: 1024 * 1024,
  /** The smallest edge an image may have; smaller pictures are marks or tracking, not charts. */
  minEdge: 60,
} as const;

export type PreparedKnowledgeFigure = {
  original: Buffer; normalized: Buffer; originalSha256: string; normalizedSha256: string;
  width: number; height: number; mediaType: "image/jpeg";
};

/** The formats this pipeline reads. SVG, AVIF and HEIC are not among them. */
function signature(bytes: Buffer): "png" | "jpeg" | "webp" | "gif" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "GIF") return "gif";
  return null;
}

/**
 * A declared type of text is refused even when the bytes look like a picture: a page that answers
 * with markup is not an image, whatever the server says. A missing or generic type is decided by
 * the signature and the decoder, never by the header alone.
 */
function refusesByType(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!type) return false;
  return /^(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript|x-www-form-urlencoded))/.test(type);
}

/**
 * Decode only bounded raster formats, and normalize to the one immutable picture the model and
 * the browser both receive. The original bytes are kept next to it as the forensic copy.
 */
export async function prepareKnowledgeFigure(bytes: Buffer, contentType: string): Promise<PreparedKnowledgeFigure> {
  if (bytes.length > FIGURE_IMAGE_LIMITS.maxBytes || bytes.length < 16) throw new Error("figure_bytes_invalid");
  if (refusesByType(contentType)) throw new Error("figure_mime_invalid");
  if (!signature(bytes)) throw new Error("figure_type_invalid");
  // Only the first frame of an animation is read; the rest of the movement is not evidence.
  const source = sharp(bytes, { limitInputPixels: FIGURE_IMAGE_LIMITS.maxPixels, animated: false, failOn: "error" });
  const meta = await source.metadata();
  if (!meta.width || !meta.height || meta.width * meta.height > FIGURE_IMAGE_LIMITS.maxPixels) throw new Error("figure_pixels_invalid");
  // Very long charts need slicing to be legible; that is a later phase.
  if (Math.max(meta.width / meta.height, meta.height / meta.width) > 4) throw new Error("figure_too_tall");
  const scale = Math.min(1, FIGURE_IMAGE_LIMITS.modelEdge / meta.width, FIGURE_IMAGE_LIMITS.modelEdge / meta.height,
    Math.sqrt(FIGURE_IMAGE_LIMITS.modelPixels / (meta.width * meta.height)));
  const normalized = await source.rotate()
    .resize({ width: Math.max(1, Math.floor(meta.width * scale)), height: Math.max(1, Math.floor(meta.height * scale)), fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#fff" })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  if (normalized.length > FIGURE_IMAGE_LIMITS.normalizedBytes) throw new Error("figure_normalized_too_large");
  const final = await sharp(normalized, { limitInputPixels: FIGURE_IMAGE_LIMITS.modelPixels }).metadata();
  if (!final.width || !final.height || final.width * final.height > FIGURE_IMAGE_LIMITS.modelPixels) throw new Error("figure_model_pixels_invalid");
  const digest = (body: Buffer) => createHash("sha256").update(body).digest("hex");
  return { original: bytes, normalized, originalSha256: digest(bytes), normalizedSha256: digest(normalized), width: final.width, height: final.height, mediaType: "image/jpeg" };
}
