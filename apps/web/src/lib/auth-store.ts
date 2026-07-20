import { create } from 'zustand'

type AuthUser = {
  id: string
  email: string
  fullName: string
  companyId: string
  roles: string[]
  firstLoginRequired: boolean
}

type AuthState = {
  accessToken: string | null
  user: AuthUser | null
  permissions: string[]
  activeRole: string | null

  setAuth: (token: string, user: AuthUser) => void
  setPermissions: (perms: string[]) => void
  setActiveRole: (role: string) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  permissions: [],
  activeRole: null,

  setAuth: (accessToken, user) =>
    set({
      accessToken,
      user,
      activeRole: user.roles[0] ?? null,
    }),

  setPermissions: (permissions) => set({ permissions }),

  setActiveRole: (activeRole) => set({ activeRole }),

  clear: () =>
    set({
      accessToken: null,
      user: null,
      permissions: [],
      activeRole: null,
    }),
}))

export { type AuthUser }
