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
import UsersPage from './pages/UsersPage'
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
  const { user, logout } = useAuth()
  const [connectedCount, setConnectedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function refreshDeviceCounts() {
    devicesApi.getAll().then(list => {
      setTotalCount(list.length)
      setConnectedCount(list.filter(d => d.connected).length)
    }).catch(() => {})
  }

  useEffect(() => { if (user) refreshDeviceCounts() }, [user])

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

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        connectedCount={connectedCount}
        totalCount={totalCount}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={logout}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-gray-900 text-white flex-shrink-0">
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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
