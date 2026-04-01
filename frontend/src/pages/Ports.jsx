import { useEffect, useState, useCallback, useRef } from 'react'
import { portsApi, rulesApi, localGroupsApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { Pencil, Check, X, Smartphone, Loader2, ToggleLeft, ToggleRight, AlertCircle } from 'lucide-react'

function StatusBadge({ status }) {
  if (status === 'READY') return <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-100 text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Active</span>
  if (status === 'DOWN')  return <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />Unreg.</span>
  return <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">{status || 'N/A'}</span>
}

// EditableCell: text fields (operator, sim_number)
// Uses local `confirmed` state for display so it never depends on prop-update timing
function EditableCell({ initialValue, onSave, placeholder, mono = false }) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState('')
  const [confirmed, setConfirmed] = useState(initialValue || '')
  const [saving, setSaving]     = useState(false)
  const [errMsg, setErrMsg]     = useState(null)

  // Sync from parent only when NOT editing (e.g. WebSocket-triggered full refresh)
  useEffect(() => {
    if (!editing) setConfirmed(initialValue || '')
  }, [initialValue, editing])

  function startEdit() {
    setDraft(confirmed)
    setErrMsg(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setErrMsg(null)
  }

  async function handleSave() {
    const trimmed = draft.trim()
    setSaving(true)
    setErrMsg(null)
    try {
      await onSave(trimmed)
      setConfirmed(trimmed)   // update display immediately on success
      setEditing(false)
    } catch (e) {
      const msg = e?.response?.data?.errors?.[0]?.msg || e?.response?.data?.error || 'Save failed'
      setErrMsg(msg)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className={`text-xs border border-blue-300 rounded px-1.5 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-blue-400 ${mono ? 'font-mono' : ''}`}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancel() }}
            placeholder={placeholder}
          />
          <button onClick={handleSave} disabled={saving} className="text-green-600 hover:text-green-800 p-0.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          </button>
          <button onClick={cancel} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={13} /></button>
        </div>
        {errMsg && <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle size={11} />{errMsg}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 group min-w-0">
      {confirmed
        ? <span className={`text-xs truncate max-w-[120px] ${mono ? 'font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800' : 'text-gray-700'}`}>{confirmed}</span>
        : <span className="text-xs text-gray-300 italic">{'\u2014'}</span>}
      <button onClick={startEdit} className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0">
        <Pencil size={11} />
      </button>
    </div>
  )
}

// EditableLimitCell: numeric field for monthly_limit
// Same pattern: local `confirmed` (number) drives display
function EditableLimitCell({ initialValue, onSave }) {
  const [editing, setEditing]     = useState(false)
  const [draft, setDraft]         = useState('')
  const [confirmed, setConfirmed] = useState(initialValue ?? 0)
  const [saving, setSaving]       = useState(false)
  const [errMsg, setErrMsg]       = useState(null)

  // Sync from parent only when NOT editing
  useEffect(() => {
    if (!editing) setConfirmed(initialValue ?? 0)
  }, [initialValue, editing])

  function startEdit() {
    setDraft(String(confirmed))
    setErrMsg(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setErrMsg(null)
  }

  async function handleSave() {
    // Empty input → treat as 0 (no limit)
    const num = draft.trim() === '' ? 0 : parseInt(draft, 10)
    if (isNaN(num) || num < 0) { cancel(); return }
    setSaving(true)
    setErrMsg(null)
    try {
      await onSave(num)
      setConfirmed(num)     // update display immediately on success
      setEditing(false)
    } catch (e) {
      const msg = e?.response?.data?.errors?.[0]?.msg || e?.response?.data?.error || 'Save failed'
      setErrMsg(msg)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="number"
            min="0"
            step="1"
            className="text-xs border border-blue-300 rounded px-1.5 py-1 w-16 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') cancel() }}
          />
          <button onClick={handleSave} disabled={saving} className="text-green-600 hover:text-green-800 p-0.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          </button>
          <button onClick={cancel} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={13} /></button>
        </div>
        {errMsg && <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle size={11} />{errMsg}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 group">
      {confirmed === 0
        ? <span className="text-xs text-gray-300 italic">no limit</span>
        : <span className="text-xs text-gray-700 font-medium tabular-nums">{confirmed}</span>}
      <button
        onClick={startEdit}
        className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 flex-shrink-0"
        title="Set monthly SMS limit (0 = no limit)"
      >
        <Pencil size={11} />
      </button>
    </div>
  )
}

function RulesPopover({ rules, localGroups }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (rules.length === 0) {
    return <span className="text-gray-300 text-xs italic">—</span>
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 transition-colors"
        title="Click to see rules using this SIM"
      >
        {rules.length} rule{rules.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-1.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Rules using this SIM</p>
          {rules.map(r => {
            const ldapGroups = r.allowed_groups || []
            const lgIds = r.allowed_local_groups || []
            const lgNames = lgIds.map(id => localGroups.find(g => g.id === id)?.name || id)
            const allGroups = [...ldapGroups, ...lgNames]
            return (
              <div key={r.id} className="pb-2 border-b border-gray-100 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-xs text-gray-800 font-medium truncate">{r.name}</span>
                  {!r.enabled && <span className="text-[10px] text-gray-400 flex-shrink-0">disabled</span>}
                </div>
                {allGroups.length > 0 && (
                  <div className="mt-1 ml-3.5 flex flex-wrap gap-1">
                    {allGroups.map(g => (
                      <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-100 font-medium truncate max-w-[180px]" title={g}>{g}</span>
                    ))}
                  </div>
                )}
                {allGroups.length === 0 && (
                  <span className="ml-3.5 text-[10px] text-gray-400 italic">all users</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SimRow({ port, rules, localGroups, onPortUpdate }) {
  const [toggling, setToggling] = useState(false)

  async function toggleBalanced() {
    setToggling(true)
    try {
      const newVal = port.balanced ? 0 : 1
      await portsApi.setPortInfo(port.device_id, port.port_number, { balanced: newVal === 1 })
      onPortUpdate(port.device_id, port.port_number, { balanced: newVal })
    } catch {}
    setToggling(false)
  }

  // Rules that reference this specific port (match_type='port') or this device (match_type='device')
  const matchingRules = rules.filter(r =>
    r.conditions?.some(c =>
      (c.match_type === 'port' && c.device_id === port.device_id && parseInt(c.match_value, 10) === port.port_number) ||
      (c.match_type === 'device' && c.device_id === port.device_id)
    )
  )

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-xs text-gray-700 font-medium whitespace-nowrap">{port.device_name}</td>
      <td className="px-3 py-2 text-xs text-gray-800 font-mono whitespace-nowrap">T{port.port_number}</td>
      <td className="px-3 py-2 whitespace-nowrap"><StatusBadge status={port.status} /></td>
      <td className="px-3 py-2">
        <EditableCell
          initialValue={port.operator}
          placeholder="e.g. Wind"
          onSave={async operator => {
            await portsApi.setPortInfo(port.device_id, port.port_number, { operator })
            onPortUpdate(port.device_id, port.port_number, { operator: operator || null })
          }}
        />
      </td>
      <td className="px-3 py-2">
        <EditableCell
          initialValue={port.sim_number}
          placeholder="+39..."
          mono
          onSave={async sim_number => {
            await portsApi.setPortInfo(port.device_id, port.port_number, { sim_number })
            onPortUpdate(port.device_id, port.port_number, { sim_number: sim_number || null })
          }}
        />
      </td>
      <td className="px-3 py-2">
        <EditableLimitCell
          initialValue={port.monthly_limit}
          onSave={async monthly_limit => {
            await portsApi.setPortInfo(port.device_id, port.port_number, { monthly_limit })
            onPortUpdate(port.device_id, port.port_number, { monthly_limit })
          }}
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
      <td className="px-3 py-2">
        <RulesPopover rules={matchingRules} localGroups={localGroups} />
      </td>
    </tr>
  )
}

export default function SimMapping() {
  const [ports, setPorts]         = useState([])
  const [rules, setRules]         = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [loading, setLoading]     = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [all, ruleList, groupList] = await Promise.all([portsApi.getAll(), rulesApi.getAll(), localGroupsApi.getAll()])
      setPorts(all.filter(p => p.status === 'READY' || p.status === 'DOWN'))
      setRules(ruleList)
      setLocalGroups(groupList)
    } catch {}
    setLoading(false)
  }, [])

  const silentReload = useCallback(async () => {
    try {
      const all = await portsApi.getAll()
      setPorts(all.filter(p => p.status === 'READY' || p.status === 'DOWN'))
    } catch {}
  }, [])

  const handlePortUpdate = useCallback((deviceId, portNumber, updates) => {
    setPorts(prev => prev.map(p =>
      p.device_id === deviceId && p.port_number === portNumber ? { ...p, ...updates } : p
    ))
  }, [])

  useEffect(() => { load() }, [load])

  useWebSocket(useCallback((msg) => {
    if (msg.type === 'port:info' || msg.type === 'device:connected') silentReload()
  }, [silentReload]))

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
          <table className="min-w-[700px] text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Device</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Port</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Carrier</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">SIM Number</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider" title="Max outbound SMS per month (0 = no limit)">Limit/mo</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider" title="Include in balanced auto-routing pool">Balanced</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider" title="Forward rules using this SIM port">Rules</th>
              </tr>
            </thead>
            <tbody>
              {ports.map(port => (
                <SimRow
                  key={`${port.device_id}-${port.port_number}`}
                  port={port}
                  rules={rules}
                  localGroups={localGroups}
                  onPortUpdate={handlePortUpdate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
