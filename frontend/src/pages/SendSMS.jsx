import { useState, useEffect } from 'react'
import { messagesApi, devicesApi, portsApi } from '../api'
import { Send, CheckCircle, AlertCircle } from 'lucide-react'

export default function SendSMS() {
  const [devices, setDevices] = useState([])
  const [ports, setPorts] = useState([])
  const [form, setForm] = useState({ device_id: '', port: '', recipient: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    devicesApi.getAll().then(list => {
      const connected = list.filter(d => d.connected)
      setDevices(connected)
      if (connected.length > 0) setForm(f => ({ ...f, device_id: String(connected[0].id) }))
    }).catch(() => {})
  }, [])

  // Carica porte dal DB quando cambia il dispositivo selezionato (per annotazioni)
  useEffect(() => {
    if (!form.device_id) { setPorts([]); return }
    portsApi.getAll({ device_id: form.device_id }).then(list => {
      // Solo porte con SIM: READY o DOWN (no NO_SIM, no senza dati)
      const withSim = list.filter(p => p.status === 'READY' || p.status === 'DOWN')
      setPorts(withSim)
      const first = withSim.find(p => p.status === 'READY') || withSim[0] || null
      setForm(f => ({ ...f, port: first ? String(first.port_number) : '' }))
    }).catch(() => { setPorts([]); setForm(f => ({ ...f, port: '' })) })
  }, [form.device_id])

  function validate() {
    const e = {}
    if (!form.device_id) e.device_id = 'Seleziona un dispositivo'
    if (!form.port || isNaN(form.port) || form.port < 1 || form.port > 16)
      e.port = 'Seleziona una porta valida (1–16)'
    if (!form.recipient || !/^\+?[\d\s\-]{6,20}$/.test(form.recipient))
      e.recipient = 'Numero di telefono non valido'
    if (!form.message || form.message.trim().length === 0)
      e.message = 'Il messaggio non può essere vuoto'
    if (form.message.length > 1024)
      e.message = 'Massimo 1024 caratteri'
    return e
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)
    setResult(null)
    try {
      const res = await messagesApi.send({
        device_id: form.device_id,
        port: parseInt(form.port, 10),
        recipient: form.recipient.trim(),
        message: form.message.trim(),
      })
      setResult({ success: true, message: `SMS inviato. ID: ${res.id}` })
      setForm(f => ({ ...f, message: '' }))
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Errore durante l\'invio'
      setResult({ success: false, message: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Invia SMS</h2>

      {devices.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm p-3 rounded-lg">
          Nessun dispositivo connesso. Configura i dispositivi nella sezione <strong>Dispositivi</strong>.
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Dispositivo */}
        <div>
          <label className="label">Dispositivo</label>
          <select
            value={form.device_id}
            onChange={(e) => setForm(f => ({ ...f, device_id: e.target.value }))}
            className="input"
          >
            <option value="">— seleziona —</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.host})</option>
            ))}
          </select>
          {errors.device_id && <p className="text-red-500 text-xs mt-1">{errors.device_id}</p>}
        </div>

        {/* Porta SIM */}
        <div>
          <label className="label">Porta SIM</label>
          {ports.length === 0 ? (
            <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              Nessuna porta con SIM rilevata per questo dispositivo.
            </p>
          ) : (
            <select
              value={form.port}
              onChange={(e) => setForm(f => ({ ...f, port: e.target.value }))}
              className="input"
            >
              {ports.map(p => {
                const label = [
                  `Porta ${p.port_number}`,
                  p.operator ? `— ${p.operator}` : '',
                  p.sim_number ? `(${p.sim_number})` : '',
                  p.status === 'READY' ? '✓' : '(non pronta)',
                ].filter(Boolean).join(' ')
                return <option key={p.port_number} value={p.port_number}>{label}</option>
              })}
            </select>
          )}
          {errors.port && <p className="text-red-500 text-xs mt-1">{errors.port}</p>}
        </div>

        {/* Numero destinatario */}
        <div>
          <label className="label">Numero destinatario</label>
          <input
            type="text"
            placeholder="+39 333 1234567"
            value={form.recipient}
            onChange={(e) => setForm(f => ({ ...f, recipient: e.target.value }))}
            className="input"
          />
          {errors.recipient && <p className="text-red-500 text-xs mt-1">{errors.recipient}</p>}
        </div>

        {/* Testo */}
        <div>
          <label className="label">
            Testo
            <span className="text-gray-400 font-normal ml-2">{form.message.length}/1024</span>
          </label>
          <textarea
            rows={5}
            value={form.message}
            onChange={(e) => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="Scrivi il messaggio..."
            className="input resize-none"
          />
          {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || devices.length === 0}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <Send size={16} />
          {loading ? 'Invio in corso...' : 'Invia SMS'}
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
