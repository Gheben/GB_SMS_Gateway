import { useEffect } from 'react'

/**
 * SAML callback page — receives the JWT token from the backend after IdP authentication.
 * The backend redirects here with ?token=<JWT> after validating the SAML assertion.
 * This page saves the token to localStorage and hard-redirects to / (home).
 * Not protected by ProtectedRoute: must be accessible without authentication.
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
      // Decode JWT payload (base64url → base64 → JSON) without verification (already verified by the backend)
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
      // Hard redirect to force AuthContext re-init from localStorage
      window.location.replace('/')
    } catch {
      window.location.replace('/login?error=saml_invalid_token')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 gap-4">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">SAML authentication in progress…</p>
    </div>
  )
}
