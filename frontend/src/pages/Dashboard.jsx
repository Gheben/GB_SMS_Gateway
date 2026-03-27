import { useEffect, useRef, useState, useCallback } from 'react'
import { messagesApi, devicesApi, portsApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuth } from '../contexts/AuthContext'
import StatCard from '../components/StatCard'
import MessageTable from '../components/MessageTable'
import MessageDetailModal from '../components/MessageDetailModal'
import { MessageSquare, Send, AlertCircle, TrendingUp, Server, Smartphone } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [portStats, setPortStats] = useState(null)
  const [statsMonth, setStatsMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const { can, user } = useAuth()

  const isAdminUser = user?.role === 'superadmin' || user?.role === 'admin'

  const loadData = useCallback(async () => {
    try {
      const [s, m, d] = await Promise.all([
        messagesApi.getStats(),
        messagesApi.getAll({ limit: 10 }),
        devicesApi.getAll(),
      ])
      setStats(s)
      setRecent(m.data)
      setDevices(d)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isAdminUser) return
    portsApi.getMonthlyStats(statsMonth).then(setPortStats).catch(() => {})
  }, [statsMonth, isAdminUser])

  useEffect(() => { loadData() }, [loadData])

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'sms:received' || msg.type === 'sms:sent') loadData()
    if (msg.type === 'devices:status') loadData()
  }, [loadData])

  // Reload data on WebSocket reconnect (skip very first connect which is handled by useEffect above)
  const initialConnectDone = useRef(false)
  const handleWsConnect = useCallback(() => {
    if (initialConnectDone.current) loadData()
    else initialConnectDone.current = true
  }, [loadData])

  useWebSocket(handleWsMessage, handleWsConnect)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Received today"   value={stats?.received_today} icon={MessageSquare} color="green" />
        <StatCard label="Sent today"        value={stats?.sent_today}     icon={Send}          color="blue" />
        <StatCard label="Total received"    value={stats?.total_inbound}  icon={TrendingUp}    color="green" />
        <StatCard label="Failed"            value={stats?.failed}         icon={AlertCircle}   color="red" />
      </div>

      {/* Devices status — only shown to users with devices permission */}
      {can('devices') && (
        <div>
          <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Server size={18} /> Device status
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {devices.map(d => (
              <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${d.connected ? 'bg-green-400' : 'bg-red-400'}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{d.name}</p>
                  <p className="text-xs text-gray-500 truncate">{d.host}:{d.port}</p>
                </div>
                <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${d.connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {d.connected ? 'Online' : 'Offline'}
                </span>
              </div>
            ))}
            {devices.length === 0 && !loading && (
              <p className="text-sm text-gray-400 col-span-3">No devices configured.</p>
            )}
          </div>
        </div>
      )}

      {/* Recent messages */}
      <div>
        <h3 className="text-lg font-semibold text-gray-700 mb-3">Recent messages</h3>
        <MessageTable messages={recent} loading={loading} onDoubleClick={setSelectedMessage} />
      </div>

      {/* SIM Monthly Usage — admin only */}
      {isAdminUser && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
              <Smartphone size={18} /> SIM Monthly Usage
            </h3>
            <select
              value={statsMonth}
              onChange={e => setStatsMonth(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {Array.from({ length: 6 }, (_, i) => {
                const d = new Date(); d.setMonth(d.getMonth() - i)
                const val = d.toISOString().slice(0, 7)
                return <option key={val} value={val}>{val}</option>
              })}
            </select>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">Port</th>
                  <th className="px-4 py-3 text-left">SIM / Operator</th>
                  <th className="px-4 py-3 text-center">Balanced</th>
                  <th className="px-4 py-3 text-right">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {portStats?.ports?.length > 0
                  ? portStats.ports.map(p => (
                    <tr key={`${p.device_id}-${p.port_number}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800">{p.device_name}</td>
                      <td className="px-4 py-2 text-gray-600">{p.port_number}</td>
                      <td className="px-4 py-2 text-gray-500">
                        {[p.operator, p.sim_number].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {p.balanced
                          ? <span className="inline-block bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">Yes</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-800">{p.sent_count}</td>
                    </tr>
                  ))
                  : (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-400">No port data for {statsMonth}.</td>
                    </tr>
                  )
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedMessage && <MessageDetailModal msg={selectedMessage} onClose={() => setSelectedMessage(null)} />}
    </div>
  )
}
