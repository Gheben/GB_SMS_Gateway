import { useEffect, useState } from 'react'
import { phonebookApi } from '../api'
import { X, Search, Loader2, BookOpen } from 'lucide-react'

export default function ContactPickerModal({ onSelect, onClose }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    phonebookApi.getAll()
      .then(setContacts)
      .catch(e => setError(e.response?.data?.error || 'Failed to load contacts'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = contacts.filter(c => {
    const q = query.toLowerCase()
    return c.display_name.toLowerCase().includes(q) || c.phone.includes(q)
  })

  function handleConfirm() {
    if (selected) onSelect(selected)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        style={{ maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <BookOpen size={16} /> Select contact
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-full p-1 hover:bg-gray-200">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              type="text"
              placeholder="Search by name or phone…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="input pl-9"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center items-center py-12 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-500 text-sm px-4">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No contacts found.</div>
          ) : (
            <ul>
              {filtered.map(c => (
                <li
                  key={c.id}
                  onClick={() => setSelected(c)}
                  onDoubleClick={() => { setSelected(c); onSelect(c) }}
                  className={`flex items-center justify-between px-5 py-3 cursor-pointer border-b border-gray-50 transition-colors ${selected?.id === c.id ? 'bg-blue-50 border-blue-100' : 'hover:bg-gray-50'}`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${selected?.id === c.id ? 'text-blue-800' : 'text-gray-800'}`}>{c.display_name}</p>
                    <p className="text-xs font-mono text-gray-500">{c.phone}</p>
                  </div>
                  <span className={`ml-3 flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.source === 'ldap' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.source === 'ldap' ? 'LDAP' : 'Local'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="btn-primary flex-1 text-sm disabled:opacity-50"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  )
}
