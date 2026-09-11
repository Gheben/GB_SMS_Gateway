import { ShieldOff } from 'lucide-react'

/**
 * Standalone public page shown when a SAML-authenticated user is denied access
 * because they do not belong to any mapped LDAP group and
 * `require_group_match` is enabled in the SAML configuration.
 *
 * Route: /access-denied  (public — no auth required)
 */
export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header — same style as LoginPage */}
        <div className="bg-gradient-to-br from-gray-800 to-slate-700 px-8 py-8 text-center">
          <img src="/logo.svg" alt="GB SMS Gateway" className="w-14 h-14 mx-auto mb-3 drop-shadow-lg" />
          <h1 className="text-white text-xl font-bold tracking-wide">GB SMS Gateway</h1>
          <p className="text-slate-300 text-xs mt-1">Access control</p>
        </div>

        {/* Body */}
        <div className="px-8 py-10 flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            <ShieldOff size={32} className="text-red-500" />
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-bold text-gray-800">Access Denied</h2>
            <p className="text-sm text-gray-500">
              Your account was successfully authenticated, but you are not
              authorised to access this application.
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 w-full text-left">
            <p className="text-xs text-amber-700">
              <strong>What does this mean?</strong><br />
              Your Identity Provider (SSO) confirmed your identity, but your account
              does not belong to any group that is allowed to use GB SMS Gateway.
            </p>
          </div>

          <p className="text-sm text-gray-600">
            Please contact your <strong>system administrator</strong> to request access.
          </p>

          <a
            href="/login?local"
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            ← Back to login
          </a>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-8 text-slate-400 text-xs text-center">
        &copy; {new Date().getFullYear()} Powered by{' '}
        <span className="text-slate-200 font-semibold">Guido Ballarini</span>
      </p>
    </div>
  )
}
