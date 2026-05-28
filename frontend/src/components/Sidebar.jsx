import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, MessageSquare, Send, Radio, Server, GitBranch, Settings, BarChart2, X, Smartphone, Users, LogOut, ClipboardList, BookOpen, Notebook, ChevronLeft, ChevronRight, UserCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const links = [
  { to: '/',        label: 'Dashboard',    icon: LayoutDashboard, perm: 'dashboard' },
  { to: '/inbox',   label: 'Inbox',        icon: MessageSquare,   perm: 'inbox' },
  { to: '/sent',    label: 'Sent',         icon: Send,            perm: 'sent' },
  { to: '/send',    label: 'Send SMS',     icon: Radio,           perm: 'send' },
  { to: '/report',  label: 'Reports',      icon: BarChart2,       perm: 'report' },
  { divider: true },
  { to: '/devices', label: 'Devices',      icon: Server,          perm: 'devices' },
  { to: '/ports',   label: 'SIM Mapping',  icon: Smartphone,      perm: 'ports' },
  { to: '/rules',   label: 'Forward Rules',icon: GitBranch,       perm: 'rules' },
  { to: '/settings',label: 'Settings',     icon: Settings,        perm: 'settings' },
  { divider: true },
  { to: '/users',   label: 'Users/Groups', icon: Users,           perm: 'users' },
  { to: '/contacts',label: 'Phonebook',    icon: Notebook,        perm: 'users' },
  { to: '/audit',   label: 'Audit Log',    icon: ClipboardList,   superadminOnly: true },
  { divider: true },
  { href: '/docs/',  label: 'API Docs',     icon: BookOpen,        perm: 'api' },
]

export default function Sidebar({ connectedCount, totalCount, open, onClose, onLogout, collapsed, onToggleCollapse }) {
  const { user, can } = useAuth()

  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = e => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Collapse only applies on desktop; mobile drawer always shows full width + labels
  const cl = collapsed && isDesktop

  const isVisible = link => {
    if (link.divider) return false
    if (link.perm && !can(link.perm)) return false
    if (link.adminOnly && user?.role !== 'admin' && user?.role !== 'superadmin') return false
    if (link.superadminOnly && user?.role !== 'superadmin') return false
    return true
  }

  const itemBase = cl
    ? 'flex justify-center items-center p-2 rounded-lg text-sm transition-colors'
    : 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors'

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-30 bg-gray-900 text-white flex flex-col
        transform transition-all duration-200 ease-in-out
        md:static md:translate-x-0 md:flex-shrink-0
        ${cl ? 'w-16' : 'w-64'}
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Header */}
        <div style={{ paddingTop: 'env(safe-area-inset-top)' }} className={`border-b border-gray-700 flex items-center ${cl ? 'px-1 py-4 justify-between' : 'px-5 py-4 gap-3'}`}>
          <img src="/logo.svg" alt="GB SMS Gateway logo" className="w-8 h-8 flex-shrink-0" />
          {!cl && (
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-bold tracking-wide leading-tight">GB SMS Gateway</h1>
              <p className="text-xs text-gray-400 truncate">Yeastar TG Multi-Device</p>
            </div>
          )}
          {/* Mobile: close button */}
          {!cl && (
            <button onClick={onClose} className="md:hidden text-gray-400 hover:text-white p-1" aria-label="Close menu">
              <X size={18} />
            </button>
          )}
          {/* Desktop: collapse toggle */}
          <button
            onClick={onToggleCollapse}
            className="hidden md:block text-gray-400 hover:text-white p-1"
            aria-label={cl ? 'Espandi menu' : 'Comprimi menu'}
          >
            {cl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Connection status */}
        <div className={`py-3 ${cl ? 'flex justify-center px-1' : 'px-4'}`}>
          <div
            className={`flex items-center gap-2 text-xs font-medium px-2 py-1 rounded ${connectedCount > 0 ? 'text-green-400' : 'text-red-400'}`}
            title={cl ? (totalCount === 0 ? 'No devices' : connectedCount > 0 ? `Online ${connectedCount}/${totalCount}` : `Offline ${connectedCount}/${totalCount}`) : undefined}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connectedCount > 0 ? 'bg-green-400' : 'bg-red-400'} animate-pulse`} />
            {!cl && (
              <>
                {totalCount === 0 ? 'No devices' : connectedCount > 0 ? 'Online' : 'Offline'}
                {totalCount > 0 && (
                  <span className="ml-auto opacity-60 font-normal">{connectedCount}/{totalCount}</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 ${cl ? 'px-1' : 'px-3'} space-y-0.5 overflow-y-auto scrollbar-thin`}>
          {links.map((l, i) => {
            if (l.divider) {
              const prevDividerIdx = links.slice(0, i).reduce((acc, x, j) => x.divider ? j : acc, -1)
              const hasVisibleBefore = links.slice(prevDividerIdx + 1, i).some(isVisible)
              const hasVisibleAfter  = links.slice(i + 1).some(isVisible)
              return (hasVisibleBefore && hasVisibleAfter) ? <div key={i} className="border-t border-gray-700 my-2" /> : null
            }
            if (l.perm && !can(l.perm)) return null
            if (l.adminOnly && user?.role !== 'admin' && user?.role !== 'superadmin') return null
            if (l.superadminOnly && user?.role !== 'superadmin') return null
            if (l.href) return (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                title={cl ? l.label : undefined}
                className={`${itemBase} text-gray-300 hover:bg-gray-800 hover:text-white`}
              >
                <l.icon size={17} className="flex-shrink-0" />
                {!cl && l.label}
              </a>
            )
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                onClick={onClose}
                title={cl ? l.label : undefined}
                className={({ isActive }) =>
                  `${itemBase} ${
                    isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <l.icon size={17} className="flex-shrink-0" />
                {!cl && l.label}
              </NavLink>
            )
          })}
        </nav>

        {/* User footer + logout */}
        <div className={`${cl ? 'px-1' : 'px-3'} py-3 border-t border-gray-700 space-y-1`}>
          {/* Collapsed: show only avatar/initials, centered */}
          {user && cl && (
            <div className="flex justify-center py-1" title={`${user.displayName || user.username} · ${user.role}`}>
              {user.avatar_photo_data_url ? (
                <img
                  src={user.avatar_photo_data_url}
                  alt={user.displayName || user.username}
                  className="w-7 h-7 rounded-full object-cover border border-gray-700 flex-shrink-0"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-semibold text-gray-300 uppercase leading-none tracking-tight">
                    {((n) => { const p = n.trim().split(/\s+/).filter(w => /^[a-zA-Z]/.test(w)); return p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0]?.[0] || '?' })(user.displayName || user.username || '?')}
                  </span>
                </div>
              )}
            </div>
          )}
          {/* Expanded: full user info */
          {user && !cl && (
            <div className="px-3 py-1.5 min-w-0 flex items-center gap-2">
              {user.avatar_photo_data_url ? (
                <img
                  src={user.avatar_photo_data_url}
                  alt={user.displayName || user.username}
                  className="w-7 h-7 rounded-full object-cover border border-gray-700 flex-shrink-0"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-semibold text-gray-300 uppercase leading-none tracking-tight">
                    {((n) => { const p = n.trim().split(/\s+/).filter(w => /^[a-zA-Z]/.test(w)); return p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0]?.[0] || '?' })(user.displayName || user.username || '?')}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-200 truncate leading-tight"
                  title={user.displayName || user.username}>
                  {user.displayName || user.username}
                </p>
                <p className="text-[11px] text-gray-500 truncate leading-tight mt-0.5">
                  {user.username} &middot; {user.role}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={onLogout}
            title={cl ? 'Sign out' : undefined}
            className={`w-full flex items-center py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors ${cl ? 'justify-center p-2' : 'gap-3 px-3'}`}
          >
            <LogOut size={17} className="flex-shrink-0" />
            {!cl && 'Sign out'}
          </button>
          {!cl && (
            <div className="px-3 py-1">
              <p className="text-[10px] text-gray-600 leading-snug truncate">
                v1.4 — Powered by <span className="text-gray-500 font-medium">Guido Ballarini</span> © {new Date().getFullYear()}
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
