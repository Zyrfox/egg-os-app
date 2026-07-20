export const ROLE_HIERARCHY = [
  'SUPER_ADMIN', 'ERP_OWNER', 'DIREKSI',
  'MANAGER', 'SPV_OUTLET', 'AUDITOR',
  'STAFF', 'FREELANCE',
] as const

export const ROLE_TO_DASHBOARD: Record<string, string> = {
  SUPER_ADMIN: '/dashboard/executive',
  ERP_OWNER:   '/dashboard/executive',
  DIREKSI:     '/dashboard/executive',
  MANAGER:     '/dashboard/executive',
  SPV_OUTLET:  '/dashboard/spv',
  AUDITOR:     '/dashboard/approval-queue',
  STAFF:       '/dashboard/spv',
  FREELANCE:   '/dashboard/spv',
}

export const BRAND_THEME_MAP: Record<string, string> = {}

// TODO: isi UUID brand dari query database —
// SELECT id, brand_slug FROM brands WHERE company_id = 'EGG';
export const BRAND_SLUG_MAP: Record<string, string> = {
  'a88795bd-e15f-449d-ab42-9b1ca7e34c58': 'back-to-mie-forest',
  '4afe95bf-a2ea-443c-ad76-890c93c49cba': 'back-to-mie-kitchen',
  'd906f6cc-f526-4d6d-b023-43da337c86bc': 'taman-sari-forest',
}

export function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    ERP_OWNER: 'ERP Owner',
    DIREKSI: 'Direksi',
    MANAGER: 'Manager',
    SPV_OUTLET: 'Supervisor Outlet',
    AUDITOR: 'Auditor',
    STAFF: 'Staff',
    FREELANCE: 'Freelance',
  }
  return labels[role] ?? role
}

export function applyBrandTheme(brandSlug: string | null) {
  const root = document.documentElement
  if (!brandSlug) {
    root.removeAttribute('data-brand')
  } else {
    root.setAttribute('data-brand', brandSlug)
  }
}
