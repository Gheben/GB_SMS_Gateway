import { useState, useCallback, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Sent from './pages/Sent'
import SendSMS from './pages/SendSMS'
import Ports from './pages/Ports'
import Devices from './pages/Devices'
import Rules from './pages/Rules'
import Settings from './pages/Settings'
import Report from './pages/Report'
import LoginPage from './pages/LoginPage'
import AccessDeniedPage from './pages/AccessDeniedPage'
import UsersPage from './pages/UsersPage'
import AuditLog from './pages/AuditLog'
import Contacts from './pages/Contacts'
import SamlCallback from './pages/SamlCallback'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useWebSocket } from './hooks/useWebSocket'
import { devicesApi } from './api'

function ProtectedRoute({ permKey, children }) {
  const { user, can } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (permKey && !can(permKey)) return (
    <div className="flex items-center justify-center h-full text-center p-8">
      <div>
        <p className="text-4xl mb-4">🔒</p>
        <p className="text-lg font-semibold text-gray-700">Accesso non autorizzato</p>
        <p className="text-sm text-gray-400 mt-1">Non hai i permessi per visualizzare questa sezione.</p>
      </div>
    </div>
  )
  return children
}

function AppShell() {
  const { user, logout, isApiOnly } = useAuth()
  const [connectedCount, setConnectedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem('sidebar_collapsed') === 'true'
  )

  function toggleSidebarCollapse() {
    setSidebarCollapsed(v => {
      localStorage.setItem('sidebar_collapsed', String(!v))
      return !v
    })
  }

  function refreshDeviceCounts() {
    devicesApi.getAll().then(list => {
      setTotalCount(list.length)
      setConnectedCount(list.filter(d => d.connected).length)
    }).catch(() => {})
  }

  useEffect(() => {
    if (!user) return
    refreshDeviceCounts()
    const interval = setInterval(refreshDeviceCounts, 30_000)
    return () => clearInterval(interval)
  }, [user])

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'devices:status') {
      setTotalCount(msg.total)
      setConnectedCount(msg.connected)
    }
    if (msg.type === 'device:connected' || msg.type === 'device:disconnected') {
      refreshDeviceCounts()
    }
  }, [])

  useWebSocket(handleWsMessage)

  if (isApiOnly) {
    const token = localStorage.getItem('jwt_token') || sessionStorage.getItem('jwt_token') || ''
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 max-w-lg w-full">
          <h1 className="text-xl font-bold text-gray-800 mb-1">Accesso API</h1>
          <p className="text-sm text-gray-500 mb-6">Il tuo account è configurato solo per l&apos;accesso via API.</p>
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-600 mb-1">Base URL</p>
            <code className="block bg-gray-100 rounded p-2 text-xs break-all">{window.location.origin}/api</code>
          </div>
          <div className="mb-6">
            <p className="text-xs font-semibold text-gray-600 mb-1">Bearer Token (JWT)</p>
            <code className="block bg-gray-100 rounded p-2 text-xs break-all">{token}</code>
          </div>
          <p className="text-xs text-gray-400 mb-4">Includi l&apos;header <code>Authorization: Bearer &lt;token&gt;</code> in ogni richiesta.</p>
          <button
            onClick={logout}
            className="text-sm text-red-500 hover:text-red-700 underline"
          >Disconnetti</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        connectedCount={connectedCount}
        totalCount={totalCount}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={logout}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: '12px' }} className="md:hidden flex items-center gap-3 px-4 bg-gray-900 text-white flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-300 hover:text-white" aria-label="Apri menu">
            <Menu size={22} />
          </button>
          <img src="/logo.svg" alt="" className="w-6 h-6" />
          <span className="text-sm font-bold">GB SMS Gateway</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Routes>
            <Route path="/" element={<ProtectedRoute permKey="dashboard"><Dashboard /></ProtectedRoute>} />
            <Route path="/inbox" element={<ProtectedRoute permKey="inbox"><Inbox /></ProtectedRoute>} />
            <Route path="/sent" element={<ProtectedRoute permKey="sent"><Sent /></ProtectedRoute>} />
            <Route path="/send" element={<ProtectedRoute permKey="send"><SendSMS /></ProtectedRoute>} />
            <Route path="/ports" element={<ProtectedRoute permKey="ports"><Ports /></ProtectedRoute>} />
            <Route path="/devices" element={<ProtectedRoute permKey="devices"><Devices /></ProtectedRoute>} />
            <Route path="/rules" element={<ProtectedRoute permKey="rules"><Rules /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute permKey="settings"><Settings /></ProtectedRoute>} />
            <Route path="/report" element={<ProtectedRoute permKey="report"><Report /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute permKey="users"><UsersPage /></ProtectedRoute>} />
            <Route path="/contacts" element={<ProtectedRoute permKey="users"><Contacts /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute><AuditLog /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/access-denied" element={<AccessDeniedPage />} />
          <Route path="/saml-callback" element={<SamlCallback />} />
          <Route path="/*" element={<RequireLogin />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

function RequireLogin() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <AppShell />
}
