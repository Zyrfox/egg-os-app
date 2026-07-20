import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth-store'
import { getRoleLabel, ROLE_TO_DASHBOARD } from '@/lib/brand-theme'
import { applyBrandTheme } from '@/lib/brand-theme'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'

export function RoleSwitcher() {
  const { user, activeRole, setActiveRole } = useAuthStore()
  const navigate = useNavigate()

  if (!user || !user.roles.length) return null

  if (user.roles.length === 1) {
    return (
      <span className="text-xs text-gray-500 mr-2">
        {getRoleLabel(user.roles[0])}
      </span>
    )
  }

  function handleSwitch(role: string) {
    setActiveRole(role)
    applyBrandTheme(null)
    const target = ROLE_TO_DASHBOARD[role] ?? '/dashboard'
    navigate({ to: target })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <div className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer">
          {activeRole ? getRoleLabel(activeRole) : 'Role'}
          <ChevronDown size={12} />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {user.roles.map((role) => (
          <DropdownMenuItem
            key={role}
            onClick={() => handleSwitch(role)}
            className="text-sm cursor-pointer"
          >
            {getRoleLabel(role)}
            {role === activeRole && (
              <span className="ml-auto text-xs text-gray-400">active</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
