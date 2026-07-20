import { createRootRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth-store'
import { AppShell } from '@/components/layout/app-shell'

const publicPaths = ['/login', '/change-password']

export const Route = createRootRoute({
  component: RootLayout,
  beforeLoad: ({ location }) => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken && !publicPaths.includes(location.pathname)) {
      throw redirect({ to: '/login' })
    }
  },
})

function RootLayout() {
  const { accessToken } = useAuthStore()
  const isPublic = publicPaths.includes(window.location.pathname)

  if (isPublic || !accessToken) {
    return <Outlet />
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
