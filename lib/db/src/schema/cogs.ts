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
    characteristics: text("characteristics").notNull().default(""),
    unit: text("unit").notNull().default("шт."),
    countryOfOrigin: text("country_of_origin").notNull().default(""),
    brand: text("brand").notNull().default(""),
    salePrice: numeric("sale_price", { precision: 14, scale: 2 }).notNull().default("0"),
    description: text("description").notNull().default(""),
    images: text("images").notNull().default("[]"),
    videoUrl: text("video_url").notNull().default(""),
    publicationStatus: text("publication_status").notNull().default("draft"),
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

/** Marketplace-specific identity and publication state for a catalog product. */
export const cogsProductMarketplacesTable = pgTable(
  "cogs_product_marketplaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => cogsProductsTable.id, { onDelete: "cascade" }),
    marketplace: text("marketplace").notNull(),
    marketplaceSku: text("marketplace_sku").notNull().default(""),
    externalProductId: text("external_product_id").notNull().default(""),
    publicationStatus: text("publication_status").notNull().default("draft"),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),
    marketplaceData: text("marketplace_data").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("cogs_product_marketplaces_product_marketplace_unique").on(table.productId, table.marketplace),
    uniqueIndex("cogs_product_marketplaces_owner_marketplace_sku_unique").on(table.ownerId, table.marketplace, table.marketplaceSku),
    index("cogs_product_marketplaces_owner_idx").on(table.ownerId, table.marketplace),
  ],
);
