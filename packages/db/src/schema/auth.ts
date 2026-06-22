// packages/db/src/schema/auth.ts
import { pgTable, uuid, varchar, boolean, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  fullName: varchar("full_name", { length: 150 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  passwordHash: varchar("password_hash", { length: 255 }),         // null sampai password di-set
  status: varchar("status", { length: 20 }).notNull().default("invited"), // invited|active|suspended|archived
  firstLoginRequired: boolean("first_login_required").notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  isFreelance: boolean("is_freelance").notNull().default(false),
  freelanceExpiresAt: timestamp("freelance_expires_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  emailUq: uniqueIndex("users_company_email_uq").on(t.companyId, sql`lower(${t.email})`),
  companyIdx: index("users_company_idx").on(t.companyId),
  statusIdx: index("users_status_idx").on(t.status),
}));

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),       // sha-256 hex of the opaque token
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by"),                                  // rotation chain
  userAgent: varchar("user_agent", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: index("refresh_token_hash_idx").on(t.tokenHash),
  userIdx: index("refresh_token_user_idx").on(t.userId),
}));

export const passwordTokens = pgTable("password_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),       // sha-256 hex, single-use
  type: varchar("type", { length: 20 }).notNull(),                  // set_password|reset_password
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: index("password_token_hash_idx").on(t.tokenHash),
  userIdx: index("password_token_user_idx").on(t.userId),
}));

export const authEvents = pgTable("auth_events", {                  // APPEND ONLY
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id"),
  userId: uuid("user_id"),                                          // null jika email tak dikenal
  eventType: varchar("event_type", { length: 40 }).notNull(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 255 }),
  detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("auth_event_user_idx").on(t.userId),
  createdIdx: index("auth_event_created_idx").on(t.createdAt),
}));
