import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth-store'
import { ROLE_TO_DASHBOARD } from '@/lib/brand-theme'

export const Route = createFileRoute('/dashboard/')({
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken) throw redirect({ to: '/login' })
  },
  component: DashboardIndex,
})

function DashboardIndex() {
  const { activeRole } = useAuthStore()
  const target = activeRole ? ROLE_TO_DASHBOARD[activeRole] : '/dashboard/spv'
  throw redirect({ to: target ?? '/dashboard/spv' })
}
