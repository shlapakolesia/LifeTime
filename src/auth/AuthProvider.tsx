import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export interface AuthIdentity {
  email: string
  firstName?: string
  lastName?: string
  isAdmin: boolean
}

export interface AuthAdapter {
  restore(): AuthIdentity | null
  signIn(identity: AuthIdentity): Promise<AuthIdentity>
  signOut(): Promise<void>
  getAccessToken(): Promise<string | null>
}

class LocalAuthAdapter implements AuthAdapter {
  private readonly key = 'lifetime:auth-session'
  restore() {
    try { return JSON.parse(sessionStorage.getItem(this.key) || 'null') as AuthIdentity | null } catch { return null }
  }
  async signIn(identity: AuthIdentity) {
    sessionStorage.setItem(this.key, JSON.stringify(identity))
    return identity
  }
  async signOut() { sessionStorage.removeItem(this.key) }
  async getAccessToken() { return null }
}

interface AuthContextValue {
  user: AuthIdentity | null
  isAuthenticated: boolean
  isLoading: boolean
  signInLocal(identity: AuthIdentity): Promise<void>
  signOut(): Promise<void>
  getAccessToken(): Promise<string | null>
}

const adapter: AuthAdapter = new LocalAuthAdapter()
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthIdentity | null>(() => adapter.restore())
  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: Boolean(user),
    isLoading: false,
    async signInLocal(identity) { setUser(await adapter.signIn(identity)) },
    async signOut() { await adapter.signOut(); setUser(null) },
    getAccessToken: () => adapter.getAccessToken(),
  }), [user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider missing')
  return context
}

export function ProtectedRoute({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : fallback
}
