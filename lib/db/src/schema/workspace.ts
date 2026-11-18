import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export type CompanyRole = "owner" | "admin" | "lead" | "employee";
export type StoreAccess = "all" | string[];

export const companiesTable = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("companies_owner_user_idx").on(table.ownerUserId)],
);

export const companyMembershipsTable = pgTable(
  "company_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").$type<CompanyRole>().notNull().default("employee"),
    sections: jsonb("sections").$type<string[]>().notNull().default(["dashboard", "marketplaces", "funnel", "analytics", "finance", "products"]),
    storeAccess: jsonb("store_access").$type<StoreAccess>().notNull().default("all"),
    canSeeFinance: boolean("can_see_finance").notNull().default(true),
    canEditCogs: boolean("can_edit_cogs").notNull().default(false),
    canApprovePrices: boolean("can_approve_prices").notNull().default(false),
    canIssueTasks: boolean("can_issue_tasks").notNull().default(false),
    tokenLimit: integer("token_limit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("company_memberships_company_user_unique").on(table.companyId, table.userId),
    index("company_memberships_user_idx").on(table.userId),
    index("company_memberships_company_role_idx").on(table.companyId, table.role),
  ],
);

export const companyInvitationsTable = pgTable(
  "company_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Exclude<CompanyRole, "owner">>().notNull().default("employee"),
    sections: jsonb("sections").$type<string[]>().notNull().default(["dashboard", "marketplaces", "funnel", "analytics", "products"]),
    storeAccess: jsonb("store_access").$type<StoreAccess>().notNull().default("all"),
    canSeeFinance: boolean("can_see_finance").notNull().default(false),
    canEditCogs: boolean("can_edit_cogs").notNull().default(false),
    canApprovePrices: boolean("can_approve_prices").notNull().default(false),
    canIssueTasks: boolean("can_issue_tasks").notNull().default(false),
    tokenLimit: integer("token_limit"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("company_invitations_token_hash_unique").on(table.tokenHash),
    index("company_invitations_company_email_idx").on(table.companyId, table.email),
    index("company_invitations_expires_idx").on(table.expiresAt),
  ],
);
