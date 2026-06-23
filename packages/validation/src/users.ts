import { z } from 'zod'
import { AssignRoleReq, ScopeType } from './rbac'

export const UserStatus = z.enum(['invited', 'active', 'suspended', 'archived'])

export const InviteUserReq = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).max(150),
  phone: z.string().max(30).optional(),
  is_freelance: z.boolean().optional().default(false),
  freelance_expires_at: z.string().datetime().optional(),
  role: AssignRoleReq.optional(),
})

export const UpdateUserReq = z
  .object({
    full_name: z.string().min(1).max(150).optional(),
    phone: z.string().max(30).nullable().optional(),
  })
  .refine((value) => value.full_name !== undefined || value.phone !== undefined, {
    message: 'minimal satu field',
  })

export const AssignUserRoleReq = AssignRoleReq

export const ListUsersQuery = z.object({
  status: UserStatus.optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
})

export const PublicUserRole = z.object({
  assignment_id: z.string().uuid(),
  role_code: z.string(),
  scope_type: ScopeType,
  scope_id: z.string().uuid().nullable(),
})

export const PublicUserDetail = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  phone: z.string().nullable(),
  status: UserStatus,
  first_login_required: z.boolean(),
  is_freelance: z.boolean(),
  freelance_expires_at: z.string().datetime().nullable(),
  last_login_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  roles: z.array(PublicUserRole),
})

export type InviteUserInput = z.infer<typeof InviteUserReq>
export type UpdateUserInput = z.infer<typeof UpdateUserReq>
export type AssignUserRoleInput = z.infer<typeof AssignUserRoleReq>
export type ListUsersInput = z.infer<typeof ListUsersQuery>
export type UserStatusInput = z.infer<typeof UserStatus>
