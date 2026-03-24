export default function StatCard({ label, value, icon: Icon, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-700 border-blue-100',
    green:  'bg-green-50 text-green-700 border-green-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    red:    'bg-red-50 text-red-700 border-red-100',
  }
  return (
    <div className={`rounded-xl border p-5 flex items-center gap-4 ${colors[color]}`}>
      {Icon && <Icon size={28} strokeWidth={1.5} />}
      <div>
        <p className="text-2xl font-bold">{value ?? '—'}</p>
        <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      </div>
    </div>
  )
}
