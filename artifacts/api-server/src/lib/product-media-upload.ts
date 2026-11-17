
import multer from "multer";

const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const VIDEO_MAX_SIZE = 100 * 1024 * 1024;

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
]);

function createFileFilter(allowedMimes: Set<string>) {
  return (
    _req: Express.Request,
    file: Express.Multer.File,
    callback: multer.FileFilterCallback,
  ): void => {
    if (!allowedMimes.has(file.mimetype)) {
      callback(new Error("Недопустимый формат файла."));
      return;
    }

    callback(null, true);
  };
}

const storage = multer.memoryStorage();

export const uploadProductImages = multer({
  storage,
  limits: {
    fileSize: IMAGE_MAX_SIZE,
    files: 5,
  },
  fileFilter: createFileFilter(IMAGE_MIMES),
}).array("images", 5);

export const uploadProductVideo = multer({
  storage,
  limits: {
    fileSize: VIDEO_MAX_SIZE,
    files: 1,
  },
  fileFilter: createFileFilter(VIDEO_MIMES),
}).single("video");

export function validateImageSignature(file: Express.Multer.File): boolean {
  const buffer = file.buffer;

  if (file.mimetype === "image/jpeg") {
    return buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
  }

  if (file.mimetype === "image/png") {
    return buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
  }

  if (file.mimetype === "image/webp") {
    return buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
  }

  return false;
}

export function validateVideoSignature(file: Express.Multer.File): boolean {
  const buffer = file.buffer;

  if (file.mimetype === "video/mp4") {
    return buffer.length >= 12 &&
      buffer.toString("ascii", 4, 8) === "ftyp";
  }

  if (file.mimetype === "video/webm") {
    return buffer.length >= 4 &&
      buffer.subarray(0, 4).equals(
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      );
  }

  return false;
}
