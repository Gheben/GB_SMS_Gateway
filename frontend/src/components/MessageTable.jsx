import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { messagesApi } from '../api'

export default function MessageTable({ messages, loading, onDoubleClick, canDelete = false, onDeleted }) {
  const [selected, setSelected] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const allIds = messages.map(m => m.id)
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allIds))
  }

  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDelete() {
    if (!someSelected) return
    setDeleting(true)
    try {
      await messagesApi.deleteMany([...selected])
      setSelected(new Set())
      setConfirmOpen(false)
      onDeleted?.()
    } catch (err) {
      alert(err?.response?.data?.error || 'Error deleting messages')
    }
    setDeleting(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" /> Loading...
      </div>
    )
  }

  if (!messages || messages.length === 0) {
    return <div className="text-center py-16 text-gray-400">No messages found.</div>
  }

  return (
    <div className="space-y-2">
      {/* Toolbar delete — visible only when canDelete and something is selected */}
      {canDelete && someSelected && (
        <div className="flex items-center gap-3 px-1">
          <span className="text-sm text-gray-600">{selected.size} selected</span>
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100 transition-colors"
          >
            <Trash2 size={14} /> Delete selected
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {canDelete && (
                <th className="pl-3 pr-1 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    title="Select all"
                  />
                </th>
              )}
              <th className="px-4 py-3 pr-6 text-left font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 pr-6 text-left font-medium text-gray-500 uppercase tracking-wider">From / To</th>
              <th className="hidden sm:table-cell px-4 py-3 pr-6 text-left font-medium text-gray-500 uppercase tracking-wider">SIM</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Message</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Date</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {messages.map((msg) => (
              <tr
                key={msg.id}
                className={`hover:bg-blue-50 transition-colors cursor-pointer select-none ${selected.has(msg.id) ? 'bg-blue-50' : ''}`}
                style={{ touchAction: 'manipulation' }}
                onDoubleClick={() => onDoubleClick?.(msg)}
                title="Double-click for details"
              >
                {canDelete && (
                  <td className="pl-3 pr-1 py-3" onClick={e => { e.stopPropagation(); toggleOne(msg.id) }}>
                    <input
                      type="checkbox"
                      checked={selected.has(msg.id)}
                      onChange={() => toggleOne(msg.id)}
                      onClick={e => e.stopPropagation()}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-4 py-3 pr-6">
                  <span className={`badge-${msg.direction}`}>
                    {msg.direction === 'inbound' ? 'Received' : 'Sent'}
                  </span>
                </td>
                <td className="px-4 py-3 pr-6 font-mono text-gray-700" title={msg.direction === 'inbound' ? msg.sender : msg.recipient}>
                  {msg.direction === 'inbound'
                    ? (msg.sender_name || msg.sender)
                    : (msg.recipient_name || msg.recipient)}
                </td>
                <td className="hidden sm:table-cell px-4 py-3 pr-6 text-gray-500">
                  {msg.port_sim_number
                    ? <span className="font-mono">{msg.port_sim_number}</span>
                    : msg.port ? `Port ${msg.port}` : '—'}
                </td>
                <td className="px-4 py-3 truncate text-gray-800 max-w-[160px] sm:max-w-[200px]" title={msg.content}>
                  {msg.content}
                </td>
                <td className="px-4 py-3">
                  <span className={`badge-${msg.status}`}>{msg.status}</span>
                </td>
                <td className="hidden sm:table-cell px-4 py-3 text-gray-500 whitespace-nowrap">
                  {format(new Date(msg.created_at + (msg.created_at.endsWith('Z') ? '' : 'Z')), 'MM/dd/yyyy HH:mm', { locale: enUS })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">Delete {selected.size} message{selected.size !== 1 ? 's' : ''}?</p>
                <p className="text-sm text-gray-500 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
