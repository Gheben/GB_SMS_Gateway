import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { authApi } from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('jwt_user'))
      if (!stored) return null
      // Decode the JWT payload to get fresh data (no signature needed on frontend)
      const token = localStorage.getItem('jwt_token')
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        return {
          ...stored,
          displayName: payload.displayName || stored.displayName || stored.username,
          allowed_ports: payload.allowed_ports || stored.allowed_ports || [],
          permissions: payload.permissions || stored.permissions || {},
          role: payload.role || stored.role,
        }
      }
      return stored
    } catch { return null }
  })
  const [ssoChecked, setSsoChecked] = useState(false)

  // Prova SSO automatico all'avvio se l'utente non è già loggato
  useEffect(() => {
    if (user) { setSsoChecked(true); return }
    authApi.sso()
      .then(({ token, user: u }) => {
        localStorage.setItem('jwt_token', token)
        localStorage.setItem('jwt_user', JSON.stringify(u))
        setUser(u)
      })
      .catch(() => { /* SSO non disponibile o non configurato */ })
      .finally(() => setSsoChecked(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username, password) => {
    const { token, user: u } = await authApi.login(username, password)
    localStorage.setItem('jwt_token', token)
    localStorage.setItem('jwt_user', JSON.stringify(u))
    setUser(u)
    return u
  }, [])

  /** Aggiorna il token in background e sincronizza i permessi nella UI */
  const refreshUser = useCallback(async () => {
    try {
      const { token } = await authApi.refreshToken()
      localStorage.setItem('jwt_token', token)
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      setUser(prev => prev ? {
        ...prev,
        role: payload.role,
        permissions: payload.permissions || {},
        allowed_ports: payload.allowed_ports || [],
        displayName: payload.displayName || prev.displayName,
      } : prev)
    } catch (err) {
      // Se il token è scaduto, facciamo un logout pulito senza hard-redirect
      if (err.response?.status === 401) {
        localStorage.removeItem('jwt_token')
        localStorage.removeItem('jwt_user')
        setUser(null)
      }
      // Tutti gli altri errori (rete, 500, ecc.) vengono ignorati silenziosamente
    }
  }, [])

  // Polling ogni 60 secondi per aggiornare permessi senza re-login
  useEffect(() => {
    if (!user) return
    const id = setInterval(refreshUser, 60_000)
    return () => clearInterval(id)
  }, [user, refreshUser])

  const logout = useCallback(() => {
    localStorage.removeItem('jwt_token')
    localStorage.removeItem('jwt_user')
    setUser(null)
  }, [])

  /** Controlla se l'utente ha il permesso per una chiave specifica */
  const can = useCallback((key) => {
    if (!user) return false
    if (user.role === 'superadmin' || user.role === 'admin') return true
    return !!user.permissions?.[key]
  }, [user])

  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin'

  /**
   * Utente con solo permesso API (nessuna pagina UI abilitata).
   * Può usare le API via token ma non ha accesso all'interfaccia.
   */
  const isApiOnly = !!(user && user.role === 'user' && user.permissions?.api === true
    && !Object.entries(user.permissions).some(([k, v]) => k !== 'api' && v === true))

  // Mostra spinner mentre verifico l'SSO per non fare flash della login page
  if (!ssoChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, can, isAdmin, isApiOnly }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
