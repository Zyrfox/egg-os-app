import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './auth'
import { companies } from './core'

const nullScopeId = sql`'00000000-0000-0000-0000-000000000000'::uuid`
const scopeTypes = sql`('global', 'company', 'brand', 'outlet', 'department', 'own', 'assigned', 'audit_view')`

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: varchar('code', { length: 100 }).notNull(),
  module: varchar('module', { length: 50 }).notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeUq: uniqueIndex('permissions_code_uq').on(t.code),
  moduleIdx: index('permissions_module_idx').on(t.module),
}))

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  defaultScopeType: varchar('default_scope_type', { length: 20 }).notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  defaultScopeTypeCheck: check('roles_default_scope_type_check', sql`${t.defaultScopeType} IN ${scopeTypes}`),
  companyCodeUq: uniqueIndex('roles_company_code_uq').on(t.companyId, t.code),
  companyIdx: index('roles_company_idx').on(t.companyId),
}))

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  rolePermissionUq: uniqueIndex('role_permissions_uq').on(t.roleId, t.permissionId),
  roleIdx: index('role_permissions_role_idx').on(t.roleId),
  companyIdx: index('role_permissions_company_idx').on(t.companyId),
}))

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  scopeType: varchar('scope_type', { length: 20 }).notNull(),
  scopeId: uuid('scope_id'),
  grantedBy: uuid('granted_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  scopeTypeCheck: check('user_roles_scope_type_check', sql`${t.scopeType} IN ${scopeTypes}`),
  userRoleUq: uniqueIndex('user_roles_active_scope_uq')
    .on(t.companyId, t.userId, t.roleId, t.scopeType, sql`coalesce(${t.scopeId}, ${nullScopeId})`)
    .where(sql`${t.deletedAt} IS NULL`),
  userIdx: index('user_roles_user_idx').on(t.userId),
  companyIdx: index('user_roles_company_idx').on(t.companyId),
  roleIdx: index('user_roles_role_idx').on(t.roleId),
}))

export const accessOverrides = pgTable('access_overrides', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  effect: varchar('effect', { length: 10 }).notNull(),
  scopeType: varchar('scope_type', { length: 20 }).notNull(),
  scopeId: uuid('scope_id'),
  reason: text('reason'),
  grantedBy: uuid('granted_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  effectCheck: check('access_overrides_effect_check', sql`${t.effect} IN ('grant', 'deny')`),
  scopeTypeCheck: check('access_overrides_scope_type_check', sql`${t.scopeType} IN ${scopeTypes}`),
  accessOverrideUq: uniqueIndex('access_overrides_active_scope_uq')
    .on(t.companyId, t.userId, t.permissionId, t.scopeType, sql`coalesce(${t.scopeId}, ${nullScopeId})`)
    .where(sql`${t.deletedAt} IS NULL`),
  userIdx: index('access_overrides_user_idx').on(t.userId),
  companyIdx: index('access_overrides_company_idx').on(t.companyId),
  permissionIdx: index('access_overrides_permission_idx').on(t.permissionId),
  expiresAtIdx: index('access_overrides_expires_at_idx').on(t.expiresAt),
}))
