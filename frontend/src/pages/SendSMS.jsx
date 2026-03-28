import { useState, useEffect } from 'react'
import { messagesApi, devicesApi, portsApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { Send, CheckCircle, AlertCircle, ToggleLeft, ToggleRight } from 'lucide-react'

export default function SendSMS() {
  const { user, isAdmin } = useAuth()
  const [devices, setDevices] = useState([])
  const [ports, setPorts] = useState([])
  const [form, setForm] = useState({ device_id: '', port: '', recipient: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [errors, setErrors] = useState({})
  const [balancedMode, setBalancedMode] = useState(false)
  const [hasBalancedPorts, setHasBalancedPorts] = useState(false)
  const [allBalancedPorts, setAllBalancedPorts] = useState([])

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
    if (!form.recipient || !/^\+?[\d\s\-]{6,20}$/.test(form.recipient))
      e.recipient = 'Invalid phone number'
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
    try {
      const payload = balancedMode
        ? { port: 'auto', recipient: form.recipient.trim(), message: form.message.trim() }
        : { device_id: form.device_id, port: parseInt(form.port, 10), recipient: form.recipient.trim(), message: form.message.trim() }
      const res = await messagesApi.send(payload)
      setResult({ success: true, message: `SMS sent. ID: ${res.id}` })
      setForm(f => ({ ...f, message: '' }))
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Error sending message'
      setResult({ success: false, message: msg })
    } finally {
      setLoading(false)
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
          <label className="label">Recipient number</label>
          <input
            type="text"
            placeholder="+1 555 123 4567"
            value={form.recipient}
            onChange={(e) => setForm(f => ({ ...f, recipient: e.target.value }))}
            className="input"
          />
          {errors.recipient && <p className="text-red-500 text-xs mt-1">{errors.recipient}</p>}
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
          <Send size={16} />
          {loading ? 'Sending...' : 'Send SMS'}
        </button>
      </form>

      {result && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${result.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {result.success ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <p className="text-sm">{result.message}</p>
        </div>
      )}
    </div>
  )
}
