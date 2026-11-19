import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./workspace";
import { usersTable } from "./auth";

export type CompanyTaskStatus = "open" | "in_progress" | "review" | "revision" | "completed" | "archived";
export type CompanyTaskPriority = "low" | "normal" | "high" | "urgent";

export const companyTasksTable = pgTable("company_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").$type<CompanyTaskStatus>().notNull().default("open"),
  priority: text("priority").$type<CompanyTaskPriority>().notNull().default("normal"),
  dueDate: text("due_date"),
  dueTime: text("due_time"),
  delegators: text("delegators").array().notNull().default([]),
  context: jsonb("context").$type<{ section: string; stores: string; period: string } | null>(),
  assigneeUserId: uuid("assignee_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const companyTaskMessagesTable = pgTable("company_task_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull().references(() => companyTasksTable.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  type: text("type").notNull().default("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("company_task_messages_task_created_idx").on(table.taskId, table.createdAt)]);

export type CompanyTask = typeof companyTasksTable.$inferSelect;
