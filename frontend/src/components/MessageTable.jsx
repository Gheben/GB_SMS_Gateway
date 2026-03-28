import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { Loader2 } from 'lucide-react'

export default function MessageTable({ messages, loading, onDoubleClick }) {
  if (loading) {
    return (
      <div className="flex justify-center items-center py-16 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" /> Loading...
      </div>
    )
  }

  if (!messages || messages.length === 0) {
    return <div className="text-center py-16 text-gray-400">No messages found.</div>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Type</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">From / To</th>
            <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">SIM</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Message</th>
            <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Date</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {messages.map((msg) => (
            <tr
              key={msg.id}
              className="hover:bg-blue-50 transition-colors cursor-pointer select-none"
              onDoubleClick={() => onDoubleClick?.(msg)}
              title="Double-click for details"
            >
              <td className="px-4 py-3">
                <span className={`badge-${msg.direction}`}>
                  {msg.direction === 'inbound' ? 'Received' : 'Sent'}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-gray-700" title={msg.direction === 'inbound' ? msg.sender : msg.recipient}>
                {msg.direction === 'inbound'
                  ? (msg.sender_name || msg.sender)
                  : (msg.recipient_name || msg.recipient)}
              </td>
              <td className="hidden sm:table-cell px-4 py-3 text-gray-500">
                {msg.port_sim_number
                  ? <span className="font-mono">{msg.port_sim_number}</span>
                  : msg.port ? `Port ${msg.port}` : '—'}
              </td>
              <td className="px-4 py-3 max-w-xs truncate text-gray-800" title={msg.content}>
                {msg.content}
              </td>
              <td className="hidden sm:table-cell px-4 py-3">
                <span className={`badge-${msg.status}`}>{msg.status}</span>
              </td>
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                {format(new Date(msg.created_at), 'MM/dd/yyyy HH:mm', { locale: enUS })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
