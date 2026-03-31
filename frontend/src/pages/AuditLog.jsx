import { useEffect, useState, useCallback } from 'react'
import { auditApi } from '../api'
import { ClipboardList, Search, X, Trash2, RefreshCw, Loader2 } from 'lucide-react'

const ACTION_LABELS = {
  'auth:login':        'Login',
  'sms:send':          'SMS sent',
  'user:create':       'User created',
  'user:update':       'User updated',
  'user:delete':       'User deleted',
  'rule:create':       'Rule created',
  'rule:update':       'Rule updated',
  'rule:delete':       'Rule deleted',
  'group:create':      'Group created',
  'group:update':      'Group updated',
  'group:delete':      'Group deleted',
  'group:add_member':  'Member added',
  'group:remove_member': 'Member removed',
}

function actionBadge(action) {
  const label = ACTION_LABELS[action] || action
  const colors = {
    'auth:login':         'bg-green-100 text-green-700',
    'sms:send':           'bg-blue-100 text-blue-700',
    'user:create':        'bg-purple-100 text-purple-700',
    'user:update':        'bg-yellow-100 text-yellow-700',
    'user:delete':        'bg-red-100 text-red-700',
    'rule:create':        'bg-teal-100 text-teal-700',
    'rule:update':        'bg-teal-50 text-teal-600',
    'rule:delete':        'bg-red-50 text-red-600',
    'group:create':       'bg-indigo-100 text-indigo-700',
    'group:update':       'bg-indigo-50 text-indigo-600',
    'group:delete':       'bg-red-50 text-red-500',
    'group:add_member':   'bg-cyan-100 text-cyan-700',
    'group:remove_member':'bg-orange-100 text-orange-700',
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${colors[action] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  return d.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' })
}

export default function AuditLog() {
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ username: '', action: '', resource_type: '', from: '', to: '' })
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [purgeDays, setPurgeDays] = useState(90)
  const [purging, setPurging] = useState(false)
  const limit = 50

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params = { page: p, limit }
      if (filters.username) params.username = filters.username
      if (filters.action) params.action = filters.action
      if (filters.resource_type) params.resource_type = filters.resource_type
      if (filters.from) params.from = filters.from
      if (filters.to) params.to = filters.to + 'T23:59:59'
      const result = await auditApi.getAll(params)
      setData(result.data)
      setTotal(result.total)
      setPage(p)
    } catch (_) {}
    setLoading(false)
  }, [filters])

  useEffect(() => { load(1) }, [load])

  function clearFilters() {
    setFilters({ username: '', action: '', resource_type: '', from: '', to: '' })
  }

  async function handlePurge() {
    if (!confirm(`Delete all audit entries older than ${purgeDays} days?`)) return
    setPurging(true)
    try {
      const { removed } = await auditApi.purge(purgeDays)
      alert(`Deleted ${removed} entries.`)
      load(1)
    } catch (err) {
      alert(err.response?.data?.error || 'Purge error')
    } finally {
      setPurging(false)
      setPurgeOpen(false)
    }
  }

  const totalPages = Math.ceil(total / limit)
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList size={22} className="text-gray-500" />
          <h2 className="text-2xl font-bold text-gray-800">Audit Log</h2>
          <span className="text-sm text-gray-400 ml-2">{total} total entries</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(page)} className="btn-ghost flex items-center gap-1.5 text-sm">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setPurgeOpen(true)} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
            <Trash2 size={14} /> Purge
          </button>
        </div>
      </div>

      {/* Filtri */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">User</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-7 text-sm"
                placeholder="Filter by user..."
                value={filters.username}
                onChange={e => setFilters(p => ({ ...p, username: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <select
              className="input text-sm"
              value={filters.action}
              onChange={e => setFilters(p => ({ ...p, action: e.target.value }))}
            >
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Resource</label>
            <select
              className="input text-sm"
              value={filters.resource_type}
              onChange={e => setFilters(p => ({ ...p, resource_type: e.target.value }))}
            >
              <option value="">All resources</option>
              <option value="message">SMS</option>
              <option value="user">User</option>
              <option value="rule">Rule</option>
              <option value="local_group">Local group</option>
            </select>
          </div>
          <div className="min-w-[130px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="date"
              className="input text-sm"
              value={filters.from}
              onChange={e => setFilters(p => ({ ...p, from: e.target.value }))}
            />
          </div>
          <div className="min-w-[130px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="date"
              className="input text-sm"
              value={filters.to}
              onChange={e => setFilters(p => ({ ...p, to: e.target.value }))}
            />
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors">
              <X size={14} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Tabella */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-12 text-gray-400 gap-2">
            <Loader2 size={18} className="animate-spin" /> Loading...
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No entries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[460px] w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Date/Time</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">User</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Action</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide hidden md:table-cell">Detail</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide hidden lg:table-cell">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-xs">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{row.username}</td>
                    <td className="px-4 py-3">{actionBadge(row.action)}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell max-w-xs truncate" title={row.detail || ''}>
                      {row.detail || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs hidden lg:table-cell">{row.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginazione */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages} — {total} entries
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => load(page - 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => load(page + 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Modal pulizia */}
      {purgeOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 m-4">
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
              <Trash2 size={18} className="text-red-500" />
              Audit Log Purge
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Delete all entries older than:
            </p>
            <div className="flex items-center gap-3 mb-6">
              <input
                type="number"
                min={1}
                max={3650}
                value={purgeDays}
                onChange={e => setPurgeDays(Number(e.target.value))}
                className="input w-28"
              />
              <span className="text-sm text-gray-600">days</span>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPurgeOpen(false)} className="btn-ghost">Cancel</button>
              <button
                onClick={handlePurge}
                disabled={purging}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {purging ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
