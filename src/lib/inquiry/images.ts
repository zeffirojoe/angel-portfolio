import sharp from "sharp";

export class UploadError extends Error {}

export type CleanImage = { filename: string; content: Buffer };

function sniff(b: Buffer): "jpeg" | "png" | "webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * The client's filename and MIME type are ignored. Content is checked by magic bytes,
 * then fully decoded and re-encoded, which drops EXIF/GPS data and anything hidden in
 * the file. Images are held in memory only and never written to disk.
 */
export async function cleanImage(file: File, name: string): Promise<CleanImage> {
  const input = Buffer.from(await file.arrayBuffer());
  if (!sniff(input)) throw new UploadError("Images must be JPEG, PNG or WebP.");
  try {
    const content = await sharp(input, { limitInputPixels: 50_000_000, failOn: "error" })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { filename: `${name}.jpg`, content };
  } catch {
    throw new UploadError("One of your images couldn't be read. Please try a different file.");
  }
}
