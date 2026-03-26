import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

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
      setError(err.response?.data?.error || 'Credenziali non valide')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

        {/* Header card — sfondo leggermente diverso dal body */}
        <div className="bg-gradient-to-br from-gray-800 to-slate-700 px-8 py-8 text-center">
          <img src="/logo.svg" alt="GB SMS Gateway" className="w-14 h-14 mx-auto mb-3 drop-shadow-lg" />
          <h1 className="text-white text-xl font-bold tracking-wide">GB SMS Gateway</h1>
          <p className="text-slate-300 text-xs mt-1">Accedi per continuare</p>
        </div>

        {/* Form */}
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
            {loading ? 'Accesso in corso...' : 'Accedi'}
          </button>

          {samlEnabled && (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs text-gray-400">oppure</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
              <a href="/api/auth/saml/login"
                className="block w-full text-center border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Accedi con SSO aziendale (SAML)
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
    </div>
  )
}
