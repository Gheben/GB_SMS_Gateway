import { useState, useEffect } from 'react'
import { messagesApi, devicesApi, portsApi, phonebookApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { Send, CheckCircle, AlertCircle, ToggleLeft, ToggleRight, BookOpen, Plus, X as XIcon } from 'lucide-react'
import ContactPickerModal from '../components/ContactPickerModal'
import PhonebookAutocomplete from '../components/PhonebookAutocomplete'

export default function SendSMS() {
  const { user, isAdmin, can } = useAuth()
  const [devices, setDevices] = useState([])
  const [ports, setPorts] = useState([])
  const [form, setForm] = useState({ device_id: '', port: '', recipient: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [errors, setErrors] = useState({})
  const [balancedMode, setBalancedMode] = useState(false)
  const [hasBalancedPorts, setHasBalancedPorts] = useState(false)
  const [allBalancedPorts, setAllBalancedPorts] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [recipients, setRecipients] = useState([])   // [{phone, name}]
  const [manualInput, setManualInput] = useState('')
  const [chipsExpanded, setChipsExpanded] = useState(false)
  const [phonebookContacts, setPhonebookContacts] = useState([])
  const CHIPS_PREVIEW = 3

  useEffect(() => {
    devicesApi.getAll().then(list => {
      const connected = list.filter(d => d.connected)
      const allowedPorts = user?.allowed_ports || []
      const filtered = (isAdmin || allowedPorts.length === 0)
        ? connected
        : connected.filter(d => allowedPorts.some(ap => String(ap.device_id) === String(d.id)))
      setDevices(filtered)
      if (filtered.length > 0) setForm(f => ({ ...f, device_id: String(filtered[0].id) }))
    }).catch(() => {})
    if (isAdmin || can('phonebook')) {
      phonebookApi.getAll().then(c => setPhonebookContacts(c || [])).catch(() => {})
    }
    // Check if any balanced ports exist within the user's allowed scope
    portsApi.getAll().then(list => {
      const allowedPorts = user?.allowed_ports || []
      const balanced = list.filter(p => {
        if (!p.balanced) return false
        if (isAdmin || allowedPorts.length === 0) return true
        return allowedPorts.some(ap =>
          String(ap.device_id) === String(p.device_id) && Number(ap.port_number) === p.port_number
        )
      })
      setAllBalancedPorts(balanced)
      setHasBalancedPorts(balanced.length >= 2)
    }).catch(() => {})
  }, [])

  // Load ports from DB when the selected device changes (for annotations)
  useEffect(() => {
    if (!form.device_id) { setPorts([]); return }
    portsApi.getAll({ device_id: form.device_id }).then(list => {
      // Only ports with SIM: READY or DOWN (not NO_SIM or without data)
      const withSim = list.filter(p => p.status === 'READY' || p.status === 'DOWN')
      // If user is not admin and has allowed ports, filter only those
      const allowedPorts = user?.allowed_ports || []
      const filtered = (isAdmin || allowedPorts.length === 0)
        ? withSim
        : withSim.filter(p => allowedPorts.some(ap =>
            String(ap.device_id) === String(form.device_id) && ap.port_number === p.port_number))
      setPorts(filtered)
      const first = filtered.find(p => p.status === 'READY') || filtered[0] || null
      setForm(f => ({ ...f, port: first ? String(first.port_number) : '' }))
    }).catch(() => { setPorts([]); setForm(f => ({ ...f, port: '' })) })
  }, [form.device_id])

  function validate() {
    const e = {}
    if (!balancedMode) {
      if (!form.device_id) e.device_id = 'Select a device'
      if (!form.port || isNaN(form.port) || form.port < 1 || form.port > 16)
        e.port = 'Select a valid port (1–16)'
    }
    const manual = manualInput.trim().replace(/[\s\-\(\)]+/g, '')
    const totalRecipients = recipients.length + (manual ? 1 : 0)
    if (totalRecipients === 0)
      e.recipient = 'Add at least one recipient'
    else if (manual && !/^\+?[\d]{6,20}$/.test(manual))
      e.recipient = 'Invalid phone number in the input field'
    if (!form.message || form.message.trim().length === 0)
      e.message = 'Message cannot be empty'
    if (form.message.length > 1024)
      e.message = 'Maximum 1024 characters'
    return e
  }

  // Derived limit state
  const selectedPort = !balancedMode
    ? ports.find(p => String(p.port_number) === String(form.port)) || null
    : null
  const selectedPortLimitReached = selectedPort != null
    && selectedPort.monthly_limit > 0
    && selectedPort.sent_count >= selectedPort.monthly_limit
  const allBalancedExhausted = balancedMode
    && allBalancedPorts.length > 0
    && allBalancedPorts.every(p => p.monthly_limit > 0 && p.sent_count >= p.monthly_limit)

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)
    setResult(null)

    // Snapshot state before any async operation to avoid stale closure issues
    const snapshotRecipients = recipients
    const snapshotManual     = manualInput

    // Build final list — normalize phone numbers (strip spaces/dashes/parens) for backend compatibility
    const normalize = p => p.replace(/[\s\-\(\)]+/g, '')
    const manual = normalize(snapshotManual.trim())
    const allRecipients = snapshotRecipients.map(r => ({ ...r, phone: normalize(r.phone) }))
    if (manual && !allRecipients.some(r => r.phone === manual)) {
      allRecipients.push({ phone: manual, name: null })
    }

    const results = []
    for (const r of allRecipients) {
      try {
        const payload = balancedMode
          ? { port: 'auto', recipient: r.phone, message: form.message.trim() }
          : { device_id: form.device_id, port: parseInt(form.port, 10), recipient: r.phone, message: form.message.trim() }
        const res = await messagesApi.send(payload)
        results.push({ phone: r.phone, name: r.name, ok: true, id: res.id })
      } catch (err) {
        const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Error'
        results.push({ phone: r.phone, name: r.name, ok: false, error: msg })
      }
    }
    setLoading(false)

    const okCount   = results.filter(r => r.ok).length
    const failCount = results.filter(r => !r.ok).length
    setResult({ okCount, failCount, details: results })
    if (failCount === 0) {
      setForm(f => ({ ...f, message: '' }))
      setRecipients([])
      setManualInput('')
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Send SMS</h2>

      {devices.length === 0 && !balancedMode && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm p-3 rounded-lg">
          No connected devices. Set up devices in the <strong>Devices</strong> section.
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Balanced mode banner */}
        {hasBalancedPorts && (
          <>
            <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-blue-800">Balanced mode</p>
                <p className="text-xs text-blue-600">Automatically picks the SIM with the lowest usage ratio (least-used this month). SIMs at their monthly limit are excluded.</p>
              </div>
              <button
                type="button"
                onClick={() => setBalancedMode(m => !m)}
                className="flex-shrink-0 focus:outline-none"
                aria-label="Toggle balanced mode"
              >
                {balancedMode
                  ? <ToggleRight size={32} className="text-blue-600" />
                  : <ToggleLeft  size={32} className="text-blue-400" />}
              </button>
            </div>
            {balancedMode && allBalancedExhausted && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>All balanced SIMs have reached their monthly limit. Auto-routing is unavailable until next month.</span>
              </div>
            )}
          </>
        )}

        {/* Dispositivo */}
        {!balancedMode && (
          <div>
            <label className="label">Device</label>
          {devices.length === 1 ? (
            <p className="input bg-gray-50 text-gray-700 cursor-default select-none">
              {devices[0].name} ({devices[0].host})
            </p>
          ) : (
            <select
              value={form.device_id}
              onChange={(e) => setForm(f => ({ ...f, device_id: e.target.value }))}
              className="input"
            >
              <option value="">— select —</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.host})</option>
              ))}
            </select>
          )}
            {errors.device_id && <p className="text-red-500 text-xs mt-1">{errors.device_id}</p>}
          </div>
        )}

        {/* Porta SIM */}
        {!balancedMode && (
          <div>
            <label className="label">SIM Port</label>
          {ports.length === 0 ? (
            <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              No SIM ports detected for this device.
            </p>
          ) : ports.length === 1 ? (() => {
            const p = ports[0]
            const atLimit = p.monthly_limit > 0 && p.sent_count >= p.monthly_limit
            const label = [
              `Port ${p.port_number}`,
              p.operator ? `\u2014 ${p.operator}` : '',
              p.sim_number ? `(${p.sim_number})` : '',
              p.status === 'READY' ? '\u2713' : '(not ready)',
              atLimit ? '\u26a0 limit reached' : '',
            ].filter(Boolean).join(' ')
            return (
              <p className="input bg-gray-50 text-gray-700 cursor-default select-none">{label}</p>
            )
          })() : (
            <select
              value={form.port}
              onChange={(e) => setForm(f => ({ ...f, port: e.target.value }))}
              className="input"
            >
              {ports.map(p => {
                const atLimit = p.monthly_limit > 0 && p.sent_count >= p.monthly_limit
                const label = [
                  `Port ${p.port_number}`,
                  p.operator ? `\u2014 ${p.operator}` : '',
                  p.sim_number ? `(${p.sim_number})` : '',
                  p.status === 'READY' ? '\u2713' : '(not ready)',
                  atLimit ? '\u26a0 limit reached' : '',
                ].filter(Boolean).join(' ')
                return <option key={p.port_number} value={p.port_number}>{label}</option>
              })}
            </select>
          )}
            {errors.port && <p className="text-red-500 text-xs mt-1">{errors.port}</p>}
            {selectedPortLimitReached && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mt-1">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>
                  This SIM has reached its monthly limit ({selectedPort.sent_count}/{selectedPort.monthly_limit}).
                  Choose another port or wait until next month.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Numero destinatario */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Recipients</label>
            {(isAdmin || can('phonebook')) && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded hover:bg-blue-50 transition-colors"
              >
                <BookOpen size={13} /> From phonebook
              </button>
            )}
          </div>

          {/* Chips */}
          {recipients.length > 0 && (
            <div className="mb-2">
              {!chipsExpanded ? (
                <div className="flex flex-wrap gap-1.5 items-center">
                  {recipients.slice(0, CHIPS_PREVIEW).map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono rounded-full pl-2.5 pr-1 py-0.5">
                      {r.name ? <span className="font-sans font-medium mr-0.5">{r.name}</span> : null}
                      {r.phone}
                      <button
                        type="button"
                        onClick={() => setRecipients(rs => rs.filter((_, j) => j !== i))}
                        className="ml-0.5 text-blue-400 hover:text-blue-700 rounded-full p-0.5 hover:bg-blue-100 transition-colors"
                      >
                        <XIcon size={11} />
                      </button>
                    </span>
                  ))}
                  {recipients.length > CHIPS_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setChipsExpanded(true)}
                      className="text-xs text-blue-600 hover:text-blue-800 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 font-medium transition-colors"
                    >
                      +{recipients.length - CHIPS_PREVIEW} more
                    </button>
                  )}
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="max-h-48 overflow-y-auto p-2 flex flex-wrap gap-1.5">
                    {recipients.map((r, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono rounded-full pl-2.5 pr-1 py-0.5">
                        {r.name ? <span className="font-sans font-medium mr-0.5">{r.name}</span> : null}
                        {r.phone}
                        <button
                          type="button"
                          onClick={() => {
                            setRecipients(rs => {
                              const next = rs.filter((_, j) => j !== i)
                              if (next.length <= CHIPS_PREVIEW) setChipsExpanded(false)
                              return next
                            })
                          }}
                          className="ml-0.5 text-blue-400 hover:text-blue-700 rounded-full p-0.5 hover:bg-blue-100 transition-colors"
                        >
                          <XIcon size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                    <span className="text-xs text-gray-400">{recipients.length} recipients</span>
                    <button
                      type="button"
                      onClick={() => setChipsExpanded(false)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      show less
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manual entry */}
          <div className="flex gap-2">
            <PhonebookAutocomplete
              mode="phone"
              contacts={phonebookContacts}
              value={manualInput}
              onChange={v => { setManualInput(v); if (errors.recipient) setErrors(ev => ({...ev, recipient: null})) }}
              onAdd={contact => {
                const phone = contact.phone.replace(/[\s\-\(\)]+/g, '')
                if (!recipients.some(r => r.phone === phone)) {
                  setRecipients(rs => [...rs, { phone, name: contact.display_name }])
                }
                setManualInput('')
                if (errors.recipient) setErrors(ev => ({...ev, recipient: null}))
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const phone = manualInput.trim().replace(/[\s\-\(\)]+/g, '')
                  if (!phone || !/^\+?[\d]{6,20}$/.test(phone)) {
                    setErrors(ev => ({...ev, recipient: 'Invalid phone number'}))
                    return
                  }
                  if (!recipients.some(r => r.phone === phone)) {
                    setRecipients(rs => [...rs, { phone, name: null }])
                  }
                  setManualInput('')
                }
              }}
              placeholder="+1 555 123 4567 or contact name"
              className="input flex-1"
            />
            <button
              type="button"
              title="Add number"
              onClick={() => {
                const phone = manualInput.trim().replace(/[\s\-\(\)]+/g, '')
                if (!phone || !/^\+?[\d]{6,20}$/.test(phone)) {
                  setErrors(ev => ({...ev, recipient: 'Invalid phone number'}))
                  return
                }
                if (!recipients.some(r => r.phone === phone)) {
                  setRecipients(rs => [...rs, { phone, name: null }])
                }
                setManualInput('')
              }}
              className="btn-secondary px-3 flex items-center gap-1"
            >
              <Plus size={15} />
            </button>
          </div>
          {errors.recipient && <p className="text-red-500 text-xs mt-1">{errors.recipient}</p>}
          {(() => {
            const total = recipients.length + (manualInput.trim() ? 1 : 0)
            return total > 1 ? (
              <p className="text-xs text-gray-400 mt-1">{total} recipient{total !== 1 ? 's' : ''} — one SMS will be sent per recipient</p>
            ) : null
          })()}
        </div>

        {/* Testo */}
        <div>
          <label className="label">
            Message
            <span className="text-gray-400 font-normal ml-2">{form.message.length}/1024</span>
          </label>
          <textarea
            rows={5}
            value={form.message}
            onChange={(e) => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="Type your message..."
            className="input resize-none"
          />
          {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || (!balancedMode && devices.length === 0) || selectedPortLimitReached || allBalancedExhausted}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading
            ? <><Send size={16} /> Sending…</>
            : <><Send size={16} /> Send SMS{(recipients.length + (manualInput.trim() ? 1 : 0)) > 1 ? ` to ${recipients.length + (manualInput.trim() ? 1 : 0)} recipients` : ''}</>
          }
        </button>
      </form>

      {result && (
        <div className={`p-4 rounded-lg border space-y-2 ${
          result.failCount === 0 ? 'bg-green-50 border-green-200 text-green-800'
          : result.okCount === 0  ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-yellow-50 border-yellow-200 text-yellow-800'
        }`}>
          <div className="flex items-center gap-2 font-medium text-sm">
            {result.failCount === 0 ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            {result.okCount === 0
              ? 'Send failed'
              : result.failCount === 0
                ? result.details.length === 1 ? `SMS sent. ID: ${result.details[0].id}` : `All ${result.details.length} SMS sent successfully.`
                : `${result.okCount} of ${result.details.length} sent, ${result.failCount} failed.`
            }
          </div>
          {result.details.length > 1 && (
            <ul className="text-xs space-y-0.5 pl-6 list-disc">
              {result.details.map((d, i) => (
                <li key={i} className={d.ok ? 'text-green-700' : 'text-red-700'}>
                  {d.name ? `${d.name} ` : ''}{d.phone} — {d.ok ? `OK (ID: ${d.id})` : `Error: ${d.error}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pickerOpen && (
        <ContactPickerModal
          onSelect={contacts => {
            setRecipients(rs => {
              const existing = new Set(rs.map(r => r.phone))
              const newOnes = contacts
                .filter(c => !existing.has(c.phone))
                .map(c => ({ phone: c.phone, name: c.display_name }))
              return [...rs, ...newOnes]
            })
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
