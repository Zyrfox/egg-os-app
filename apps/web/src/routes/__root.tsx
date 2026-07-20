import { createRootRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth-store'

export const Route = createRootRoute({
  component: RootLayout,
  beforeLoad: ({ location }) => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken && location.pathname !== '/login') {
      throw redirect({ to: '/login' })
    }
  },
})

function RootLayout() {
  return <Outlet />
}
