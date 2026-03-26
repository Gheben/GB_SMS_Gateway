import { useEffect, useRef, useState, useCallback } from 'react'
import { messagesApi, devicesApi } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuth } from '../contexts/AuthContext'
import StatCard from '../components/StatCard'
import MessageTable from '../components/MessageTable'
import MessageDetailModal from '../components/MessageDetailModal'
import { MessageSquare, Send, AlertCircle, TrendingUp, Server } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMessage, setSelectedMessage] = useState(null)
  const { can } = useAuth()

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
        <MessageTable messages={recent} loading={loading} onRowDoubleClick={setSelectedMessage} />
      </div>

      <MessageDetailModal message={selectedMessage} onClose={() => setSelectedMessage(null)} />
    </div>
  )
}
