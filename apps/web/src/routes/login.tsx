import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { applyBrandTheme } from '@/lib/brand-theme'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/login')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/login') return
  },
  component: LoginPage,
})

function LoginPage() {
  const { accessToken } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (accessToken) {
    throw redirect({ to: '/dashboard' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const loginRes = await api.post('/auth/login', { email, password })
      const { accessToken, user } = loginRes.data.data

      useAuthStore.getState().setAuth(accessToken, user)

      const permsRes = await api.get('/auth/me/permissions')
      useAuthStore.getState().setPermissions(permsRes.data.data)

      applyBrandTheme(null)

      if (user.firstLoginRequired) {
        throw redirect({ to: '/change-password' })
      }
      throw redirect({ to: '/dashboard' })
    } catch (err: unknown) {
      if (err instanceof Error && 'redirect' in err) throw err

      const detail = (err as { response?: { data?: { error?: { code?: string; message?: string } }; status?: number } })?.response

      if (detail?.status === 401) {
        setError('Email atau password salah')
      } else if (detail?.data?.error?.code === 'ERR_USER_INACTIVE') {
        setError('Akun tidak aktif, hubungi administrator')
      } else if (detail?.status === 429) {
        setError('Terlalu banyak percobaan. Coba lagi nanti.')
      } else if (!detail) {
        setError('Tidak dapat terhubung ke server')
      } else {
        setError(detail.data?.error?.message ?? 'Login gagal')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-dominant)]">
      <Card className="w-full max-w-md shadow-lg border-0 rounded-xl">
        <div className="brand-gradient-animated h-2 rounded-t-xl" />
        <CardHeader className="pt-8">
          <CardTitle className="text-2xl font-semibold text-center" style={{ color: 'var(--brand-accent-1)' }}>
            EGG OS
          </CardTitle>
          <CardDescription className="text-center text-gray-500 mt-1">
            Masuk untuk melanjutkan
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="nama@perusahaan.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={loading}
              className="w-full brand-gradient-animated text-white font-medium"
            >
              {loading ? 'Memproses...' : 'Masuk'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
