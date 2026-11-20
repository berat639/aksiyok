'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

export interface ClinicEntitlements {
  planId: 'demo' | 'pro' | 'kurumsal'
  planName: string
  planStatus: 'trial' | 'active' | 'past_due' | 'canceled' | 'expired'
  trialEndsAt: string | null
  trialDaysRemaining: number | null
  currentPeriodEnd: string | null
  maxUsers: number
  activeUsersCount: number
  pendingInvitesCount: number
  adminOnlyUsers: boolean
  isTrialExpired: boolean
  isReadOnly: boolean
  allowedTabs: string[]
  features: {
    webAssistant: boolean
    inboundCalls: boolean
    outboundCalls: boolean
    whatsapp: boolean
    staffModule: boolean
    financeModule: boolean
    inventoryModule: boolean
    vipAssistant: boolean
    customGeminiKey: boolean
  }
  dailyAiCallLimit: number
  iyzicoConfigured: boolean
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
  clinicId: string
  hostname: string
  businessTemplate?: 'general' | 'dental_clinic'
  isPlatformAdmin: boolean
  canManagePlatform: boolean
  plan?: ClinicEntitlements
}

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
  refreshUser: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const refreshUser = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' })
      if (!r.ok) return
      const data = await r.json()
      if (data && !data.error) setUser(data)
    } catch {
      // Yoksay
    }
  }, [])

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))
    const handleRefresh = () => { void refreshUser() }
    window.addEventListener('auth-user-refresh', handleRefresh)
    return () => window.removeEventListener('auth-user-refresh', handleRefresh)
  }, [refreshUser])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    router.push('/login')
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
