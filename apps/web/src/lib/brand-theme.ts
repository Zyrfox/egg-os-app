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

export function applyBrandTheme(brandSlug: string | null) {
  const root = document.documentElement
  if (!brandSlug) {
    root.removeAttribute('data-brand')
  } else {
    root.setAttribute('data-brand', brandSlug)
  }
}
