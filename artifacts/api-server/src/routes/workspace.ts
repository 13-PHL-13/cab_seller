import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db, companiesTable, companyInvitationsTable, companyMembershipsTable,
  sessionsTable, usersTable,
} from "@workspace/db";
import { createOpaqueToken, hashToken, normalizeEmail } from "../lib/auth";
import { sendCompanyInvitationEmail } from "../lib/mailer";
import { requireUser } from "../middlewares/requireUser";

const router: IRouter = Router();
router.use("/workspace", requireUser);
const SECTION_IDS = new Set(["dashboard", "marketplaces", "funnel", "analytics", "finance", "products", "tasks", "settings"]);

function userId(req: import("express").Request): string { return req.userId!; }
function companyId(req: import("express").Request): string { return req.companyId!; }
function isAdmin(req: import("express").Request): boolean { return req.companyRole === "owner" || req.companyRole === "admin"; }

router.get("/workspace", async (req, res, next) => {
  try {
    const rows = await db.select({ company: companiesTable, role: companyMembershipsTable.role })
      .from(companyMembershipsTable).innerJoin(companiesTable, eq(companiesTable.id, companyMembershipsTable.companyId))
      .where(eq(companyMembershipsTable.userId, userId(req))).orderBy(companiesTable.createdAt);
    const members = await db.select({
      userId: companyMembershipsTable.userId, email: usersTable.email, role: companyMembershipsTable.role,
      sections: companyMembershipsTable.sections, storeAccess: companyMembershipsTable.storeAccess,
      canSeeFinance: companyMembershipsTable.canSeeFinance, canEditCogs: companyMembershipsTable.canEditCogs,
      canApprovePrices: companyMembershipsTable.canApprovePrices, canIssueTasks: companyMembershipsTable.canIssueTasks,
      tokenLimit: companyMembershipsTable.tokenLimit, createdAt: companyMembershipsTable.createdAt,
    }).from(companyMembershipsTable).innerJoin(usersTable, eq(usersTable.id, companyMembershipsTable.userId))
      .where(eq(companyMembershipsTable.companyId, companyId(req))).orderBy(desc(companyMembershipsTable.createdAt));
    const invitations = isAdmin(req) ? await db.select({
      id: companyInvitationsTable.id, email: companyInvitationsTable.email, role: companyInvitationsTable.role,
      sections: companyInvitationsTable.sections, expiresAt: companyInvitationsTable.expiresAt, createdAt: companyInvitationsTable.createdAt,
    }).from(companyInvitationsTable).where(and(
      eq(companyInvitationsTable.companyId, companyId(req)), isNull(companyInvitationsTable.acceptedAt),
      isNull(companyInvitationsTable.revokedAt), gt(companyInvitationsTable.expiresAt, new Date()),
    )).orderBy(desc(companyInvitationsTable.createdAt)) : [];
    res.json({
      companies: rows.map(({ company, role }) => ({ id: company.id, name: company.name, role })),
      activeCompanyId: companyId(req), currentUserId: userId(req), role: req.companyRole, members, invitations,
    });
  } catch (error) { next(error); }
});

router.post("/workspace/companies", async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.replace(/[\r\n\0]/g, " ").trim().slice(0, 120) : "";
    if (!name) { res.status(400).json({ error: "Укажите название компании." }); return; }
    const result = await db.transaction(async (tx) => {
      const [company] = await tx.insert(companiesTable).values({ name, ownerUserId: userId(req) }).returning();
      await tx.insert(companyMembershipsTable).values({ companyId: company.id, userId: userId(req), role: "owner" });
      if (req.sessionId) await tx.update(sessionsTable).set({ activeCompanyId: company.id }).where(eq(sessionsTable.id, req.sessionId));
      return company;
    });
    res.status(201).json({ company: { id: result.id, name: result.name, role: "owner" } });
  } catch (error) { next(error); }
});

router.post("/workspace/active", async (req, res, next) => {
  try {
    const target = typeof req.body?.companyId === "string" ? req.body.companyId : "";
    const [membership] = await db.select({ companyId: companyMembershipsTable.companyId })
      .from(companyMembershipsTable).where(and(eq(companyMembershipsTable.companyId, target), eq(companyMembershipsTable.userId, userId(req)))).limit(1);
    if (!membership || !req.sessionId) { res.status(404).json({ error: "Компания не найдена или у вас нет к ней доступа." }); return; }
    await db.update(sessionsTable).set({ activeCompanyId: membership.companyId }).where(eq(sessionsTable.id, req.sessionId));
    res.json({ activeCompanyId: membership.companyId });
  } catch (error) { next(error); }
});

router.post("/workspace/invitations", async (req, res, next) => {
  try {
    if (!isAdmin(req)) { res.status(403).json({ error: "Приглашать сотрудников могут владелец и администратор компании." }); return; }
    const email = typeof req.body?.email === "string" ? normalizeEmail(req.body.email) : "";
    const role = req.body?.role === "lead" || req.body?.role === "admin" ? req.body.role : "employee";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || (role === "admin" && req.companyRole !== "owner")) {
      res.status(400).json({ error: "Проверьте email и роль. Назначать администраторов может только владелец." }); return;
    }
    const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existingUser) {
      const [existingMembership] = await db.select({ id: companyMembershipsTable.id }).from(companyMembershipsTable)
        .where(and(eq(companyMembershipsTable.companyId, companyId(req)), eq(companyMembershipsTable.userId, existingUser.id))).limit(1);
      if (existingMembership) { res.status(409).json({ error: "Этот пользователь уже состоит в компании." }); return; }
    }
    const permissions = req.body?.permissions && typeof req.body.permissions === "object" ? req.body.permissions as Record<string, unknown> : {};
    const requestedSections = Array.isArray(permissions.sections) ? permissions.sections.filter((v): v is string => typeof v === "string" && SECTION_IDS.has(v)) : ["dashboard", "marketplaces", "funnel", "analytics", "products"];
    const can = (key: string, ownerDefault = false) => req.companyRole === "owner" ? (typeof permissions[key] === "boolean" ? permissions[key] : ownerDefault) : Boolean(req.companyPermissions?.[key as keyof typeof req.companyPermissions] && permissions[key]);
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId(req))).limit(1);
    const [invitation] = await db.insert(companyInvitationsTable).values({
      companyId: companyId(req), email, role, sections: requestedSections,
      storeAccess: Array.isArray(permissions.storeAccess) ? permissions.storeAccess.filter((v): v is string => typeof v === "string") : "all",
      canSeeFinance: can("canSeeFinance"), canEditCogs: can("canEditCogs"),
      canApprovePrices: can("canApprovePrices"), canIssueTasks: can("canIssueTasks"),
      tokenLimit: typeof permissions.tokenLimit === "number" && Number.isInteger(permissions.tokenLimit) && permissions.tokenLimit >= 0 ? permissions.tokenLimit : null,
      tokenHash: hashToken(token), expiresAt, createdBy: userId(req),
    }).returning({ id: companyInvitationsTable.id });
    const link = `${(process.env.APP_ORIGIN ?? "").replace(/\/$/, "")}/invitations/accept?token=${encodeURIComponent(token)}`;
    try { await sendCompanyInvitationEmail(email, token, company?.name ?? "Навигатор продаж"); }
    catch (error) {
      await db.delete(companyInvitationsTable).where(eq(companyInvitationsTable.id, invitation.id));
      req.log.error({ err: error }, "Company invitation email delivery failed");
      res.status(503).json({ error: "Приглашение не отправлено: проверьте настройки почты." }); return;
    }
    res.status(201).json({ id: invitation.id, email, role, expiresAt, link });
  } catch (error) { next(error); }
});

router.get("/workspace/invitations/:token", async (req, res) => {
  const token = req.params.token;
  if (token.length > 256) { res.status(404).json({ error: "Приглашение недействительно или истекло." }); return; }
  const [invitation] = await db.select({ invitation: companyInvitationsTable, companyName: companiesTable.name })
    .from(companyInvitationsTable).innerJoin(companiesTable, eq(companiesTable.id, companyInvitationsTable.companyId))
    .where(and(eq(companyInvitationsTable.tokenHash, hashToken(token)), gt(companyInvitationsTable.expiresAt, new Date()), isNull(companyInvitationsTable.acceptedAt), isNull(companyInvitationsTable.revokedAt))).limit(1);
  if (!invitation || normalizeEmail(invitation.invitation.email) !== normalizeEmail(req.userEmail ?? "")) {
    res.status(404).json({ error: "Приглашение недействительно, истекло или отправлено на другой email." }); return;
  }
  res.json({ companyName: invitation.companyName, email: invitation.invitation.email, role: invitation.invitation.role });
});

router.post("/workspace/invitations/:token/accept", async (req, res, next) => {
  try {
    const token = req.params.token;
    if (token.length > 256 || normalizeEmail(req.userEmail ?? "") === "") { res.status(404).json({ error: "Приглашение недействительно." }); return; }
    const hash = hashToken(token);
    await db.transaction(async (tx) => {
      const [invitation] = await tx.select().from(companyInvitationsTable).where(and(
        eq(companyInvitationsTable.tokenHash, hash), gt(companyInvitationsTable.expiresAt, new Date()),
        isNull(companyInvitationsTable.acceptedAt), isNull(companyInvitationsTable.revokedAt),
      )).limit(1);
      if (!invitation || normalizeEmail(invitation.email) !== normalizeEmail(req.userEmail ?? "")) throw new Error("INVITATION_INVALID");
      await tx.insert(companyMembershipsTable).values({
        companyId: invitation.companyId, userId: userId(req), role: invitation.role,
        sections: invitation.sections, storeAccess: invitation.storeAccess,
        canSeeFinance: invitation.canSeeFinance, canEditCogs: invitation.canEditCogs,
        canApprovePrices: invitation.canApprovePrices, canIssueTasks: invitation.canIssueTasks,
        tokenLimit: invitation.tokenLimit,
      });
      const [consumed] = await tx.update(companyInvitationsTable).set({ acceptedAt: new Date() }).where(and(
        eq(companyInvitationsTable.id, invitation.id), isNull(companyInvitationsTable.acceptedAt), isNull(companyInvitationsTable.revokedAt),
      )).returning({ id: companyInvitationsTable.id });
      if (!consumed) throw new Error("INVITATION_INVALID");
      if (req.sessionId) await tx.update(sessionsTable).set({ activeCompanyId: invitation.companyId }).where(eq(sessionsTable.id, req.sessionId));
    });
    res.json({ accepted: true });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_INVALID") { res.status(404).json({ error: "Приглашение недействительно, истекло или отправлено на другой email." }); return; }
    next(error);
  }
});

router.delete("/workspace/invitations/:id", async (req, res, next) => {
  try {
    if (!isAdmin(req)) { res.status(403).json({ error: "Недостаточно прав." }); return; }
    const [revoked] = await db.update(companyInvitationsTable).set({ revokedAt: new Date() }).where(and(
      eq(companyInvitationsTable.id, req.params.id), eq(companyInvitationsTable.companyId, companyId(req)),
      isNull(companyInvitationsTable.acceptedAt), isNull(companyInvitationsTable.revokedAt),
    )).returning({ id: companyInvitationsTable.id });
    if (!revoked) { res.status(404).json({ error: "Приглашение не найдено." }); return; }
    res.sendStatus(204);
  } catch (error) { next(error); }
});

router.delete("/workspace/members/:userId", async (req, res, next) => {
  try {
    if (!isAdmin(req)) { res.status(403).json({ error: "Недостаточно прав." }); return; }
    if (req.params.userId === userId(req)) { res.status(400).json({ error: "Нельзя удалить себя из активной компании." }); return; }
    const [target] = await db.select({ role: companyMembershipsTable.role }).from(companyMembershipsTable).where(and(
      eq(companyMembershipsTable.companyId, companyId(req)), eq(companyMembershipsTable.userId, req.params.userId),
    )).limit(1);
    if (!target || target.role === "owner" || (target.role === "admin" && req.companyRole !== "owner")) { res.status(404).json({ error: "Участник не найден или недостаточно прав." }); return; }
    await db.delete(companyMembershipsTable).where(and(eq(companyMembershipsTable.companyId, companyId(req)), eq(companyMembershipsTable.userId, req.params.userId)));
    res.sendStatus(204);
  } catch (error) { next(error); }
});

export default router;
