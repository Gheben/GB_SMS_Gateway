import { useEffect, useState, useCallback } from 'react'
import { portsApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { Pencil, Check, X, Smartphone, Loader2 } from 'lucide-react'

function StatusBadge({ status }) {
  if (status === 'READY') return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Attiva</span>
  if (status === 'DOWN')  return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />Non registrata</span>
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">{status || 'N/D'}</span>
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
        : <span className="text-xs text-gray-400 italic">non impostato</span>}
      <button
        onClick={() => { setValue(initialValue || ''); setEditing(true) }}
        className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
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
          placeholder="es. Wind3Business"
          onSave={operator => portsApi.setPortInfo(port.device_id, port.port_number, { operator }).then(onSaved)}
        />
      </td>
      <td className="px-4 py-3">
        <EditableCell
          initialValue={port.sim_number}
          placeholder="+39 333 1234567"
          mono
          onSave={sim_number => portsApi.setPortInfo(port.device_id, port.port_number, { sim_number }).then(onSaved)}
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
        <h2 className="text-2xl font-bold text-gray-800">Mappatura SIM</h2>
      </div>
      <p className="text-sm text-gray-500">
        Associa un numero di telefono a ogni porta con SIM attiva. Il numero è puramente informativo e viene usato per identificare quale SIM ha ricevuto un messaggio.
      </p>

      {loading ? (
        <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Caricamento...
        </div>
      ) : ports.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Smartphone size={40} className="mx-auto mb-3 opacity-30" />
          <p>Nessuna porta con SIM rilevata.</p>
          <p className="text-xs mt-1">Le porte vengono aggiornate automaticamente alla connessione dei dispositivi.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Dispositivo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Porta</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stato</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Operatore</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Numero SIM</th>
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

