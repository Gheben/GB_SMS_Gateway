import { useEffect, useState, useCallback } from 'react'
import { usersApi, ldapApi, localGroupsApi, portsApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import {
  Users, Plus, Pencil, Trash2, X, Shield, User, Loader2,
  Server, CheckCircle, XCircle, UsersRound, UserPlus, UserMinus, Search,
} from 'lucide-react'

const ALL_PERMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'inbox',     label: 'Inbox' },
  { key: 'sent',      label: 'Sent' },
  { key: 'send',      label: 'Send SMS' },
  { key: 'report',    label: 'Reports' },
  { key: 'devices',   label: 'Devices' },
  { key: 'ports',     label: 'SIM Mapping' },
  { key: 'rules',     label: 'Forward Rules' },
  { key: 'settings',  label: 'Settings' },
  { key: 'users',     label: 'User management' },
  { key: 'api',       label: 'API Access' },
  { key: 'phonebook', label: 'Phonebook access' },
]

function RoleBadge({ role }) {
  if (role === 'superadmin') return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">Super Admin</span>
  if (role === 'admin')      return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">Admin</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">User</span>
}

function SourceBadge({ source }) {
  if (source === 'ldap') return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 font-medium inline-flex items-center gap-1">
      <Server size={10} />LDAP
    </span>
  )
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 font-medium">Local</span>
}

function PermissionsEditor({ value, onChange, disabled }) {
  function toggle(key) {
    const newVal = { ...value, [key]: !value[key] }
    if (key === 'send' && newVal.send) {
      newVal.dashboard = true
      newVal.inbox = true
      newVal.sent = true
      newVal.report = true
    }
    if (key === 'inbox' && newVal.inbox) {
      newVal.dashboard = true
      newVal.report = true
    }
    onChange(newVal)
  }
  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {ALL_PERMS.map(p => (
        <label key={p.key} className={`flex items-center gap-2 text-sm cursor-pointer select-none ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
          <input
            type="checkbox"
            checked={!!value[p.key]}
            onChange={() => toggle(p.key)}
            className="accent-blue-600"
          />
          {p.label}
        </label>
      ))}
    </div>
  )
}

function UserModal({ user, onClose, onSaved }) {
  const isNew = !user
  const [username, setUsername] = useState(user?.username || '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(user?.role || 'user')
  const [permissions, setPermissions] = useState(user?.permissions || {})
  const [allowedPorts, setAllowedPorts] = useState(user?.allowed_ports || [])
  const [availablePorts, setAvailablePorts] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    portsApi.getAll().then(list => {
      // Only show ports that actually have a SIM installed (active or temporarily down)
      setAvailablePorts(list.filter(p => p.status === 'READY' || p.status === 'DOWN'))
    }).catch(() => {})
  }, [])

  function isPortAllowed(device_id, port_number) {
    return allowedPorts.some(p => p.device_id === device_id && p.port_number === port_number)
  }

  function togglePort(device_id, port_number) {
    setAllowedPorts(prev =>
      isPortAllowed(device_id, port_number)
        ? prev.filter(p => !(p.device_id === device_id && p.port_number === port_number))
        : [...prev, { device_id, port_number }]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (isNew || password.length > 0) {
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        setError('Password must be at least 8 characters and include an uppercase letter, a number, and a special character.')
        return
      }
    }
    setSaving(true)
    try {
      if (isNew) {
        await usersApi.create({ username, password, role, permissions, allowed_ports: allowedPorts })
      } else {
        const payload = { role, permissions, allowed_ports: allowedPorts }
        if (password) payload.password = password
        await usersApi.update(user.id, payload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg my-8 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h2 className="font-semibold text-gray-800">{isNew ? 'New user' : `Edit: ${user.username}`}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {isNew && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} required minLength={3}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {isNew ? 'Password' : 'New password (leave blank to keep current)'}
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              required={isNew} minLength={isNew ? 8 : 0}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="••••••••" />
            {(isNew || password.length > 0) && (() => {
              const rules = [
                { ok: password.length >= 8,            label: 'At least 8 characters' },
                { ok: /[A-Z]/.test(password),           label: 'One uppercase letter' },
                { ok: /[0-9]/.test(password),           label: 'One number' },
                { ok: /[^A-Za-z0-9]/.test(password),   label: 'One special character' },
              ]
              return (
                <ul className="mt-2 space-y-1">
                  {rules.map(r => (
                    <li key={r.label} className={`flex items-center gap-1.5 text-xs ${r.ok ? 'text-green-600' : 'text-gray-400'}`}>
                      <span>{r.ok ? '✓' : '○'}</span>
                      {r.label}
                    </li>
                  ))}
                </ul>
              )
            })()}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Permissions {role !== 'user' && <span className="text-gray-400 font-normal ml-1">(admins have full access)</span>}
            </label>
            <PermissionsEditor value={permissions} onChange={setPermissions} disabled={role !== 'user'} />
          </div>

          {role === 'user' && permissions.send && (
            <div className="border border-blue-100 rounded-lg p-4 bg-blue-50 space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Allowed SIM ports for sending SMS
              </label>
              <p className="text-xs text-gray-400">
                If nothing is selected, the user can use all available ports.
              </p>
              {availablePorts.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No SIM ports detected.</p>
              ) : (
                <div className="flex justify-end mb-1">
                  <button
                    type="button"
                    onClick={() => setAllowedPorts(
                      allowedPorts.length === availablePorts.length
                        ? []
                        : availablePorts.map(p => ({ device_id: p.device_id, port_number: p.port_number }))
                    )}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {allowedPorts.length === availablePorts.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              )}
              {availablePorts.length > 0 && (
                <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                  {availablePorts.map(p => {
                    const label = [
                      p.device_name,
                      `Port ${p.port_number}`,
                      p.operator ? `— ${p.operator}` : '',
                      p.sim_number ? `(${p.sim_number})` : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <label key={`${p.device_id}-${p.port_number}`} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isPortAllowed(p.device_id, p.port_number)}
                          onChange={() => togglePort(p.device_id, p.port_number)}
                          className="accent-blue-600"
                        />
                        {label}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors">
              {saving ? 'Saving...' : isNew ? 'Create user' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── GroupMappingModal ─────────────────────────────────────── */

function GroupMappingModal({ mapping, onClose, onSaved }) {
  const isNew = !mapping
  const [groupDn, setGroupDn]         = useState(mapping?.group_dn || '')
  const [role, setRole]               = useState(mapping?.role || 'user')
  const [permissions, setPermissions] = useState(mapping?.permissions || {})
  const [allowedPorts, setAllowedPorts] = useState(mapping?.allowed_ports || [])
  const [availablePorts, setAvailablePorts] = useState([])
  const [error, setError]             = useState('')

  useEffect(() => {
    portsApi.getAll().then(list => setAvailablePorts(list.filter(p => p.status === 'READY' || p.status === 'DOWN'))).catch(() => {})
  }, [])

  function isPortAllowed(device_id, port_number) {
    return allowedPorts.some(p => p.device_id === device_id && p.port_number === port_number)
  }
  function togglePort(device_id, port_number) {
    setAllowedPorts(prev =>
      isPortAllowed(device_id, port_number)
        ? prev.filter(p => !(p.device_id === device_id && p.port_number === port_number))
        : [...prev, { device_id, port_number }]
    )
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!groupDn.trim()) { setError('Group DN is required'); return }
    onSaved({ id: mapping?.id || null, group_dn: groupDn.trim(), role, permissions: role === 'admin' ? {} : permissions, allowed_ports: role === 'user' && permissions.send ? allowedPorts : [] })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h2 className="font-semibold text-gray-800">{isNew ? 'New group mapping' : 'Edit mapping'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Group DN (full path)</label>
            <input value={groupDn} onChange={e => setGroupDn(e.target.value)} required
              placeholder="CN=SMS_Admins,OU=Groups,DC=example,DC=com"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="mt-1 text-xs text-gray-400">Full Distinguished Name of the AD group. Nested groups (groups of groups) are supported.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Assigned role</label>
            <div className="flex gap-6">
              {[{ v: 'admin', label: 'Admin (full access)' }, { v: 'user', label: 'User (specific permissions)' }].map(opt => (
                <label key={opt.v} className="flex items-center gap-2 cursor-pointer text-sm select-none">
                  <input type="radio" checked={role === opt.v} onChange={() => setRole(opt.v)} className="accent-blue-600" />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {role === 'user' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Permissions</label>
              <PermissionsEditor value={permissions} onChange={setPermissions} disabled={false} />
            </div>
          )}
          {role === 'user' && permissions.send && (
            <div className="border border-blue-100 rounded-lg p-4 bg-blue-50 space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Allowed SIM ports for sending SMS
              </label>
              <p className="text-xs text-gray-400">If nothing is selected, members can use all available ports.</p>
              {availablePorts.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No SIM ports detected.</p>
              ) : (
                <div className="flex justify-end mb-1">
                  <button type="button"
                    onClick={() => setAllowedPorts(
                      allowedPorts.length === availablePorts.length
                        ? []
                        : availablePorts.map(p => ({ device_id: p.device_id, port_number: p.port_number }))
                    )}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                    {allowedPorts.length === availablePorts.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              )}
              {availablePorts.length > 0 && (
                <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                  {availablePorts.map(p => {
                    const label = [p.device_name, `Port ${p.port_number}`, p.operator ? `— ${p.operator}` : '', p.sim_number ? `(${p.sim_number})` : ''].filter(Boolean).join(' ')
                    return (
                      <label key={`${p.device_id}-${p.port_number}`} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input type="checkbox" checked={isPortAllowed(p.device_id, p.port_number)} onChange={() => togglePort(p.device_id, p.port_number)} className="accent-blue-600" />
                        {label}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {role === 'admin' && (
            <div className="bg-blue-50 border border-blue-100 text-blue-700 text-sm rounded-lg px-4 py-3">
              Admin users have full access to all sections.
            </div>
          )}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
              {isNew ? 'Add' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── UserDetailModal ──────────────────────────────────────── */

function UserDetailModal({ user: u, onClose, onEdit }) {
  function formatDate(ts) {
    if (!ts) return '—'
    return new Date(ts + (ts.endsWith('Z') ? '' : 'Z')).toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const isLdap = u.source === 'ldap'
  const grantedPerms = ALL_PERMS.filter(p => u.permissions?.[p.key])
  const deniedPerms  = ALL_PERMS.filter(p => !u.permissions?.[p.key])
  const hasFullAccess = u.role !== 'user'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <div className="flex items-center gap-2">
            <span
              title={u.is_online ? 'Online' : 'Offline'}
              className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                u.is_online ? 'bg-green-400' : 'bg-gray-300'
              }`}
            />
            {u.role === 'superadmin'
              ? <Shield size={16} className="text-purple-500" />
              : <User size={16} className="text-gray-400" />}
            <h2 className="font-semibold text-gray-800">{u.username}</h2>
            {u.display_name && u.display_name !== u.username && (
              <span className="text-sm text-gray-400">{u.display_name}</span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Badges row */}
          <div className="flex items-center gap-2 flex-wrap">
            <RoleBadge role={u.role} />
            <SourceBadge source={u.source || 'local'} />
            {u.is_online
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">Online</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200 font-medium">Offline</span>
            }
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Created on</p>
              <p className="text-gray-700">{formatDate(u.created_at)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Last login</p>
              <p className="text-gray-700">{formatDate(u.last_login)}</p>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Permissions
              {isLdap && <span className="ml-1 font-normal normal-case text-cyan-600">(from LDAP group mapping)</span>}
            </p>
            {hasFullAccess ? (
              <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                <CheckCircle size={15} className="text-green-500" />
                Full access to all sections
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                {ALL_PERMS.map(p => {
                  const granted = !!u.permissions?.[p.key]
                  return (
                    <div key={p.key} className="flex items-center gap-1.5 text-xs">
                      {granted
                        ? <CheckCircle size={13} className="text-green-500 flex-shrink-0" />
                        : <XCircle    size={13} className="text-red-400 flex-shrink-0" />}
                      <span className={granted ? 'text-gray-800 font-medium' : 'text-gray-400'}>
                        {p.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* LDAP groups if present */}
          {isLdap && Array.isArray(u.ldap_groups) && u.ldap_groups.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">LDAP Groups</p>
              <ul className="space-y-0.5">
                {u.ldap_groups.map((g, i) => (
                  <li key={i} className="text-xs font-mono text-gray-600 truncate" title={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
          {u.role !== 'superadmin' && !isLdap && onEdit && (
            <button
              onClick={() => { onClose(); onEdit(u) }}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── LocalUsersTab ─────────────────────────────────────────── */

const PAGE_SIZE = 25

function LocalUsersTab() {
  const { user: me } = useAuth()
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(null)   // null | 'new' | user-obj
  const [detail, setDetail]   = useState(null)   // user-obj for read-only detail modal
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try { setUsers(await usersApi.getAll()) } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  // Reset to page 1 when search changes
  useEffect(() => { setPage(1) }, [search])

  async function handleDelete(u) {
    if (!confirm(`Delete user "${u.username}"?`)) return
    try {
      await usersApi.remove(u.id)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Delete error')
    }
  }

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    return !q ||
      u.username.toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q)
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function formatLastLogin(ts) {
    if (!ts) return '—'
    return new Date(ts + (ts.endsWith('Z') ? '' : 'Z')).toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  if (loading) return (
    <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading...
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users…"
            className="w-full pl-8 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="flex-1" />
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
          <Plus size={16} />New local user
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-[680px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-6"></th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Username</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Permissions</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Login</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {paginated.map(u => {
              const isLdap = u.source === 'ldap'
              return (
                <tr
                  key={u.id}
                  className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer select-none"
                  onDoubleClick={() => setDetail(u)}
                  title="Double-click for details"
                >
                  <td className="px-3 py-3 text-center">
                    <span
                      title={u.is_online ? 'Online' : 'Offline'}
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        u.is_online ? 'bg-green-400' : 'bg-gray-300'
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    <div className="flex items-center gap-2">
                      {u.role === 'superadmin' ? <Shield size={15} className="text-purple-500" /> : <User size={15} className="text-gray-400" />}
                      {u.username}
                      {u.display_name && u.display_name !== u.username && (
                        <span className="text-xs text-gray-400 font-normal">{u.display_name}</span>
                      )}
                      {u.id === me?.id && <span className="text-xs text-blue-500 font-normal">(you)</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><SourceBadge source={u.source || 'local'} /></td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {isLdap
                      ? <span className="italic text-cyan-600">From LDAP mapping</span>
                      : u.role !== 'user'
                        ? <span className="italic">Full access</span>
                        : ALL_PERMS.filter(p => u.permissions?.[p.key]).map(p => p.label).join(', ') ||
                          <span className="italic text-gray-400">No permissions</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {formatLastLogin(u.last_login)}
                  </td>
                  <td className="px-4 py-3">
                    {u.role !== 'superadmin' && (
                      <div className="flex items-center gap-2 justify-end">
                        {!isLdap && (
                          <button onClick={() => setModal(u)} className="text-gray-400 hover:text-blue-600 p-1" title="Edit">
                            <Pencil size={15} />
                          </button>
                        )}
                        {u.id !== me?.id && (
                          <button onClick={() => handleDelete(u)} className="text-gray-400 hover:text-red-600 p-1" title="Delete">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border text-xs disabled:opacity-40 hover:bg-gray-50">
              ‹ Prev
            </button>
            <span className="px-3 py-1 text-xs">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border text-xs disabled:opacity-40 hover:bg-gray-50">
              Next ›
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 px-1">
        LDAP users appear in this list automatically after their first login with domain credentials.
        Their permissions are updated on every login based on the configured group mapping.
      </p>

      {detail && (
        <UserDetailModal
          user={detail}
          onClose={() => setDetail(null)}
          onEdit={u => setModal(u)}
        />
      )}

      {modal && (
        <UserModal
          user={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

/* ─── LdapSettingsTab ───────────────────────────────────────── */

function LdapSettingsTab() {
  const { user: me } = useAuth()
  const isSuperAdmin = me?.role === 'superadmin'
  const [loadingCfg, setLoadingCfg]   = useState(true)
  const [savedSettings, setSavedSettings] = useState(null)
  const [form, setForm] = useState({
    enabled:               false,
    ldap_server:           '',
    ldap_domain:           '',
    ldap_base_dn:          '',
    ldap_service_username: '',
    ldap_service_password: '',
    skip_cert_verify:      false,
    user_filter:           '(sAMAccountName={{username}})',
    ad_mode:               true,
  })
  const [mappings, setMappings]           = useState([])
  const [testing, setTesting]             = useState(false)
  const [testResult, setTestResult]       = useState(null)
  const [saving, setSaving]               = useState(false)
  const [saveMsg, setSaveMsg]             = useState(null)
  const [mappingModal, setMappingModal]   = useState(null)
  const [mappingSaving, setMappingSaving] = useState(false)
  const [mappingMsg, setMappingMsg]       = useState(null)

  const loadSettings = useCallback(async () => {
    try {
      const cfg = await ldapApi.getSettings()
      setSavedSettings(cfg)
      if (cfg && (cfg.host || cfg.ldap_server)) {
        // Supporta sia il nuovo formato che il vecchio (legacy)
        const legacyServer = cfg.host
          ? `${cfg.use_tls ? 'ldaps' : 'ldap'}://${cfg.host}${cfg.port && cfg.port !== (cfg.use_tls ? 636 : 389) ? ':' + cfg.port : ''}`
          : ''
        setForm({
          enabled:               cfg.enabled               || false,
          ldap_server:           cfg.ldap_server           || legacyServer,
          ldap_domain:           cfg.ldap_domain           || '',
          ldap_base_dn:          cfg.ldap_base_dn          || cfg.base_dn || '',
          ldap_service_username: cfg.ldap_service_username || '',
          ldap_service_password: '',  // non precompilare
          skip_cert_verify:      cfg.skip_cert_verify      || false,
          user_filter:           cfg.user_filter           || '(sAMAccountName={{username}})',
          ad_mode:               cfg.ad_mode !== false,
        })
        setMappings(Array.isArray(cfg.group_mappings) ? cfg.group_mappings : [])
      }
    } catch {}
    setLoadingCfg(false)
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
    setTestResult(null)
    setSaveMsg(null)
  }

  /** Calcola il Base DN dal dominio (es. azienda.local → DC=azienda,DC=local) */
  function computeBaseDn(domain) {
    if (!domain) return ''
    return domain.split('.').map(p => `DC=${p}`).join(',')
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await ldapApi.testConn()
      setTestResult({ ok: true, message: res.message || 'Connection successful' })
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message || 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      await ldapApi.saveSettings({ ...form, group_mappings: mappings })
      setSaveMsg({ ok: true, text: 'Settings saved' })
      const updated = await ldapApi.getSettings()
      setSavedSettings(updated)
    } catch (err) {
      setSaveMsg({ ok: false, text: err.response?.data?.error || 'Save error' })
    } finally {
      setSaving(false)
    }
  }

  async function saveMappingsNow(newMappings) {
    setMappingSaving(true)
    setMappingMsg(null)
    try {
      // Invia tutto il form ma con password vuota (il backend mantiene quella esistente)
      await ldapApi.saveSettings({ ...form, ldap_service_password: '', bind_password: '', group_mappings: newMappings })
      setMappingMsg({ ok: true, text: 'Mappings saved' })
      setTimeout(() => setMappingMsg(null), 3000)
    } catch {
      setMappingMsg({ ok: false, text: 'Save error' })
    } finally {
      setMappingSaving(false)
    }
  }

  function handleMappingSaved(m) {
    setMappings(prev => {
      const next = m.id
        ? prev.map(x => x.id === m.id ? m : x)
        : [...prev, { ...m, id: Math.random().toString(36).slice(2) }]
      saveMappingsNow(next)
      return next
    })
    setMappingModal(null)
  }

  function removeMapping(id) {
    if (!confirm('Delete this mapping?')) return
    setMappings(prev => {
      const next = prev.filter(x => x.id !== id)
      saveMappingsNow(next)
      return next
    })
  }

  const passwordIsSaved = !!(savedSettings?.ldap_service_password || savedSettings?.bind_password)

  if (loadingCfg) return (
    <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading...
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Enable toggle — superadmin only */}
      {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={form.enabled} onChange={e => setField('enabled', e.target.checked)}
              className="w-4 h-4 accent-blue-600" />
            <span className="font-semibold text-gray-800">Enable LDAP / Active Directory authentication</span>
          </label>
          {form.enabled && (
            <p className="mt-2 text-sm text-cyan-700">LDAP enabled — users will be able to sign in with domain credentials.</p>
          )}
        </div>
      )}

      <div className={`space-y-5 transition-opacity duration-200 ${isSuperAdmin && !form.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Connessione — superadmin only */}
        {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">LDAP Connection</h3>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">LDAP Server</label>
            <input value={form.ldap_server} onChange={e => setField('ldap_server', e.target.value)}
              placeholder="ldaps://dc.company.local  or  ldap://192.168.1.10"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="mt-1 text-xs text-gray-400">Use <code>ldaps://</code> for LDAP over TLS (port 636), <code>ldap://</code> for unencrypted connection (port 389).</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Active Directory Domain</label>
            <input value={form.ldap_domain} onChange={e => setField('ldap_domain', e.target.value)}
              placeholder="company.local"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="mt-1 text-xs text-gray-400">Used for binding the service account in the format <code>username@domain</code>.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-500">Base DN</label>
              {form.ldap_domain && (
                <button type="button"
                  onClick={() => setField('ldap_base_dn', computeBaseDn(form.ldap_domain))}
                  className="text-xs text-blue-600 hover:underline">
                  Derive from domain
                </button>
              )}
            </div>
            <input value={form.ldap_base_dn} onChange={e => setField('ldap_base_dn', e.target.value)}
              placeholder="DC=company,DC=local"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
            <input type="checkbox" checked={form.skip_cert_verify} onChange={e => setField('skip_cert_verify', e.target.checked)} className="accent-blue-600" />
            Skip TLS certificate verification
          </label>
        </div>
        )}{/* end Connessione */}

        {/* Service account — superadmin only */}
        {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Service account</h3>
          <p className="text-xs text-gray-400">
            Account used to search for users in AD. Will authenticate as <code>username@domain</code>.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
              <input value={form.ldap_service_username} onChange={e => setField('ldap_service_username', e.target.value)}
                placeholder="ServiceSMS"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
              <input type="password" value={form.ldap_service_password} onChange={e => setField('ldap_service_password', e.target.value)}
                placeholder={passwordIsSaved ? '••••••••  (leave blank to keep current)' : 'Service account password'}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
        </div>
        )}{/* end Service account */}

        {/* Ricerca utenti — superadmin only */}
        {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">User search</h3>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">User filter</label>
            <input value={form.user_filter} onChange={e => setField('user_filter', e.target.value)}
              placeholder="(sAMAccountName={{username}})"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="mt-1 text-xs text-gray-400">{'Usa {{username}} come segnaposto per lo username inserito al login.'}</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
            <input type="checkbox" checked={form.ad_mode} onChange={e => setField('ad_mode', e.target.checked)} className="accent-blue-600" />
            <span>
              Active Directory mode
              <span className="text-gray-400 text-xs ml-1 font-normal">(nested groups via LDAP_MATCHING_RULE_IN_CHAIN)</span>
            </span>
          </label>
        </div>
        )}{/* end Ricerca utenti */}

        {/* Actions — superadmin only */}
        {isSuperAdmin && (
        <div className="flex items-center gap-4 flex-wrap">
          <button onClick={handleTest} disabled={testing || !form.ldap_server}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
            <Server size={15} />{testing ? 'Testing...' : 'Test connection'}
          </button>
          {testResult && (
            <span className={`flex items-center gap-1.5 text-sm font-medium ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
              {testResult.message}
            </span>
          )}
          <div className="flex-1" />
          {saveMsg && (
            <span className={`text-sm font-medium ${saveMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{saveMsg.text}</span>
          )}
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors">
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
        )}{/* end Actions */}

        {/* Group mappings */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h3 className="font-semibold text-gray-800">AD Group → Role mapping</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Permissions updated on every login. Multiple groups supported — Admin always takes precedence.
              </p>
            </div>
            <div className="flex items-center gap-3 ml-4">
              {mappingSaving && <span className="text-xs text-gray-400">Saving...</span>}
              {mappingMsg && !mappingSaving && (
                <span className={`flex items-center gap-1 text-xs font-medium ${mappingMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {mappingMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
                  {mappingMsg.text}
                </span>
              )}
              <button onClick={() => setMappingModal('new')}
                className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700">
                <Plus size={15} />Add mapping
              </button>
            </div>
          </div>
          {mappings.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">
              No mappings configured.<br />
              <span className="text-xs">Add at least one group to allow login with LDAP credentials.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="min-w-[500px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">LDAP Group (DN)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Permissions</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {mappings.map(m => (
                  <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-xs">
                      <span className="block truncate" title={m.group_dn}>{m.group_dn}</span>
                    </td>
                    <td className="px-4 py-3"><RoleBadge role={m.role} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {m.role === 'admin'
                        ? <span className="italic">Full access</span>
                        : ALL_PERMS.filter(p => m.permissions?.[p.key]).map(p => p.label).join(', ') ||
                          <span className="italic text-gray-400">No permissions</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setMappingModal(m)} className="text-gray-400 hover:text-blue-600 p-1" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => removeMapping(m.id)} className="text-gray-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {mappingModal && (
        <GroupMappingModal
          mapping={mappingModal === 'new' ? null : mappingModal}
          onClose={() => setMappingModal(null)}
          onSaved={handleMappingSaved}
        />
      )}
    </div>
  )
}

/* ─── UsersPage (main con tabs) ─────────────────────────────── */

/* ─── LocalGroupsTab ────────────────────────────────────────── */

function GroupModal({ group, allUsers, onClose, onSaved }) {
  const isNew = !group
  const [name, setName]               = useState(group?.name || '')
  const [description, setDescription] = useState(group?.description || '')
  const [role, setRole]               = useState(group?.role || 'user')
  const [permissions, setPermissions] = useState(group?.permissions || {})
  const [allowedPorts, setAllowedPorts] = useState(group?.allowed_ports || [])
  const [availablePorts, setAvailablePorts] = useState([])
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    portsApi.getAll().then(list => setAvailablePorts(list.filter(p => p.status === 'READY' || p.status === 'DOWN'))).catch(() => {})
  }, [])

  function isPortAllowed(device_id, port_number) {
    return allowedPorts.some(p => p.device_id === device_id && p.port_number === port_number)
  }
  function togglePort(device_id, port_number) {
    setAllowedPorts(prev =>
      isPortAllowed(device_id, port_number)
        ? prev.filter(p => !(p.device_id === device_id && p.port_number === port_number))
        : [...prev, { device_id, port_number }]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload = { name: name.trim(), description: description.trim(), role, permissions: role === 'admin' ? {} : permissions, allowed_ports: role === 'user' && permissions.send ? allowedPorts : [] }
      if (isNew) await localGroupsApi.create(payload)
      else await localGroupsApi.update(group.id, payload)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Error saving')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h2 className="font-semibold text-gray-800">{isNew ? 'New local group' : `Edit: ${group.name}`}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Group name</label>
            <input value={name} onChange={e => setName(e.target.value)} required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description (optional)</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Role assigned to members</label>
            <div className="flex gap-6">
              {[{ v: 'admin', label: 'Admin (full access)' }, { v: 'user', label: 'User (specific permissions)' }].map(opt => (
                <label key={opt.v} className="flex items-center gap-2 cursor-pointer text-sm select-none">
                  <input type="radio" checked={role === opt.v} onChange={() => setRole(opt.v)} className="accent-blue-600" />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {role === 'user' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Permissions</label>
              <PermissionsEditor value={permissions} onChange={setPermissions} disabled={false} />
            </div>
          )}
          {role === 'user' && permissions.send && (
            <div className="border border-blue-100 rounded-lg p-4 bg-blue-50 space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Allowed SIM ports for sending SMS
              </label>
              <p className="text-xs text-gray-400">If nothing is selected, members can use all available ports.</p>
              {availablePorts.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No SIM ports detected.</p>
              ) : (
                <div className="flex justify-end mb-1">
                  <button type="button"
                    onClick={() => setAllowedPorts(
                      allowedPorts.length === availablePorts.length
                        ? []
                        : availablePorts.map(p => ({ device_id: p.device_id, port_number: p.port_number }))
                    )}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                    {allowedPorts.length === availablePorts.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              )}
              {availablePorts.length > 0 && (
                <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                  {availablePorts.map(p => {
                    const label = [p.device_name, `Port ${p.port_number}`, p.operator ? `— ${p.operator}` : '', p.sim_number ? `(${p.sim_number})` : ''].filter(Boolean).join(' ')
                    return (
                      <label key={`${p.device_id}-${p.port_number}`} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input type="checkbox" checked={isPortAllowed(p.device_id, p.port_number)} onChange={() => togglePort(p.device_id, p.port_number)} className="accent-blue-600" />
                        {label}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {role === 'admin' && (
            <div className="bg-blue-50 border border-blue-100 text-blue-700 text-sm rounded-lg px-4 py-3">
              Admin members have full access to all sections.
            </div>
          )}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors">
              {saving ? 'Saving...' : isNew ? 'Create group' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function GroupMembersModal({ group, allUsers, onClose, onSaved }) {
  const [members, setMembers]     = useState(group.members || [])
  const [loading, setLoading]     = useState(false)
  const [adding, setAdding]       = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [search, setSearch]       = useState('')

  const memberIds = new Set(members.map(m => m.id))
  const nonMembers = allUsers.filter(u => !memberIds.has(u.id) && u.username.toLowerCase().includes(search.toLowerCase()))

  async function add(userId) {
    setAdding(userId)
    try {
      await localGroupsApi.addMember(group.id, userId)
      const updated = await localGroupsApi.getOne(group.id)
      setMembers(updated.members || [])
      onSaved()
    } catch (err) {
      alert(err.response?.data?.error || 'Error adding member')
    } finally { setAdding(null) }
  }

  async function remove(userId) {
    setRemovingId(userId)
    try {
      await localGroupsApi.removeMember(group.id, userId)
      setMembers(prev => prev.filter(m => m.id !== userId))
      onSaved()
    } catch (err) {
      alert(err.response?.data?.error || 'Error removing member')
    } finally { setRemovingId(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h2 className="font-semibold text-gray-800">Members: {group.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* Membri attuali */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Current members ({members.length})</p>
            {members.length === 0
              ? <p className="text-sm text-gray-400 italic">No members</p>
              : <div className="space-y-1 max-h-40 overflow-y-auto">
                  {members.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-gray-400" />
                        <span className="text-sm font-medium text-gray-800">{m.username}</span>
                        <RoleBadge role={m.role} />
                      </div>
                      <button
                        onClick={() => remove(m.id)}
                        disabled={removingId === m.id}
                        className="text-red-400 hover:text-red-600 p-1 disabled:opacity-40"
                        title="Remove from group"
                      >
                        <UserMinus size={15} />
                      </button>
                    </div>
                  ))}
                </div>
            }
          </div>

          {/* Aggiungi membri */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add user</p>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Search user..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {nonMembers.length === 0
                ? <p className="text-sm text-gray-400 italic">No users to add</p>
                : nonMembers.map(u => (
                    <div key={u.id} className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-blue-400" />
                        <span className="text-sm text-gray-800">{u.username}</span>
                        <RoleBadge role={u.role} />
                      </div>
                      <button
                        onClick={() => add(u.id)}
                        disabled={adding === u.id}
                        className="text-blue-600 hover:text-blue-800 p-1 disabled:opacity-40"
                        title="Add to group"
                      >
                        <UserPlus size={15} />
                      </button>
                    </div>
                  ))
              }
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LocalGroupsTab() {
  const [groups, setGroups]   = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(null)       // null | 'new' | group object
  const [membersModal, setMembersModal] = useState(null) // null | group (with members)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [g, u] = await Promise.all([localGroupsApi.getAll(), usersApi.getAll()])
      setGroups(g)
      setAllUsers(u)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete(g) {
    if (!confirm(`Delete group "${g.name}"?`)) return
    try {
      await localGroupsApi.remove(g.id)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'Delete error')
    }
  }

  async function openMembers(g) {
    try {
      const full = await localGroupsApi.getOne(g.id)
      setMembersModal(full)
    } catch {}
  }

  if (loading) return (
    <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading...
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Local groups work like LDAP groups: they assign roles and permissions and can restrict visibility in forwarding rules.
        </p>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors flex-shrink-0 ml-4">
          <Plus size={16} />New group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-white border border-gray-200 rounded-xl">
          <UsersRound size={32} className="mx-auto mb-3 opacity-30" />
          <p>No local groups. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <div key={g.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800">{g.name}</span>
                    <RoleBadge role={g.role} />
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                  {g.description && <p className="text-sm text-gray-500 mt-1">{g.description}</p>}
                  {g.role === 'user' && (
                    <p className="text-xs text-gray-400 mt-1">
                      Permissions: {ALL_PERMS.filter(p => g.permissions?.[p.key]).map(p => p.label).join(', ') || 'none'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openMembers(g)} className="p-1.5 rounded hover:bg-blue-50 text-blue-400 hover:text-blue-600" title="Manage members">
                    <UsersRound size={15} />
                  </button>
                  <button onClick={() => setModal(g)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Edit">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => handleDelete(g)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <GroupModal
          group={modal === 'new' ? null : modal}
          allUsers={allUsers}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {membersModal && (
        <GroupMembersModal
          group={membersModal}
          allUsers={allUsers}
          onClose={() => setMembersModal(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

const ALL_TABS = [
  { key: 'local',  label: 'Local users',            Icon: Users,        superadminOnly: false },
  { key: 'groups', label: 'Local groups',            Icon: UsersRound,   superadminOnly: false },
  { key: 'ldap',   label: 'LDAP / Active Directory', Icon: Server,       superadminOnly: false },
]

export default function UsersPage() {
  const { user: me } = useAuth()
  const TABS = ALL_TABS.filter(t => !t.superadminOnly || me?.role === 'superadmin')
  const [tab, setTab] = useState('local')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users size={22} className="text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-800">Users/Groups</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {tab === 'local'  && <LocalUsersTab />}
      {tab === 'ldap'   && <LdapSettingsTab />}
      {tab === 'groups' && <LocalGroupsTab />}
    </div>
  )
}
