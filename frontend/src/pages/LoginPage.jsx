import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Coffee } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [samlEnabled, setSamlEnabled] = useState(false)

  useEffect(() => {
    fetch('/api/auth/saml/status')
      .then(r => r.json())
      .then(d => setSamlEnabled(!!d.enabled))
      .catch(() => {})
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

        {/* Header card */}
        <div className="bg-gradient-to-br from-gray-800 to-slate-700 px-8 py-8 text-center">
          <img src="/logo.svg" alt="GB SMS Gateway" className="w-14 h-14 mx-auto mb-3 drop-shadow-lg" />
          <h1 className="text-white text-xl font-bold tracking-wide">GB SMS Gateway</h1>
          <p className="text-slate-300 text-xs mt-1">Sign in to continue</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Username

            </label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="username"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          {samlEnabled && (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs text-gray-400">or</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
              <a href="/api/auth/saml/login"
                className="block w-full text-center border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Sign in with corporate SSO (SAML)
              </a>
            </>
          )}
        </form>
      </div>

      {/* Footer — visibile sullo sfondo scuro, fuori dalla card */}
      <p className="mt-8 text-slate-400 text-xs text-center">
        &copy; {new Date().getFullYear()} Powered by{' '}
        <span className="text-slate-200 font-semibold">Guido Ballarini</span>
      </p>
      <div className="mt-2 flex items-center justify-center gap-4">
        <a href="https://buymeacoffee.com/guidoballa9" target="_blank" rel="noreferrer"
          title="Buy me a coffee"
          className="text-slate-500 hover:text-yellow-400 transition-colors">
          <Coffee size={15} />
        </a>
        <a href="https://www.paypal.com/donate/?hosted_button_id=8RF28JBPLYASN" target="_blank" rel="noreferrer"
          title="PayPal"
          className="text-slate-500 hover:text-blue-400 transition-colors">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" />
          </svg>
        </a>
      </div>
    </div>
  )
}
