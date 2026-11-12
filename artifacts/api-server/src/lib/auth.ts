import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
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
  const derived = (await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return `scrypt$v1$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, version, n, r, p, saltEncoded, hashEncoded] = stored.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !n || !r || !p || !saltEncoded || !hashEncoded) return false;
  const expected = Buffer.from(hashEncoded, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltEncoded, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  })) as Buffer;
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
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
