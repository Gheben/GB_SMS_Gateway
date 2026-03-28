import { useEffect, useState, useCallback } from 'react'
import { portsApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { Pencil, Check, X, Smartphone, Loader2 } from 'lucide-react'

function StatusBadge({ status }) {
  if (status === 'READY') return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Active</span>
  if (status === 'DOWN')  return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />Unregistered</span>
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">{status || 'N/A'}</span>
}

function EditableCell({ initialValue, onSave, placeholder, mono = false }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialValue || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try { await onSave(value.trim()) } catch {}
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className={`text-sm border border-blue-300 rounded px-2 py-1 w-44 focus:outline-none focus:ring-1 focus:ring-blue-400 ${mono ? 'font-mono' : ''}`}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
          placeholder={placeholder}
        />
        <button onClick={handleSave} disabled={saving} className="text-green-600 hover:text-green-800 p-1"><Check size={15} /></button>
        <button onClick={() => { setValue(initialValue || ''); setEditing(false) }} className="text-gray-400 hover:text-gray-600 p-1"><X size={15} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 group">
      {initialValue
        ? <span className={`text-sm ${mono ? 'font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-800' : 'text-gray-700'}`}>{initialValue}</span>
        : <span className="text-xs text-gray-400 italic">not set</span>}
      <button
        onClick={() => { setValue(initialValue || ''); setEditing(true) }}
        className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
      >
        <Pencil size={13} />
      </button>
    </div>
  )
}

function EditableLimitCell({ initialValue, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(initialValue ?? 0))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 0) { setEditing(false); return }
    setSaving(true)
    try { await onSave(num) } catch {}
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="number"
          min="0"
          step="1"
          className="text-sm border border-blue-300 rounded px-2 py-1 w-24 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
        />
        <button onClick={handleSave} disabled={saving} className="text-green-600 hover:text-green-800 p-1"><Check size={15} /></button>
        <button onClick={() => { setValue(String(initialValue ?? 0)); setEditing(false) }} className="text-gray-400 hover:text-gray-600 p-1"><X size={15} /></button>
      </div>
    )
  }

  const display = (initialValue ?? 0) === 0 ? '—' : String(initialValue)
  return (
    <div className="flex items-center gap-2 group">
      <span className="text-sm text-gray-700" title="Max SMS per month (0 = no limit)">{display === '—' ? <span className="text-gray-300 italic text-xs">no limit</span> : display}</span>
      <button
        onClick={() => { setValue(String(initialValue ?? 0)); setEditing(true) }}
        className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
        title="Set monthly SMS limit (0 = no limit)"
      >
        <Pencil size={13} />
      </button>
    </div>
  )
}

function SimRow({ port, onSaved }) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-3 text-sm text-gray-700 font-medium">{port.device_name}</td>
      <td className="px-4 py-3 text-sm text-gray-800 font-mono">T{port.port_number}</td>
      <td className="px-4 py-3"><StatusBadge status={port.status} /></td>
      <td className="px-4 py-3">
        <EditableCell
          initialValue={port.operator}
          placeholder="e.g. T-Mobile Business"
          onSave={operator => portsApi.setPortInfo(port.device_id, port.port_number, { operator }).then(onSaved)}
        />
      </td>
      <td className="px-4 py-3">
        <EditableCell
          initialValue={port.sim_number}
          placeholder="+1 555 123 4567"
          mono
          onSave={sim_number => portsApi.setPortInfo(port.device_id, port.port_number, { sim_number }).then(onSaved)}
        />
      </td>
      <td className="px-4 py-3">
        <EditableLimitCell
          initialValue={port.monthly_limit}
          onSave={monthly_limit => portsApi.setPortInfo(port.device_id, port.port_number, { monthly_limit }).then(onSaved)}
        />
      </td>
    </tr>
  )
}

export default function SimMapping() {
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await portsApi.getAll()
      // Solo porte con SIM inserita (READY o DOWN)
      setPorts(all.filter(p => p.status === 'READY' || p.status === 'DOWN'))
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useWebSocket(useCallback((msg) => {
    if (msg.type === 'port:info' || msg.type === 'device:connected') load()
  }, [load]))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Smartphone size={22} className="text-blue-600" />
        <h2 className="text-2xl font-bold text-gray-800">SIM Mapping</h2>
      </div>
      <p className="text-sm text-gray-500">
        Associate a phone number and monthly send limit with each active SIM port. The SIM number is informational; the limit controls how many outbound SMS this SIM can send per month when using balanced auto-routing (<span className="font-mono text-xs bg-gray-100 px-1 rounded">port="auto"</span>).
      </p>

      {loading ? (
        <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading...
        </div>
      ) : ports.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Smartphone size={40} className="mx-auto mb-3 opacity-30" />
          <p>No SIM ports detected.</p>
          <p className="text-xs mt-1">Ports are updated automatically when devices connect.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Device</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Port</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Carrier</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">SIM Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider" title="Max outbound SMS per month for this SIM (0 = no limit)">Monthly Limit</th>
              </tr>
            </thead>
            <tbody>
              {ports.map(port => (
                <SimRow
                  key={`${port.device_id}-${port.port_number}`}
                  port={port}
                  onSaved={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

