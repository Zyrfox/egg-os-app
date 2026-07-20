import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth-store'

export const Route = createFileRoute('/dashboard/inventory')({
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken) throw redirect({ to: '/login' })
  },
  component: InventoryDashboard,
})

function InventoryDashboard() {
  const { user, activeRole } = useAuthStore()
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-accent-1)' }}>
        Dashboard Inventory
      </h1>
      <p className="text-gray-500 mt-2">
        Selamat datang, {user?.fullName}. Role aktif: {activeRole}.
      </p>
      <p className="text-gray-400 mt-1 text-sm">Data dashboard akan tersedia di F1-P2.</p>
    </div>
  )
}
