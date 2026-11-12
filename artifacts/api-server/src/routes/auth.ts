import { and, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, emailVerificationTokensTable, sessionsTable, usersTable } from "@workspace/db";
import { clearSessionCookie, createOpaqueToken, hashPassword, hashToken, normalizeEmail, readSessionCookie, sessionCookie, sessionExpiry, verifyPassword } from "../lib/auth";
import { sendVerificationEmail } from "../lib/mailer";
import { requireUser } from "../middlewares/requireUser";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const dummyHash = "scrypt$v1$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function rateLimit(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const key = `${req.ip ?? "unknown"}:${req.path}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  else if (current.count >= 10) {
    res.status(429).json({ error: "Слишком много попыток. Повторите позже." });
    return;
  } else current.count += 1;
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
  next();
}

function requireSameOrigin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const origin = req.get("origin");
  const expected = process.env.APP_ORIGIN;
  if (origin && expected && origin !== expected) {
    res.status(403).json({ error: "Недопустимый источник запроса." });
    return;
  }
  if (process.env.NODE_ENV === "production" && (!origin || !expected)) {
    res.status(403).json({ error: "Не удалось проверить источник запроса." });
    return;
  }
  next();
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

router.post("/auth/register", rateLimit, requireSameOrigin, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!validEmail(email) || password.length < 12 || password.length > 128) {
      res.status(400).json({ error: "Укажите корректный email и пароль длиной от 12 до 128 символов." });
      return;
    }
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length) {
      res.status(409).json({ error: "Не удалось создать аккаунт с указанными данными. Возможно, адрес уже зарегистрирован." });
      return;
    }
    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(usersTable).values({ email, passwordHash, status: "active" }).returning({ id: usersTable.id });
    const token = createOpaqueToken();
    await db.insert(emailVerificationTokensTable).values({
      userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await sendVerificationEmail(email, token);
    res.status(201).json({ message: "Аккаунт создан. Проверьте почту и подтвердите email." });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/verify-email", rateLimit, requireSameOrigin, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token || token.length > 256) {
      res.status(400).json({ error: "Ссылка подтверждения недействительна или устарела." });
      return;
    }
    const [record] = await db.select().from(emailVerificationTokensTable).where(
      and(eq(emailVerificationTokensTable.tokenHash, hashToken(token)), gt(emailVerificationTokensTable.expiresAt, new Date()), isNull(emailVerificationTokensTable.usedAt)),
    ).limit(1);
    if (!record) {
      res.status(400).json({ error: "Ссылка подтверждения недействительна или устарела." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ emailVerifiedAt: new Date() }).where(eq(usersTable.id, record.userId));
      await tx.update(emailVerificationTokensTable).set({ usedAt: new Date() }).where(eq(emailVerificationTokensTable.userId, record.userId));
    });
    res.json({ message: "Email подтверждён. Теперь можно войти." });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/login", rateLimit, requireSameOrigin, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    const matches = await verifyPassword(password, user?.passwordHash ?? dummyHash).catch(() => false);
    if (!user || !matches || user.status !== "active") {
      res.status(401).json({ error: "Неверный email или пароль." });
      return;
    }
    if (!user.emailVerifiedAt) {
      res.status(403).json({ error: "Сначала подтвердите email по ссылке из письма." });
      return;
    }
    const token = createOpaqueToken();
    const expiresAt = sessionExpiry();
    await db.insert(sessionsTable).values({ userId: user.id, tokenHash: hashToken(token), expiresAt });
    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    res.setHeader("Set-Cookie", sessionCookie(token, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/me", requireUser, (req, res) => {
  res.json({ user: { id: req.userId, email: req.userEmail } });
});

router.post("/auth/logout", requireSameOrigin, async (req, res, next) => {
  try {
    const token = readSessionCookie(req.headers.cookie);
    if (token) await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashToken(token)));
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout-all", requireUser, requireSameOrigin, async (req, res, next) => {
  try {
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, req.userId!));
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

export default router;
