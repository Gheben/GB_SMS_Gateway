import { useEffect, useState, useCallback } from 'react'
import { portsApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { Pencil, Check, X, Smartphone, Loader2, ToggleLeft, ToggleRight } from 'lucide-react'

function StatusBadge({ status }) {
  if (status === 'READY') return <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-100 text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Active</span>
  if (status === 'DOWN')  return <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />Unreg.</span>
  return <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">{status || 'N/A'}</span>
}

function EditableCell({ initialValue, onSave, placeholder, mono = false }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialValue || '')
  const [saving, setSaving] = useState(false)

  // sync when parent reloads data
  useEffect(() => { if (!editing) setValue(initialValue || '') }, [initialValue, editing])

  async function handleSave() {
    setSaving(true)
    try { await onSave(value.trim()) } catch {}
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          className={`text-xs border border-blue-300 rounded px-1.5 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-blue-400 ${mono ? 'font-mono' : ''}`}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
          placeholder={placeholder}
        />
        <button onClick={handleSave} disabled={saving} className="text-green-600 hover:text-green-800 p-0.5">{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}</button>
        <button onClick={() => { setValue(initialValue || ''); setEditing(false) }} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={13} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 group min-w-0">
      {initialValue
        ? <span className={`text-xs truncate max-w-[120px] ${mono ? 'font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800' : 'text-gray-700'}`}>{initialValue}</span>
        : <span className="text-xs text-gray-300 italic">{'\u2014'}</span>}
      <button
        onClick={() => { setValue(initialValue || ''); setEditing(true) }}
        className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0"
      >
        <Pencil size={11} />
      </button>
    </div>
  )
}

function EditableLimitCell({ initialValue, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(initialValue ?? 0))
  const [saving, setSaving] = useState(false)

  // sync when parent reloads data
  useEffect(() => { if (!editing) setValue(String(initialValue ?? 0)) }, [initialValue, editing])

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
          className="text-xs border border-blue-300 rounded px-1.5 py-1 w-16 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
        />
        <button onClick={handleSave} disabled={saving} className="text-green-600 hover:text-green-800 p-0.5">{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}</button>
        <button onClick={() => { setValue(String(initialValue ?? 0)); setEditing(false) }} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={13} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 group">
      {(initialValue ?? 0) === 0
        ? <span className="text-xs text-gray-300 italic">no limit</span>
        : <span className="text-xs text-gray-700 font-medium tabular-nums">{initialValue}</span>}
      <button
        onClick={() => { setValue(String(initialValue ?? 0)); setEditing(true) }}
        className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0"
        title="Set monthly SMS limit (0 = no limit)"
      >
        <Pencil size={11} />
      </button>
    </div>
  )
}

function SimRow({ port, onSaved }) {
  const [toggling, setToggling] = useState(false)

  async function toggleBalanced() {
    setToggling(true)
    try {
      await portsApi.setPortInfo(port.device_id, port.port_number, { balanced: !port.balanced })
      await onSaved()
    } catch {}
    setToggling(false)
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-xs text-gray-700 font-medium whitespace-nowrap">{port.device_name}</td>
      <td className="px-3 py-2 text-xs text-gray-800 font-mono whitespace-nowrap">T{port.port_number}</td>
      <td className="px-3 py-2 whitespace-nowrap"><StatusBadge status={port.status} /></td>
      <td className="px-3 py-2">
        <EditableCell
          initialValue={port.operator}
          placeholder="e.g. TIM"
          onSave={operator => portsApi.setPortInfo(port.device_id, port.port_number, { operator }).then(onSaved)}
        />
      </td>
      <td className="px-3 py-2">
        <EditableCell
          initialValue={port.sim_number}
          placeholder="+39..."
          mono
          onSave={sim_number => portsApi.setPortInfo(port.device_id, port.port_number, { sim_number }).then(onSaved)}
        />
      </td>
      <td className="px-3 py-2">
        <EditableLimitCell
          initialValue={port.monthly_limit}
          onSave={monthly_limit => portsApi.setPortInfo(port.device_id, port.port_number, { monthly_limit }).then(onSaved)}
        />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          onClick={toggleBalanced}
          disabled={toggling}
          title={port.balanced ? 'Remove from balanced pool' : 'Add to balanced pool'}
          className="flex items-center gap-1 text-xs font-medium transition-colors focus:outline-none"
        >
          {toggling
            ? <Loader2 size={15} className="animate-spin text-gray-400" />
            : port.balanced
              ? <><ToggleRight size={18} className="text-blue-600" /><span className="text-blue-600">Yes</span></>
              : <><ToggleLeft  size={18} className="text-gray-400" /><span className="text-gray-400">No</span></>
          }
        </button>
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
      setPorts(all.filter(p => p.status === 'READY' || p.status === 'DOWN'))
    } catch {}
    setLoading(false)
  }, [])

  // Silent reload: no spinner, just update data in place (used after inline edits)
  const silentReload = useCallback(async () => {
    try {
      const all = await portsApi.getAll()
      setPorts(all.filter(p => p.status === 'READY' || p.status === 'DOWN'))
    } catch {}
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
        Configure each active SIM port: carrier, phone number, monthly send limit and whether it participates in balanced auto-routing (<span className="font-mono text-xs bg-gray-100 px-1 rounded">port="auto"</span>).
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
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Device</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Port</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Carrier</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">SIM Number</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider" title="Max outbound SMS per month (0 = no limit)">Limit/mo</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider" title="Include in balanced auto-routing pool">Balanced</th>
              </tr>
            </thead>
            <tbody>
              {ports.map(port => (
                <SimRow
                  key={`${port.device_id}-${port.port_number}`}
                  port={port}
                  onSaved={silentReload}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
