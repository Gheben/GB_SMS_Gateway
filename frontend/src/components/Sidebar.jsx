import { NavLink } from 'react-router-dom'
import { LayoutDashboard, MessageSquare, Send, Radio, Server, GitBranch, Settings, BarChart2, X, Smartphone, Users, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const links = [
  { to: '/',        label: 'Dashboard',      icon: LayoutDashboard, perm: 'dashboard' },
  { to: '/inbox',   label: 'Ricevuti',       icon: MessageSquare,   perm: 'inbox' },
  { to: '/sent',    label: 'Inviati',        icon: Send,            perm: 'sent' },
  { to: '/send',    label: 'Invia SMS',      icon: Radio,           perm: 'send' },
  { to: '/report',  label: 'Report',         icon: BarChart2,       perm: 'report' },
  { divider: true },
  { to: '/devices', label: 'Dispositivi',    icon: Server,          perm: 'devices' },
  { to: '/ports',   label: 'Mappatura SIM',  icon: Smartphone,      perm: 'ports' },
  { to: '/rules',   label: 'Regole inoltro', icon: GitBranch,       perm: 'rules' },
  { to: '/settings',label: 'Impostazioni',   icon: Settings,        perm: 'settings' },
  { divider: true },
  { to: '/users',   label: 'Utenti',         icon: Users,           perm: 'users' },
]

export default function Sidebar({ connectedCount, totalCount, open, onClose, onLogout }) {
  const { user, can } = useAuth()

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-gray-900 text-white flex flex-col
        transform transition-transform duration-200 ease-in-out
        md:static md:translate-x-0 md:flex-shrink-0
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3">
          <img src="/logo.svg" alt="GB SMS Gateway logo" className="w-8 h-8 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-wide leading-tight">GB SMS Gateway</h1>
            <p className="text-xs text-gray-400 truncate">Yeastar TG Multi-Device</p>
          </div>
          <button onClick={onClose} className="ml-auto md:hidden text-gray-400 hover:text-white p-1" aria-label="Chiudi menu">
            <X size={18} />
          </button>
        </div>

        {/* Stato connessione */}
        <div className="px-4 py-3">
          <div className={`flex items-center gap-2 text-xs font-medium px-2 py-1 rounded ${connectedCount > 0 ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connectedCount > 0 ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
            {connectedCount}/{totalCount} dispositivi connessi
          </div>
        </div>

        {/* Navigazione */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {links.map((l, i) => {
            if (l.divider) return <div key={i} className="border-t border-gray-700 my-2" />
            if (!can(l.perm)) return null
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <l.icon size={17} className="flex-shrink-0" />
                {l.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer utente + logout */}
        <div className="px-3 py-3 border-t border-gray-700 space-y-1">
          {user && (
            <div className="px-3 py-1.5 text-xs text-gray-400 truncate">
              <span className="font-semibold text-gray-300">{user.username}</span>
              <span className="ml-2 opacity-60">({user.role})</span>
            </div>
          )}
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut size={17} className="flex-shrink-0" />
            Esci
          </button>
          <div className="px-3 py-1">
            <p className="text-[10px] text-gray-600 leading-snug truncate">
              v1.1 — Powered by <span className="text-gray-500 font-medium">Guido Ballarini</span> © {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </aside>
    </>
  )
}
