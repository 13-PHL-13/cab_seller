import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./workspace";

export const marketplaceConnectionsTable = pgTable(
  "marketplace_connections",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    marketplace: text("marketplace").notNull(),
    storeName: text("store_name").notNull(),
    credentialsCiphertext: text("credentials_ciphertext").notNull(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    analyticsRetryAt: timestamp("analytics_retry_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("marketplace_connections_company_marketplace_store_unique").on(
      table.companyId,
      table.marketplace,
      table.storeName,
    ),
    index("marketplace_connections_company_idx").on(table.companyId),
    index("marketplace_connections_owner_idx").on(table.ownerId),
  ],
);

export type MarketplaceConnection =
  typeof marketplaceConnectionsTable.$inferSelect;
