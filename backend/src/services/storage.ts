import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { config } from "../config/index.js";
import { HttpError } from "./availability.js";
export interface FileStorage {
  put(bytes: Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export class LocalFileStorage implements FileStorage {
  private path(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new HttpError(400, "Invalid storage key");
    return join(config.uploadDir, key);
  }
  async put(bytes: Buffer) {
    await mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    await writeFile(this.path(key), bytes, { mode: 0o600, flag: "wx" });
    return key;
  }
  read(key: string) {
    return readFile(this.path(key));
  }
  async remove(key: string) {
    await unlink(this.path(key));
  }
}
export const storage: FileStorage = new LocalFileStorage();
/** Decode and re-encode rather than trusting extension or browser MIME. Strips metadata. */
export async function validateImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new HttpError(400, "Максимум 5 МБ.");
  try {
    const image = sharp(bytes, { limitInputPixels: 25000000, animated: false });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "")) throw new Error("format");
    return await image.rotate().webp({ quality: 90 }).toBuffer();
  } catch {
    throw new HttpError(400, "Потрібне справжнє зображення JPEG, PNG або WebP.");
  }
}
