import { z } from 'zod'

export const ScopeType = z.enum([
  'global',
  'company',
  'brand',
  'outlet',
  'department',
  'own',
  'assigned',
  'audit_view',
])

export const RoleCode = z.string().regex(/^[A-Z][A-Z0-9_]+$/, 'UPPERCASE_SNAKE')

export const PermissionCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'lowercase.dot 2-level')

const scopeTypesWithoutId = ['global', 'company', 'own', 'assigned', 'audit_view']

export const CreateRoleReq = z.object({
  code: RoleCode,
  name: z.string().min(1),
  description: z.string().optional(),
  default_scope_type: ScopeType,
})

export const UpdateRoleReq = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    default_scope_type: ScopeType.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'minimal satu field harus diisi',
  })

export const SetRolePermissionsReq = z.object({
  permission_codes: z
    .array(PermissionCode)
    .min(1)
    .refine((codes) => new Set(codes).size === codes.length, {
      message: 'permission_codes harus unik',
    }),
})

export const AssignRoleReq = z
  .object({
    role_id: z.string().uuid(),
    scope_type: ScopeType,
    scope_id: z.string().uuid().nullable(),
  })
  .refine(
    (value) =>
      scopeTypesWithoutId.includes(value.scope_type)
        ? value.scope_id === null
        : value.scope_id !== null,
    { message: 'scope_id wajib utk brand/outlet/department; harus null utk lainnya' }
  )

export const CreateOverrideReq = z
  .object({
    permission_code: PermissionCode,
    effect: z.enum(['grant', 'deny']),
    scope_type: ScopeType.default('company'),
    scope_id: z.string().uuid().nullable().default(null),
    reason: z.string().optional(),
    expires_at: z.string().datetime().optional(),
  })
  .refine(
    (value) =>
      scopeTypesWithoutId.includes(value.scope_type)
        ? value.scope_id === null
        : value.scope_id !== null,
    { message: 'scope_id wajib utk brand/outlet/department; harus null utk lainnya' }
  )

export const PermissionRes = z.object({
  id: z.string().uuid(),
  code: PermissionCode,
  module: z.string(),
  action: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
})

export const RoleRes = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  code: RoleCode,
  name: z.string(),
  description: z.string().nullable(),
  default_scope_type: ScopeType,
  is_system: z.boolean(),
  permissions: z.array(PermissionCode).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
})

export const UserRoleAssignmentRes = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  role_id: z.string().uuid(),
  role_code: RoleCode,
  scope_type: ScopeType,
  scope_id: z.string().uuid().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
})

export const AccessOverrideRes = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  permission_code: PermissionCode,
  effect: z.enum(['grant', 'deny']),
  scope_type: ScopeType,
  scope_id: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
})

export const MePermissionsRes = z.object({
  roles: z.array(z.string()),
  scopes: z.array(z.object({ scope_type: ScopeType, scope_id: z.string().uuid().nullable() })),
  permissions: z.array(PermissionCode),
})

export type CreateRoleInput = z.infer<typeof CreateRoleReq>
export type UpdateRoleInput = z.infer<typeof UpdateRoleReq>
export type SetRolePermissionsInput = z.infer<typeof SetRolePermissionsReq>
export type AssignRoleInput = z.infer<typeof AssignRoleReq>
export type CreateOverrideInput = z.infer<typeof CreateOverrideReq>
