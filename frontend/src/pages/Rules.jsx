import { useEffect, useState, useCallback } from 'react'
import { rulesApi, devicesApi, portsApi, ldapApi, localGroupsApi, phonebookApi } from '../api'
import PhonebookAutocomplete from '../components/PhonebookAutocomplete'
import { Plus, Pencil, Trash2, PlayCircle, X, Users, UsersRound, Loader2, Copy, Pause, Play, Filter } from 'lucide-react'

const MATCH_TYPES = [
  { value: 'sender',          label: 'Exact sender' },
  { value: 'sender_contains', label: 'Sender contains' },
  { value: 'sender_regex',    label: 'Sender (regex)' },
  { value: 'content',         label: 'Text contains' },
  { value: 'content_regex',   label: 'Text (regex)' },
  { value: 'device',          label: 'Specific device' },
  { value: 'port',            label: 'Specific port' },
]
const ALL_MATCH_TYPES = [{ value: 'any', label: 'Any SMS (no filter)' }, ...MATCH_TYPES]

function emptyCondition() {
  return { _key: Math.random(), match_type: 'sender', match_value: '', device_id: '' }
}

const EMPTY_RULE = {
  name: '', enabled: true, priority: 0,
  condition_operator: 'AND',
  conditions: [emptyCondition()],
  stop_on_match: false,
  targets: [''],
  sms_targets: [''],
  allowed_groups: [],
  allowed_local_groups: [],
  webhook_url: '',
  webhook_method: 'POST',
}

function ConditionRow({ cond, total, devices, ports, onChange, onRemove }) {
  const needsTextValue = !['any', 'device', 'port'].includes(cond.match_type)
  const needsDevice = cond.match_type === 'device'
  const needsPort = cond.match_type === 'port'

  // For port condition: filter ports by selected device (if any), only those with a SIM number
  const availablePorts = needsPort
    ? ports.filter(p => (!cond.device_id || p.device_id === cond.device_id) && p.sim_number)
    : []

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex gap-2 items-start">
        <select
          className="input flex-1"
          value={cond.match_type}
          onChange={e => onChange({ ...cond, match_type: e.target.value, match_value: '', device_id: '' })}
        >
          {ALL_MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        {total > 1 && (
          <button type="button" onClick={onRemove}
            className="text-red-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50 flex-shrink-0">
            <X size={15} />
          </button>
        )}
      </div>
      {needsTextValue && (
        <input className="input" value={cond.match_value}
          placeholder={cond.match_type.includes('regex') ? 'E.g.: ^\\+1|^001' : 'E.g.: +15551234567'}
          onChange={e => onChange({ ...cond, match_value: e.target.value })} />
      )}
      {needsDevice && (
        <select className="input" value={cond.device_id}
          onChange={e => onChange({ ...cond, device_id: e.target.value })}>
          <option value="">-- select device --</option>
          {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {needsPort && (
        <>
          <select className="input" value={cond.device_id}
            onChange={e => onChange({ ...cond, device_id: e.target.value, match_value: '' })}>
            <option value="">-- filter by device (optional) --</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input"
            value={cond.device_id && cond.match_value ? `${cond.device_id}:${cond.match_value}` : ''}
            onChange={e => {
              const val = e.target.value
              if (!val) { onChange({ ...cond, device_id: '', match_value: '' }); return }
              const found = ports.find(p => p.sim_number && `${p.device_id}:${p.port_number}` === val)
              if (found) onChange({ ...cond, device_id: found.device_id, match_value: String(found.port_number) })
            }}>
            <option value="">-- select SIM port --</option>
            {availablePorts.map(p => (
              <option key={`${p.device_id}-${p.port_number}`} value={`${p.device_id}:${p.port_number}`}>
                Port {p.port_number}{p.sim_number ? ` — ${p.sim_number}` : ''}{p.operator ? ` (${p.operator})` : ''}
              </option>
            ))}
          </select>
          {availablePorts.length === 0 && (
            <p className="text-xs text-amber-600">No SIM ports found{cond.device_id ? ' for the selected device' : ''}.</p>
          )}
        </>
      )}
    </div>
  )
}

function RuleModal({ rule, devices, ports, ldapGroups, localGroups, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!rule) return { ...EMPTY_RULE, conditions: [emptyCondition()] }
    return {
      name: rule.name,
      enabled: !!rule.enabled,
      priority: rule.priority,
      condition_operator: rule.condition_operator || 'AND',
      conditions: rule.conditions?.length
        ? rule.conditions.map(c => ({ ...c, _key: Math.random() }))
        : [emptyCondition()],
      stop_on_match: !!rule.stop_on_match,
      targets: rule.targets?.map(t => t.email) || [''],
      sms_targets: Array.isArray(rule.sms_targets) && rule.sms_targets.length > 0 ? rule.sms_targets : [''],
      allowed_groups: Array.isArray(rule.allowed_groups) ? rule.allowed_groups : [],
      allowed_local_groups: Array.isArray(rule.allowed_local_groups) ? rule.allowed_local_groups : [],
      webhook_url: rule.webhook_url || '',
      webhook_method: rule.webhook_method || 'POST',
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [phonebookContacts, setPhonebookContacts] = useState([])

  useEffect(() => {
    phonebookApi.getAll().then(c => setPhonebookContacts(c || [])).catch(() => {})
  }, [])

  function toggleGroup(dn, checked) {
    setForm(p => ({
      ...p,
      allowed_groups: checked
        ? [...p.allowed_groups, dn]
        : p.allowed_groups.filter(g => g !== dn),
    }))
  }

  function toggleLocalGroup(id, checked) {
    setForm(p => ({
      ...p,
      allowed_local_groups: checked
        ? [...p.allowed_local_groups, id]
        : p.allowed_local_groups.filter(g => g !== id),
    }))
  }

  function updateCond(i, val) {
    setForm(p => { const c = [...p.conditions]; c[i] = val; return { ...p, conditions: c } })
  }
  function addCond() {
    setForm(p => ({ ...p, conditions: [...p.conditions, emptyCondition()] }))
  }
  function removeCond(i) {
    setForm(p => ({ ...p, conditions: p.conditions.filter((_, n) => n !== i) }))
  }
  function setTarget(i, val) {
    setForm(p => { const t = [...p.targets]; t[i] = val; return { ...p, targets: t } })
  }
  function addTarget() { setForm(p => ({ ...p, targets: [...p.targets, ''] })) }
  function removeTarget(i) {
    setForm(p => ({ ...p, targets: p.targets.length > 1 ? p.targets.filter((_, n) => n !== i) : p.targets }))
  }
  function setSmsTarget(i, val) {
    setForm(p => { const t = [...p.sms_targets]; t[i] = val; return { ...p, sms_targets: t } })
  }
  function addSmsTarget() { setForm(p => ({ ...p, sms_targets: [...p.sms_targets, ''] })) }
  function removeSmsTarget(i) {
    setForm(p => ({ ...p, sms_targets: p.sms_targets.length > 1 ? p.sms_targets.filter((_, n) => n !== i) : p.sms_targets }))
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const payload = {
      name: form.name,
      enabled: form.enabled,
      priority: parseInt(form.priority, 10) || 0,
      condition_operator: form.condition_operator,
      conditions: form.conditions.map(c => ({
        match_type: c.match_type,
        match_value: ['any', 'device'].includes(c.match_type) ? undefined : (c.match_value || undefined),
        device_id: ['device', 'port'].includes(c.match_type) ? (c.device_id || undefined) : undefined,
      })),
      stop_on_match: form.stop_on_match,
      targets: form.targets.filter(Boolean),
      sms_targets: form.sms_targets.filter(Boolean),
      allowed_groups: form.allowed_groups,
      allowed_local_groups: form.allowed_local_groups,
      webhook_url: form.webhook_url || undefined,
      webhook_method: form.webhook_method || 'POST',
    }
    try {
      if (rule?.id) await rulesApi.update(rule.id, payload)
      else await rulesApi.create(payload)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Errore')
    } finally { setSaving(false) }
  }

  const multiCond = form.conditions.length > 1

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 m-4 my-8">
        <h3 className="text-lg font-bold mb-4">{rule?.id ? 'Edit rule' : rule ? 'Duplicate rule' : 'New forwarding rule'}</h3>
        <form onSubmit={submit} className="space-y-4">

          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Rule name" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
            <div className="w-24">
              <label className="label">Priority</label>
              <input className="input" type="number" value={form.priority}
                onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} />
            </div>
          </div>

          {/* Condizioni */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Trigger conditions</label>
              {multiCond && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Operator:</span>
                  {['AND', 'OR'].map(op => (
                    <button key={op} type="button"
                      onClick={() => setForm(p => ({ ...p, condition_operator: op }))}
                      className={`text-xs px-2 py-0.5 rounded font-semibold border transition-colors ${
                        form.condition_operator === op
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>
                      {op === 'AND' ? <span>AND <span className="hidden sm:inline">(all true)</span></span> : <span>OR <span className="hidden sm:inline">(at least one)</span></span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1">
              {form.conditions.map((c, i) => (
                <div key={c._key}>
                  {i > 0 && (
                    <p className="text-center text-xs font-bold text-gray-400 py-1 tracking-widest">
                      {form.condition_operator === 'OR' ? '— OR —' : '— AND —'}
                    </p>
                  )}
                  <ConditionRow cond={c} total={form.conditions.length} devices={devices} ports={ports}
                    onChange={val => updateCond(i, val)} onRemove={() => removeCond(i)} />
                </div>
              ))}
            </div>
            <button type="button" onClick={addCond}
              className="mt-2 text-blue-600 text-sm hover:underline flex items-center gap-1">
              <Plus size={13} /> Add condition
            </button>
          </div>

          {/* Destinatari email */}
          <div>
            <label className="label">Email recipients <span className="text-gray-400 font-normal">(optional)</span></label>
            {form.targets.map((t, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <PhonebookAutocomplete
                  mode="email"
                  contacts={phonebookContacts}
                  value={t}
                  onChange={v => setTarget(i, v)}
                  placeholder="user@company.com"
                  className="input flex-1"
                />
                {form.targets.length > 1 && (
                  <button type="button" onClick={() => removeTarget(i)} className="text-red-400 px-2">✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addTarget} className="text-blue-600 text-sm hover:underline">+ Add email</button>
          </div>

          {/* Inoltro SMS */}
          <div>
            <label className="label">SMS forwarding <span className="text-gray-400 font-normal">(optional)</span></label>
            {form.sms_targets.map((s, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <PhonebookAutocomplete
                  mode="phone"
                  contacts={phonebookContacts}
                  value={s}
                  onChange={v => setSmsTarget(i, v)}
                  placeholder="+15551234567"
                  className="input flex-1"
                />
                {form.sms_targets.length > 1 && (
                  <button type="button" onClick={() => removeSmsTarget(i)} className="text-red-400 px-2">✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addSmsTarget} className="text-blue-600 text-sm hover:underline">+ Add number</button>
            <p className="text-xs text-gray-400 mt-1">The SMS will be sent using the same SIM that received the message.</p>
          </div>

          {/* Webhook */}
          <div>
            <label className="label">Webhook <span className="text-gray-400 font-normal">(optional)</span></label>
            <div className="flex gap-2">
              <select
                className="input w-24 flex-shrink-0"
                value={form.webhook_method}
                onChange={e => setForm(p => ({ ...p, webhook_method: e.target.value }))}
              >
                <option>POST</option>
                <option>GET</option>
                <option>PUT</option>
              </select>
              <input
                className="input flex-1"
                placeholder="http://myserver.internal/webhook"
                value={form.webhook_url}
                onChange={e => setForm(p => ({ ...p, webhook_url: e.target.value }))}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">The destination hostname must be in the whitelist in Settings → Webhook.</p>
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled}
                onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))} /> Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.stop_on_match}
                onChange={e => setForm(p => ({ ...p, stop_on_match: e.target.checked }))} />
              <span title="If active, subsequent rules are not evaluated">Stop on match</span>
            </label>
          </div>

          {/* Visibilità messaggi per gruppo LDAP */}
          <div>
            <label className="label flex items-center gap-1.5">
              <Users size={13} />LDAP group visibility
              <span className="text-gray-400 font-normal"> — leave empty for all users</span>
            </label>
            {ldapGroups.length > 0 ? (
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                {ldapGroups.map(g => (
                  <label key={g.group_dn} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.allowed_groups.includes(g.group_dn)}
                      onChange={e => toggleGroup(g.group_dn, e.target.checked)}
                      className="accent-blue-600 flex-shrink-0"
                    />
                    <span className="font-mono text-xs flex-1 truncate" title={g.group_dn}>{g.group_dn}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
                      g.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>{g.role}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                No LDAP groups mapped. Add them in{' '}
                <strong>User management → LDAP / Active Directory</strong> to restrict visibility.
              </p>
            )}
          </div>

          {/* Visibilità messaggi per gruppi locali */}
          <div>
            <label className="label flex items-center gap-1.5">
              <UsersRound size={13} />Local group visibility
              <span className="text-gray-400 font-normal"> — leave empty for all users</span>
            </label>
            {localGroups.length > 0 ? (
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                {localGroups.map(g => (
                  <label key={g.id} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.allowed_local_groups.includes(g.id)}
                      onChange={e => toggleLocalGroup(g.id, e.target.checked)}
                      className="accent-indigo-600 flex-shrink-0"
                    />
                    <span className="flex-1 truncate" title={g.name}>{g.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
                      g.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>{g.role}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                No local groups. Create one in{' '}
                <strong>User management → Local groups</strong>.
              </p>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TestModal({ devices, ports, onClose }) {
  const [form, setForm] = useState({ sender: '', content: '', device_id: '', port: '' })
  const [result, setResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const availablePorts = ports.filter(p =>
    (!form.device_id || p.device_id === form.device_id) && p.sim_number
  )

  async function runTest(e) {
    e.preventDefault()
    setTesting(true)
    const payload = { sender: form.sender, content: form.content }
    if (form.device_id) payload.device_id = form.device_id
    if (form.port) payload.port_number = parseInt(form.port, 10)
    const res = await rulesApi.test(payload)
    setResult(res)
    setTesting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-bold mb-4">Test rules</h3>
        <form onSubmit={runTest} className="space-y-3">
          <input className="input" placeholder="Sender (e.g. +15551234567)" value={form.sender}
            onChange={e => setForm(p => ({ ...p, sender: e.target.value }))} required />
          <textarea className="input" rows={3} placeholder="SMS text..." value={form.content}
            onChange={e => setForm(p => ({ ...p, content: e.target.value }))} required />
          <select className="input" value={form.device_id} onChange={e => setForm(p => ({ ...p, device_id: e.target.value, port: '' }))}>
            <option value="">-- device (optional) --</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input"
            value={form.device_id && form.port ? `${form.device_id}:${form.port}` : ''}
            onChange={e => {
              const val = e.target.value
              if (!val) { setForm(p => ({ ...p, port: '' })); return }
              const found = ports.find(p => p.sim_number && `${p.device_id}:${p.port_number}` === val)
              if (found) setForm(p => ({ ...p, device_id: found.device_id, port: String(found.port_number) }))
            }}>
            <option value="">-- SIM port (optional) --</option>
            {availablePorts.map(p => (
              <option key={`${p.device_id}-${p.port_number}`} value={`${p.device_id}:${p.port_number}`}>
                Port {p.port_number}{p.sim_number ? ` — ${p.sim_number}` : ''}{p.operator ? ` (${p.operator})` : ''}
              </option>
            ))}
          </select>
          <button type="submit" disabled={testing} className="btn-primary w-full">
            {testing ? 'Testing...' : 'Run test'}
          </button>
        </form>
        {result && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-gray-700">Matching rules:</p>
            {result.matched.length === 0
              ? <p className="text-gray-400 text-sm">No rules match.</p>
              : result.matched.map(r => (
                <div key={r.id} className="bg-blue-50 rounded-lg p-3 text-sm">
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-gray-600">Email: {r.emails.join(', ')}</p>
                  {r.stop_on_match && <p className="text-orange-500 text-xs">⚠ Stop on match</p>}
                </div>
              ))
            }
          </div>
        )}
        <button onClick={onClose} className="btn-ghost w-full mt-3">Close</button>
      </div>
    </div>
  )
}

export default function Rules() {
  const [rules, setRules] = useState([])
  const [devices, setDevices] = useState([])
  const [ports, setPorts] = useState([])
  const [ldapGroups, setLdapGroups] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [modal, setModal] = useState(null)
  const [testOpen, setTestOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [r, d, p, g, lg] = await Promise.all([
        rulesApi.getAll(),
        devicesApi.getAll(),
        portsApi.getAll().catch(() => []),
        ldapApi.getGroups().catch(() => []),
        localGroupsApi.getAllSimple().catch(() => []),
      ])
      setRules(r); setDevices(d); setPorts(p); setLdapGroups(g); setLocalGroups(lg)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(id, name) {
    if (!window.confirm(`Delete rule "${name}"?`)) return
    try {
      await rulesApi.remove(id)
    } catch (e) {
      window.alert('Error deleting rule: ' + (e?.response?.data?.error || e.message))
    }
    await load()
  }

  async function toggleEnabled(rule) {
    await rulesApi.update(rule.id, { enabled: !rule.enabled })
    load()
  }

  function duplicate(rule) {
    setModal({ ...rule, id: undefined, name: `Copy of ${rule.name}` })
  }

  function matchLabel(rule) {
    const conds = rule.conditions
    if (!conds || conds.length === 0) return 'Qualsiasi SMS'
    const sep = rule.condition_operator === 'OR' ? ' │ O │ ' : ' │ E │ '
    return conds.map(c => {
      if (c.match_type === 'any') return 'Any'
      if (c.match_type === 'device') {
        const d = devices.find(dv => dv.id === c.device_id)
        return `Device: ${d?.name || '?'}`
      }
      if (c.match_type === 'port') {
        const d = devices.find(dv => dv.id === c.device_id)
        return `Port: ${c.match_value || '?'}${d ? ` on ${d.name}` : ''}`
      }
      const t = ALL_MATCH_TYPES.find(m => m.value === c.match_type)?.label || c.match_type
      return c.match_value ? `${t}: “${c.match_value}”` : t
    }).join(sep)
  }

  if (loading) return (
    <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading...
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Filter size={22} className="text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-800">SMS Forwarding Rules</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTestOpen(true)} className="btn-ghost flex items-center gap-2">
            <PlayCircle size={16} /> Test
          </button>
          <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> New rule
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Rules are evaluated in priority order (higher = first). If "Stop on match" is active, subsequent rules are not checked.
      </p>

      <div className="space-y-3">
        {rules.map(rule => (
          <div key={rule.id} className={`bg-white border rounded-xl p-4 ${!rule.enabled ? 'opacity-50' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800">{rule.name}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">priority {rule.priority}</span>
                  {!rule.enabled && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">disabled</span>}
                  {rule.stop_on_match && <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">stop on match</span>}
                </div>
                <p className="text-sm text-blue-700 mt-1 truncate" title={matchLabel(rule)}>Condition: {matchLabel(rule)}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {rule.targets?.map(t => (
                    <span key={t.id} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                      {t.email}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleEnabled(rule)}
                  title={rule.enabled ? 'Pause' : 'Resume'}
                  className={`p-1.5 rounded ${rule.enabled ? 'text-gray-400 hover:bg-orange-50 hover:text-orange-500' : 'text-green-500 hover:bg-green-50'}`}
                >
                  {rule.enabled ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button
                  onClick={() => duplicate(rule)}
                  title="Duplicate rule"
                  className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-500"
                >
                  <Copy size={15} />
                </button>
                <button onClick={() => setModal(rule)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Edit"><Pencil size={15} /></button>
                <button onClick={() => remove(rule.id, rule.name)} className="p-1.5 rounded hover:bg-red-50 text-red-400" title="Delete"><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-center py-12 text-gray-400">No rules configured. Create one to start receiving SMS via email.</p>
        )}
      </div>

      {modal && (
        <RuleModal
          rule={modal === 'new' ? null : modal}
          devices={devices}
          ports={ports}
          ldapGroups={ldapGroups}
          localGroups={localGroups}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {testOpen && <TestModal devices={devices} ports={ports} onClose={() => setTestOpen(false)} />}
    </div>
  )
}
