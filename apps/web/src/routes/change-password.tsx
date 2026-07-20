import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/change-password')({
  component: ChangePasswordPage,
})

function ChangePasswordPage() {
  const { user, clear } = useAuthStore()

  function handleLogout() {
    clear()
    throw redirect({ to: '/login' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-dominant)]">
      <div className="max-w-md text-center space-y-4">
        <div className="brand-gradient-animated h-2 rounded-t-xl" />
        <div className="bg-white rounded-xl shadow-lg p-8 space-y-4">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--brand-accent-1)' }}>
            Ganti Password Diperlukan
          </h1>
          <p className="text-gray-500">
            Hai {user?.fullName}, akun Anda memerlukan penggantian password sebelum melanjutkan.
          </p>
          <p className="text-gray-400 text-sm">
            Halaman ini akan tersedia di sprint berikutnya.
          </p>
          <Button onClick={handleLogout} variant="outline" className="w-full">
            Kembali ke Login
          </Button>
        </div>
      </div>
    </div>
  )
}
