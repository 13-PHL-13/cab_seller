import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const marketplaceConnectionsTable = pgTable(
  "marketplace_connections",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    marketplace: text("marketplace").notNull(),
    storeName: text("store_name").notNull(),
    credentialsCiphertext: text("credentials_ciphertext").notNull(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("marketplace_connections_owner_marketplace_unique").on(
      table.ownerId,
      table.marketplace,
    ),
    index("marketplace_connections_owner_idx").on(table.ownerId),
  ],
);

export type MarketplaceConnection =
  typeof marketplaceConnectionsTable.$inferSelect;
