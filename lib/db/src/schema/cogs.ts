import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const cogsProductsTable = pgTable(
  "cogs_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    marketplace: text("marketplace").notNull().default("both"),
    sellerSku: text("seller_sku").notNull(),
    productName: text("product_name").notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("RUB"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("cogs_products_owner_marketplace_sku_unique").on(table.ownerId, table.marketplace, table.sellerSku),
    index("cogs_products_owner_idx").on(table.ownerId),
  ],
);

export const cogsCostHistoryTable = pgTable(
  "cogs_cost_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => cogsProductsTable.id, { onDelete: "cascade" }),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cogs_cost_history_owner_product_idx").on(table.ownerId, table.productId, table.effectiveAt),
  ],
);
