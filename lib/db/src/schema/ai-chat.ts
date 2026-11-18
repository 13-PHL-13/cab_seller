import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./workspace";
import { usersTable } from "./auth";

export const aiConversationsTable = pgTable("ai_conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Новый диалог"),
  context: text("context").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("ai_conversations_company_updated_idx").on(table.companyId, table.updatedAt)]);

export const aiMessagesTable = pgTable("ai_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => aiConversationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("ai_messages_conversation_created_idx").on(table.conversationId, table.createdAt)]);
