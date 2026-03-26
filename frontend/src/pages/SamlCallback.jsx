import { useEffect } from 'react'

/**
 * Pagina di callback SAML — riceve il token JWT dal backend dopo l'autenticazione IdP.
 * Il backend redirige qui con ?token=<JWT> dopo aver validato la SAML assertion.
 * Questa pagina salva il token in localStorage e fa una hard redirect a / (home).
 * Non è protetta da ProtectedRoute: deve essere accessibile senza autenticazione.
 */
export default function SamlCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')

    if (!token) {
      window.location.replace('/login?error=saml_no_token')
      return
    }

    try {
      // Decodifica il payload JWT (base64url → base64 → JSON) senza verifica (la verifica è già avvenuta nel backend)
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const payload = JSON.parse(atob(b64))

      const user = {
        id:          payload.sub || payload.id,
        username:    payload.username,
        displayName: payload.display_name || payload.displayName || payload.username,
        role:        payload.role,
        permissions: typeof payload.permissions === 'string'
          ? JSON.parse(payload.permissions)
          : (payload.permissions || {}),
        source:       payload.source || 'saml',
        groups:       payload.groups || [],
        allowed_ports: typeof payload.allowed_ports === 'string'
          ? JSON.parse(payload.allowed_ports)
          : (payload.allowed_ports || []),
      }

      localStorage.setItem('jwt_token', token)
      localStorage.setItem('jwt_user', JSON.stringify(user))
      // Hard redirect per forzare il re-init di AuthContext dal localStorage
      window.location.replace('/')
    } catch {
      window.location.replace('/login?error=saml_invalid_token')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 gap-4">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">Autenticazione SAML in corso…</p>
    </div>
  )
}
