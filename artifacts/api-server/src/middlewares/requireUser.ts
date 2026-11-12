import { db, sessionsTable, usersTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { hashToken, readSessionCookie } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readSessionCookie(req.headers.cookie);
    if (!token) {
      res.status(401).json({ error: "Необходимо войти в аккаунт" });
      return;
    }
    const [session] = await db.select().from(sessionsTable).where(
      and(eq(sessionsTable.tokenHash, hashToken(token)), gt(sessionsTable.expiresAt, new Date())),
    ).limit(1);
    if (!session) {
      res.status(401).json({ error: "Сессия истекла. Войдите снова." });
      return;
    }
    const [user] = await db.select({ id: usersTable.id, email: usersTable.email, status: usersTable.status })
      .from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
    if (!user || user.status !== "active") {
      res.status(401).json({ error: "Аккаунт недоступен" });
      return;
    }
    req.userId = user.id;
    req.userEmail = user.email;
    void db.update(sessionsTable).set({ lastSeenAt: new Date() }).where(eq(sessionsTable.id, session.id));
    next();
  } catch (error) {
    next(error);
  }
}
