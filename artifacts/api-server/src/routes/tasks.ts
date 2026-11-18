import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, companyMembershipsTable, companyTaskMessagesTable, companyTasksTable, usersTable } from "@workspace/db";
import { requireUser } from "../middlewares/requireUser";
import { requireCompanySection } from "../middlewares/requireCompanyAccess";

const router: IRouter = Router();
router.use("/tasks", requireUser, requireCompanySection("tasks"));
const STATUSES = new Set(["open", "in_progress", "review", "completed", "archived"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const canIssue = (req: import("express").Request) => req.companyRole === "owner" || req.companyRole === "admin" || Boolean(req.companyPermissions?.canIssueTasks);

router.get("/tasks", async (req, res, next) => {
  try {
    const rows = await db.select({ task: companyTasksTable, assigneeEmail: usersTable.email })
      .from(companyTasksTable).leftJoin(usersTable, eq(usersTable.id, companyTasksTable.assigneeUserId))
      .where(eq(companyTasksTable.companyId, req.companyId!)).orderBy(desc(companyTasksTable.updatedAt));
    const ids = rows.map(({ task }) => task.id);
    const messages = ids.length ? await db.select({ message: companyTaskMessagesTable, authorEmail: usersTable.email })
      .from(companyTaskMessagesTable).innerJoin(usersTable, eq(usersTable.id, companyTaskMessagesTable.authorUserId))
      .where(inArray(companyTaskMessagesTable.taskId, ids)).orderBy(companyTaskMessagesTable.createdAt) : [];
    const byTask = new Map<string, typeof messages>();
    for (const item of messages) byTask.set(item.message.taskId, [...(byTask.get(item.message.taskId) ?? []), item]);
    res.json({ tasks: rows.map(({ task, assigneeEmail }) => ({ ...task, assigneeEmail, messages: (byTask.get(task.id) ?? []).map(({ message, authorEmail }) => ({ ...message, authorEmail })) })) });
  } catch (error) { next(error); }
});

router.post("/tasks", async (req, res, next) => {
  try {
    if (!canIssue(req)) { res.status(403).json({ error: "У вашей роли нет права ставить задачи." }); return; }
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 180) : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 8000) : "";
    const priority = PRIORITIES.has(req.body?.priority) ? req.body.priority as string : "normal";
    const dueDate = typeof req.body?.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate) ? req.body.dueDate : null;
    const assigneeUserId = typeof req.body?.assigneeUserId === "string" ? req.body.assigneeUserId : null;
    if (!title) { res.status(400).json({ error: "Укажите название задачи." }); return; }
    if (assigneeUserId) {
      const [member] = await db.select({ userId: companyMembershipsTable.userId }).from(companyMembershipsTable)
        .where(and(eq(companyMembershipsTable.companyId, req.companyId!), eq(companyMembershipsTable.userId, assigneeUserId))).limit(1);
      if (!member) { res.status(400).json({ error: "Исполнитель не состоит в этой компании." }); return; }
    }
    const [task] = await db.insert(companyTasksTable).values({
      companyId: req.companyId!, title, description, priority: priority as typeof companyTasksTable.$inferInsert.priority,
      dueDate, assigneeUserId, createdBy: req.userId!,
    }).returning();
    await db.insert(companyTaskMessagesTable).values({ taskId: task.id, authorUserId: req.userId!, body: "Создана задача", type: "status" });
    res.status(201).json(task);
  } catch (error) { next(error); }
});

router.patch("/tasks/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const [current] = await db.select().from(companyTasksTable).where(and(eq(companyTasksTable.id, id), eq(companyTasksTable.companyId, req.companyId!))).limit(1);
    if (!current) { res.status(404).json({ error: "Задача не найдена." }); return; }
    const update: Partial<typeof companyTasksTable.$inferInsert> = { updatedAt: new Date() };
    if (req.body?.status !== undefined) {
      const status = String(req.body.status);
      if (!STATUSES.has(status)) { res.status(400).json({ error: "Неизвестный статус задачи." }); return; }
      if (!canIssue(req) && current.assigneeUserId !== req.userId) { res.status(403).json({ error: "Менять статус может только исполнитель или руководитель." }); return; }
      update.status = status as typeof update.status;
      await db.insert(companyTaskMessagesTable).values({ taskId: id, authorUserId: req.userId!, body: `Статус: ${status}`, type: "status" });
    }
    if (req.body?.assigneeUserId !== undefined) {
      if (!canIssue(req)) { res.status(403).json({ error: "Передавать задачу может только руководитель." }); return; }
      const assignee = req.body.assigneeUserId === null ? null : String(req.body.assigneeUserId);
      if (assignee) {
        const [member] = await db.select({ userId: companyMembershipsTable.userId }).from(companyMembershipsTable).where(and(
          eq(companyMembershipsTable.companyId, req.companyId!), eq(companyMembershipsTable.userId, assignee),
        )).limit(1);
        if (!member) { res.status(400).json({ error: "Исполнитель не состоит в этой компании." }); return; }
      }
      update.assigneeUserId = assignee;
      await db.insert(companyTaskMessagesTable).values({ taskId: id, authorUserId: req.userId!, body: assignee ? "Задача передана сотруднику" : "Исполнитель снят", type: "assignment" });
    }
    const [task] = await db.update(companyTasksTable).set(update).where(and(eq(companyTasksTable.id, id), eq(companyTasksTable.companyId, req.companyId!))).returning();
    res.json(task);
  } catch (error) { next(error); }
});

router.post("/tasks/:id/messages", async (req, res, next) => {
  try {
    const id = req.params.id;
    const [task] = await db.select({ id: companyTasksTable.id }).from(companyTasksTable).where(and(eq(companyTasksTable.id, id), eq(companyTasksTable.companyId, req.companyId!))).limit(1);
    const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 4000) : "";
    if (!task) { res.status(404).json({ error: "Задача не найдена." }); return; }
    if (!body) { res.status(400).json({ error: "Введите комментарий." }); return; }
    const [message] = await db.insert(companyTaskMessagesTable).values({ taskId: id, authorUserId: req.userId!, body }).returning();
    res.status(201).json(message);
  } catch (error) { next(error); }
});

export default router;
