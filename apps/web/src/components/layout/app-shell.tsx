import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/lib/auth-store'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  ClipboardCheck,
  LogOut,
  Shield,
} from 'lucide-react'
import { RoleSwitcher } from './role-switcher'

const navItems: { label: string; href: string; icon: React.ElementType; roles: string[] }[] = [
  { label: 'Overview',       href: '/dashboard',              icon: LayoutDashboard,  roles: [] },
  { label: 'SPV',            href: '/dashboard/spv',           icon: ClipboardList,    roles: ['SPV_OUTLET', 'STAFF', 'FREELANCE'] },
  { label: 'Executive',      href: '/dashboard/executive',     icon: Shield,           roles: ['SUPER_ADMIN', 'ERP_OWNER', 'DIREKSI', 'MANAGER'] },
  { label: 'Inventory',      href: '/dashboard/inventory',     icon: Package,          roles: ['MANAGER', 'DIREKSI', 'ERP_OWNER', 'SUPER_ADMIN'] },
  { label: 'Approval Queue',  href: '/dashboard/approval-queue', icon: ClipboardCheck, roles: ['MANAGER', 'DIREKSI', 'AUDITOR', 'ERP_OWNER', 'SUPER_ADMIN'] },
]

type Props = { children: ReactNode }

export function AppShell({ children }: Props) {
  const { user, activeRole, clear } = useAuthStore()
  const navigate = useNavigate()

  function visibleNavItems() {
    if (!activeRole) return []
    return navItems.filter((item) => item.roles.length === 0 || item.roles.includes(activeRole))
  }

  function handleLogout() {
    clear()
    navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--brand-dominant)' }}>
      {/* Brand gradient top bar */}
      <div className="fixed top-0 left-0 right-0 h-1 brand-gradient-animated z-50" />

      {/* Sidebar */}
      <aside
        className="group fixed left-0 top-0 h-full z-40 flex flex-col border-r border-gray-200 bg-white transition-all duration-300 w-14 hover:w-52"
      >
        <div className="flex items-center justify-center h-14 border-b border-gray-100">
          <span
            className="font-bold text-lg group-hover:block hidden transition-opacity duration-300"
            style={{ color: 'var(--brand-accent-1)' }}
          >
            EGG OS
          </span>
          <LayoutDashboard
            size={20}
            className="group-hover:hidden"
            style={{ color: 'var(--brand-accent-1)' }}
          />
        </div>

        <nav className="flex flex-col gap-1 p-2 mt-2 flex-1">
          {visibleNavItems().map((item) => {
            const isActive = window.location.pathname === item.href
            return (
              <button
                key={item.href}
                onClick={() => navigate({ to: item.href })}
                className={`flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors whitespace-nowrap overflow-hidden ${
                  isActive
                    ? 'font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                style={isActive ? { color: 'var(--brand-accent-1)', background: 'var(--brand-accent-1)15' } : {}}
              >
                <item.icon size={18} className="shrink-0" />
                <span className="group-hover:inline hidden opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {item.label}
                </span>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 ml-14 transition-all duration-300">
        {/* Top navbar */}
        <header className="flex items-center justify-between h-14 px-6 border-b border-gray-200 bg-white sticky top-1 z-30">
          <h2 className="text-sm font-medium text-gray-600">
            {user?.fullName}
          </h2>

          <div className="flex items-center gap-3">
            {activeRole && <Badge variant="outline" className="text-xs">{activeRole}</Badge>}
            <RoleSwitcher />
            <Separator orientation="vertical" className="h-5" />
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
              <LogOut size={16} />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
