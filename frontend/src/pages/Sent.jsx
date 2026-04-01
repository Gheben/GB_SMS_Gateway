import { useEffect, useState, useCallback } from 'react'
import { messagesApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import MessageTable from '../components/MessageTable'
import MessageDetailModal from '../components/MessageDetailModal'
import { Send } from 'lucide-react'

export default function Sent() {
  const [messages, setMessages] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedMsg, setSelectedMsg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await messagesApi.getAll({ direction: 'outbound', page, limit, search: search || undefined })
      setMessages(res.data)
      setTotal(res.total)
    } catch {}
    setLoading(false)
  }, [page, limit, search])

  useEffect(() => { load() }, [load])

  useWebSocket(useCallback((msg) => {
    if (msg.type === 'sms:sent') load()
  }, [load]))

  const totalPages = Math.ceil(total / limit)

  async function handleDoubleClick(msg) {
    const full = await messagesApi.getById(msg.id)
    setSelectedMsg(full)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Send size={22} className="text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-800">Sent SMS</h2>
        </div>
        <span className="text-sm text-gray-500">{total} messaggi</span>
      </div>

      <input
        type="text"
        placeholder="Search by recipient or message text..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        className="w-full max-w-sm border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <MessageTable messages={messages} loading={loading} onDoubleClick={handleDoubleClick} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Rows per page:</span>
          {[10, 25, 50].map(n => (
            <button key={n} onClick={() => { setLimit(n); setPage(1) }}
              className={`px-2.5 py-0.5 rounded border text-xs font-medium transition-colors ${
                limit === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-100'
              }`}>
              {n}
            </button>
          ))}
        </div>
        {totalPages > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-100">
              ← Prev
            </button>
            <span className="px-3 py-1 text-sm text-gray-600">Page {page} / {Math.max(1, totalPages)}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-100">
              Next →
            </button>
          </div>
        )}
      </div>

      {selectedMsg && <MessageDetailModal msg={selectedMsg} onClose={() => setSelectedMsg(null)} />}
    </div>
  )
}
