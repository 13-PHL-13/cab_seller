import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const sellerExpensesTable = pgTable(
  "seller_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    expenseDate: text("expense_date").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("seller_expenses_owner_date_idx").on(table.ownerId, table.expenseDate)],
);
