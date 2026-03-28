import { useEffect, useState, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { reportApi, messagesApi } from '../api'
import { CheckCircle, XCircle, Clock, RefreshCw, Loader2 } from 'lucide-react'
import MessageDetailModal from '../components/MessageDetailModal'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

const DAYS_OPTIONS = [7, 14, 30, 90]

function StatCard({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue:  'bg-blue-50  border-blue-200  text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    red:   'bg-red-50   border-red-200   text-red-700',
    gray:  'bg-gray-50  border-gray-200  text-gray-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1">{value ?? '—'}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }) {
  if (status === 'sent')    return <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle size={11} />Sent</span>
  if (status === 'failed')  return <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded-full"><XCircle size={11} />Error</span>
  return <span className="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full"><Clock size={11} />{status}</span>
}

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDay(s) {
  if (!s) return s
  const [, m, d] = s.split('-')
  return `${d}/${m}`
}

export default function Report() {
  const [data, setData]   = useState(null)
  const [days, setDays]   = useState(30)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [logPage, setLogPage] = useState(1)
  const [logLimit, setLogLimit] = useState(25)
  const [selectedMsg, setSelectedMsg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await reportApi.get(days)
      setData(d)
    } catch {}
    setLoading(false)
  }, [days])

  useEffect(() => { load() }, [load])

  const filtered = (data?.dispatchLog || []).filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.sender?.toLowerCase().includes(q) ||
      r.email?.toLowerCase().includes(q) ||
      r.rule_name?.toLowerCase().includes(q) ||
      r.content?.toLowerCase().includes(q) ||
      r.device_name?.toLowerCase().includes(q)
    )
  })

  const logTotalPages = Math.ceil(filtered.length / logLimit)
  const logSlice = filtered.slice((logPage - 1) * logLimit, logPage * logLimit)

  async function handleRowDblClick(row) {
    if (!row.message_id) return
    try {
      const full = await messagesApi.getById(row.message_id)
      setSelectedMsg(full)
    } catch {}
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-800">Report &amp; Log</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {DAYS_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${days === d ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-40">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
            <Loader2 size={18} className="animate-spin" /> Loading data...
        </div>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="SMS received"  value={data.totals.total_inbound}  color="blue" />
            <StatCard label="SMS sent"   value={data.totals.total_outbound} color="green" />
            <StatCard label="Total forwards"  value={data.totals.total}          color="gray" />
            <StatCard label="Emails sent" value={data.totals.sent}           color="green" />
            <StatCard label="Errors"        value={data.totals.failed}         color="red" />
            <StatCard
              label="Success rate"
              value={data.totals.total > 0 ? `${Math.round(data.totals.sent / data.totals.total * 100)}%` : '—'}
              color="blue"
            />
          </div>

          {/* Grafici riga 1: area + pie */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* SMS per giorno */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">SMS per day</h3>
              {data.smsByDay.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={data.smsByDay} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip labelFormatter={fmtDay} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="inbound"  name="Received" stroke="#3b82f6" fill="url(#gIn)"  strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="outbound" name="Sent"  stroke="#10b981" fill="url(#gOut)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Inoltri per regola (pie) */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Forwards by rule</h3>
              {data.dispatchByRule.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={data.dispatchByRule} dataKey="dispatches" nameKey="rule"
                      cx="50%" cy="40%" outerRadius={60}
                      labelLine={false}
                    >
                      {data.dispatchByRule.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [v, 'forwards']} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11, maxHeight: 80, overflowY: 'auto' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Grafici riga 2: SMS per device */}
          {data.smsByDevice.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">SMS by device</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.smsByDevice} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="device" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="inbound"  name="Received" fill="#3b82f6" radius={[3,3,0,0]} />
                  <Bar dataKey="outbound" name="Sent"  fill="#10b981" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabella Dispatch Log */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-700">SMS forwarding log</h3>
              <input
                className="input text-sm py-1.5 w-64"
                placeholder="Search sender, email, rule..."
                value={search}
                onChange={e => { setSearch(e.target.value); setLogPage(1) }}
              />
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No forwards in the selected period</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                        <th className="pb-2 pr-4 font-medium">SMS received at</th>
                        <th className="pb-2 pr-4 font-medium">Sender</th>
                        <th className="pb-2 pr-4 font-medium">Text</th>
                        <th className="pb-2 pr-4 font-medium">Device</th>
                        <th className="pb-2 pr-4 font-medium">Rule</th>
                        <th className="pb-2 pr-4 font-medium">To</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 font-medium">Sent at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {logSlice.map(r => (
                        <tr
                          key={r.id}
                          className="hover:bg-blue-50 cursor-pointer transition-colors select-none"
                          onDoubleClick={() => handleRowDblClick(r)}
                          title="Double-click for details"
                        >
                          <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{fmtDate(r.received_at || r.created_at)}</td>
                          <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{r.sender || '—'}</td>
                          <td className="py-2 pr-4 text-gray-700 max-w-[180px] truncate" title={r.content}>{r.content}</td>
                          <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{r.device_name || '—'}</td>
                          <td className="py-2 pr-4">
                            <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{r.rule_name || '—'}</span>
                          </td>
                          <td className="py-2 pr-4 text-gray-600 text-xs">{r.email}</td>
                          <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
                          <td className="py-2 text-gray-400 text-xs whitespace-nowrap">{fmtDate(r.sent_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Paginazione log */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>Rows per page:</span>
                    {[10, 25, 50].map(n => (
                      <button key={n} onClick={() => { setLogLimit(n); setLogPage(1) }}
                        className={`px-2.5 py-0.5 rounded border text-xs font-medium transition-colors ${
                          logLimit === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-100'
                        }`}>
                        {n}
                      </button>
                    ))}
                    <span className="text-gray-400 ml-2">{filtered.length} total</span>
                  </div>
                  {logTotalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage === 1}
                        className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-100">
                        ← Prev
                      </button>
                      <span className="px-3 py-1 text-sm text-gray-600">Page {logPage} / {logTotalPages}</span>
                      <button onClick={() => setLogPage(p => Math.min(logTotalPages, p + 1))} disabled={logPage >= logTotalPages}
                        className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-100">
                        Next →
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {selectedMsg && <MessageDetailModal msg={selectedMsg} onClose={() => setSelectedMsg(null)} />}
    </div>
  )
}
