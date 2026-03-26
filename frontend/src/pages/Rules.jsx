import { useEffect, useState, useCallback } from 'react'
import { rulesApi, devicesApi, ldapApi, localGroupsApi } from '../api'
import { Plus, Pencil, Trash2, PlayCircle, X, Users, UsersRound, Loader2, Copy, Pause, Play } from 'lucide-react'

const MATCH_TYPES = [
  { value: 'sender',        label: 'Exact sender' },
  { value: 'sender_regex',  label: 'Sender (regex)' },
  { value: 'content',       label: 'Text contains' },
  { value: 'content_regex', label: 'Text (regex)' },
  { value: 'device',        label: 'Specific device' },
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
  sms_targets_str: '',
  allowed_groups: [],
  allowed_local_groups: [],
}

function ConditionRow({ cond, total, devices, onChange, onRemove }) {
  const needsValue = !['any', 'device'].includes(cond.match_type)
  const needsDevice = cond.match_type === 'device'
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
      {needsValue && (
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
    </div>
  )
}

function RuleModal({ rule, devices, ldapGroups, localGroups, onClose, onSaved }) {
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
      sms_targets_str: Array.isArray(rule.sms_targets) ? rule.sms_targets.join(', ') : '',
      allowed_groups: Array.isArray(rule.allowed_groups) ? rule.allowed_groups : [],
      allowed_local_groups: Array.isArray(rule.allowed_local_groups) ? rule.allowed_local_groups : [],
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
        device_id: c.match_type === 'device' ? (c.device_id || undefined) : undefined,
      })),
      stop_on_match: form.stop_on_match,
      targets: form.targets.filter(Boolean),
      sms_targets: form.sms_targets_str.split(',').map(s => s.trim()).filter(Boolean),
      allowed_groups: form.allowed_groups,
      allowed_local_groups: form.allowed_local_groups,
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
              <label className="label">Priorità</label>
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
                  <ConditionRow cond={c} total={form.conditions.length} devices={devices}
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
                <input className="input flex-1" type="email" placeholder="user@company.com" value={t}
                  onChange={e => setTarget(i, e.target.value)} />
                {form.targets.length > 1 && (
                  <button type="button" onClick={() => removeTarget(i)} className="text-red-400 px-2">✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addTarget} className="text-blue-600 text-sm hover:underline">+ Add email</button>
          </div>

          {/* Inoltro SMS */}
          <div>
            <label className="label">SMS forwarding <span className="text-gray-400 font-normal">(optional — numbers with country code, comma-separated)</span></label>
            <input
              className="input"
              placeholder="E.g.: +15551234567, +15559876543"
              value={form.sms_targets_str}
              onChange={e => setForm(p => ({ ...p, sms_targets_str: e.target.value }))}
            />
            <p className="text-xs text-gray-400 mt-1">The SMS will be sent using the same SIM that received the message.</p>
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

function TestModal({ devices, onClose }) {
  const [form, setForm] = useState({ sender: '', content: '', device_id: '' })
  const [result, setResult] = useState(null)
  const [testing, setTesting] = useState(false)

  async function runTest(e) {
    e.preventDefault()
    setTesting(true)
    const res = await rulesApi.test(form)
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
          <select className="input" value={form.device_id} onChange={e => setForm(p => ({ ...p, device_id: e.target.value }))}>
            <option value="">-- device (optional) --</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
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
  const [ldapGroups, setLdapGroups] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [modal, setModal] = useState(null)
  const [testOpen, setTestOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [r, d, g, lg] = await Promise.all([
        rulesApi.getAll(),
        devicesApi.getAll(),
        ldapApi.getGroups().catch(() => []),
        localGroupsApi.getAllSimple().catch(() => []),
      ])
      setRules(r); setDevices(d); setLdapGroups(g); setLocalGroups(lg)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function remove(id, name) {
    if (!confirm(`Eliminare la regola "${name}"?`)) return
    await rulesApi.remove(id)
    load()
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
        <h2 className="text-2xl font-bold text-gray-800">SMS Forwarding Rules</h2>
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
          ldapGroups={ldapGroups}
          localGroups={localGroups}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
      {testOpen && <TestModal devices={devices} onClose={() => setTestOpen(false)} />}
    </div>
  )
}
