import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt);
  return `scrypt$v1$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, version, n, r, p, saltEncoded, hashEncoded] = stored.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || n !== "32768" || r !== "8" || p !== "1" || !saltEncoded || !hashEncoded) return false;
  const salt = Buffer.from(saltEncoded, "base64url");
  const expected = Buffer.from(hashEncoded, "base64url");
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await deriveKey(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const name = process.env.NODE_ENV === "production" ? "__Host-session" : "session";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(): string {
  const name = process.env.NODE_ENV === "production" ? "__Host-session" : "session";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readSessionCookie(cookieHeader?: string): string | null {
  const name = process.env.NODE_ENV === "production" ? "__Host-session" : "session";
  const item = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
}
