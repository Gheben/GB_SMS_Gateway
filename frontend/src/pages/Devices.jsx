import { useEffect, useState, useCallback } from 'react'
import { devicesApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { Plus, Pencil, Trash2, Wifi, WifiOff, Loader2 } from 'lucide-react'

const EMPTY_FORM = { name: '', host: '', port: 5038, username: 'apiuser', password: 'apipass', enabled: true }

function DeviceModal({ device, onClose, onSaved }) {
  const [form, setForm] = useState(device ? { ...device, password: '' } : { ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (device) await devicesApi.update(device.id, form)
      else await devicesApi.create(form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Errore')
    } finally { setSaving(false) }
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-bold mb-4">{device ? 'Edit device' : 'New device'}</h3>
        <form onSubmit={submit} className="space-y-3">
          <input className="input" placeholder="Name (e.g. GSM-01 Main)" value={form.name} onChange={f('name')} required />
          <input className="input" placeholder="Hostname / IP (e.g. 192.168.1.100)" value={form.host} onChange={f('host')} required />
          <div className="flex gap-2">
            <input className="input w-24" type="number" placeholder="Porta" value={form.port} onChange={f('port')} />
            <input className="input flex-1" placeholder="Username API" value={form.username} onChange={f('username')} />
            <input className="input flex-1" type="password" placeholder={device ? '•••••••• (leave blank to keep current)' : 'API Password'} value={form.password} onChange={f('password')} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))} />
            Enabled
          </label>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Devices() {
  const [devices, setDevices] = useState([])
  const [modal, setModal] = useState(null) // null | 'new' | device_object
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await devicesApi.getAll()
      setDevices(data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useWebSocket(useCallback((msg) => {
    if (msg.type === 'device:connected' || msg.type === 'device:disconnected') load()
  }, [load]))

  async function remove(id, name) {
    if (!confirm(`Remove device "${name}"?`)) return
    await devicesApi.remove(id)
    load()
  }

  if (loading) return (
    <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading...
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Yeastar Devices</h2>
        <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Add device
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {devices.map(d => (
          <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-800">{d.name}</p>
                <p className="text-sm text-gray-500 font-mono">{d.host}:{d.port}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setModal(d)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Pencil size={15} /></button>
                <button onClick={() => remove(d.id, d.name)} className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 size={15} /></button>
              </div>
            </div>
            <div className={`flex items-center gap-1.5 text-xs font-medium ${d.connected ? 'text-green-600' : 'text-red-500'}`}>
              {d.connected ? <Wifi size={13} /> : <WifiOff size={13} />}
              {d.connected ? 'Connected' : 'Not connected'}
              {!d.enabled && <span className="ml-2 text-gray-400">(disabled)</span>}
            </div>
            <p className="text-xs text-gray-400">User: {d.username}</p>
          </div>
        ))}
        {devices.length === 0 && (
          <p className="col-span-3 text-center py-12 text-gray-400">No devices configured.</p>
        )}
      </div>

      {modal && (
        <DeviceModal
          device={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
