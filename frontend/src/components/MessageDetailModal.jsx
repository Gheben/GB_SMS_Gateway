import { format } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { X, Copy, Check } from 'lucide-react'
import { useState } from 'react'

const STATUS_DISPATCH = {
  sent:    { label: 'Sent',    cls: 'text-green-700 bg-green-50 border-green-200' },
  failed:  { label: 'Error',   cls: 'text-red-700 bg-red-50 border-red-200' },
  pending: { label: 'Queued', cls: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
}

function fmt(s) {
  if (!s) return '—'
  try { return format(new Date(s), 'MM/dd/yyyy HH:mm:ss', { locale: enUS }) } catch { return s }
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm text-gray-800 break-all ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  )
}

export default function MessageDetailModal({ msg, onClose }) {
  if (!msg) return null

  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(msg.content || '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const contact = msg.direction === 'inbound' ? msg.sender : msg.recipient

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-base font-semibold text-gray-800">
            Message detail
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors rounded-full p-1 hover:bg-gray-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">

          {/* Campi info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label="Type"     value={msg.direction === 'inbound' ? 'Received' : 'Sent'} />
            <Field label="Status"   value={msg.status} />
            <Field label="SIM Port" value={msg.port ? `Port ${msg.port}` : null} />
            <Field
              label={msg.direction === 'inbound' ? 'Sender' : 'Recipient'}
              value={msg.direction === 'inbound'
                ? (msg.sender_name ? `${msg.sender_name} (${msg.sender})` : contact)
                : (msg.recipient_name ? `${msg.recipient_name} (${msg.recipient})` : contact)}
              mono
            />
            {msg.direction === 'inbound' && (msg.port_sim_number || msg.recipient) && (
              <Field label="Receiving SIM number" value={msg.port_sim_number || msg.recipient} mono />
            )}
            {msg.direction === 'outbound' && msg.port_sim_number && (
              <Field label="Sending SIM number" value={msg.port_sim_number} mono />
            )}
            <Field label="Device"   value={msg.device_name} />
            <Field label="Date"     value={fmt(msg.received_at || msg.created_at)} />
          </div>

          {/* Testo SMS */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Message</p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors px-2 py-0.5 rounded hover:bg-blue-50"
              >
                {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap break-words">
              {msg.content}
            </div>
          </div>

          {/* Inoltri */}
          {(() => {
            const dispatches = msg.dispatches || []

            const TYPE_BADGE = {
              email:   { label: 'Email',   cls: 'bg-blue-100 text-blue-700' },
              sms:     { label: 'SMS',     cls: 'bg-green-100 text-green-700' },
              webhook: { label: 'Webhook', cls: 'bg-purple-100 text-purple-700' },
            }

            if (dispatches.length === 0) {
              return <p className="text-sm text-gray-400 italic">No rule actions triggered for this message.</p>
            }

            return (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Forwards ({dispatches.length})
                </p>
                <div className="space-y-2">
                  {dispatches.map((d) => {
                    const s = STATUS_DISPATCH[d.status] || { label: d.status, cls: 'text-gray-700 bg-gray-50 border-gray-200' }
                    const t = TYPE_BADGE[d.action_type || 'email'] || TYPE_BADGE.email
                    return (
                      <div key={d.id} className={`rounded-lg border px-4 py-3 text-sm ${s.cls}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${t.cls}`}>{t.label}</span>
                            <span className="font-semibold">{d.rule_name || 'Rule removed'}</span>
                            <span className="opacity-50">→</span>
                            <span className="font-mono break-all">{d.email}</span>
                          </div>
                          <span className="text-xs font-bold uppercase tracking-wide flex-shrink-0">{s.label}</span>
                        </div>
                        {d.sent_at && (
                          <p className="mt-1 text-xs opacity-60">Sent: {fmt(d.sent_at)}</p>
                        )}
                        {d.error && (
                          <div className="mt-2 font-mono text-xs bg-red-100 text-red-800 border border-red-200 rounded px-3 py-2 break-all">
                            <span className="font-bold">Error: </span>{d.error}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
