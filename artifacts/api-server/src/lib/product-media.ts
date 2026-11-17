
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp4",
  ".webm",
]);

function uploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR?.trim();

  return path.resolve(
    configured || path.resolve(process.cwd(), "uploads", "products"),
  );
}

function validateId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Некорректный идентификатор для хранения файла.");
  }
}

export function createMediaFilename(extension: string): string {
  const normalized = extension.toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(normalized)) {
    throw new Error("Недопустимый формат файла.");
  }

  return `${randomUUID()}${normalized}`;
}

export function getProductMediaDirectory(
  ownerId: string,
  productId: string,
): string {
  validateId(ownerId);
  validateId(productId);

  return path.join(uploadsRoot(), ownerId, productId);
}

export async function ensureProductMediaDirectory(
  ownerId: string,
  productId: string,
): Promise<string> {
  const directory = getProductMediaDirectory(ownerId, productId);
  await mkdir(directory, { recursive: true });
  return directory;
}

export function getProductMediaPath(
  ownerId: string,
  productId: string,
  filename: string,
): string {
  validateId(ownerId);
  validateId(productId);

  if (
    path.basename(filename) !== filename ||
    !/^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$/i.test(filename)
  ) {
    throw new Error("Некорректное имя файла.");
  }

  const extension = path.extname(filename).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Недопустимый формат файла.");
  }

  return path.join(
    getProductMediaDirectory(ownerId, productId),
    filename,
  );
}

export async function removeProductMediaDirectory(
  ownerId: string,
  productId: string,
): Promise<void> {
  const directory = getProductMediaDirectory(ownerId, productId);

  await rm(directory, {
    recursive: true,
    force: true,
  });
}
