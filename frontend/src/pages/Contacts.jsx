import { useEffect, useState, useRef } from 'react'
import { phonebookApi, ldapApi } from '../api'
import {
  Plus, Pencil, Trash2, X, RefreshCw, Save, Loader2,
  BookOpen, Globe, CheckCircle, AlertCircle
} from 'lucide-react'

const EMPTY_FORM = { display_name: '', phone: '', email: '', notes: '' }

function ContactModal({ contact, onSave, onClose, saving }) {
  const [form, setForm] = useState(contact || EMPTY_FORM)
  const [errors, setErrors] = useState({})

  function validate() {
    const e = {}
    if (!form.display_name.trim()) e.display_name = 'Name is required'
    if (!form.phone.trim()) e.phone = 'Phone is required'
    return e
  }

  function handleSubmit(ev) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-base font-semibold text-gray-800">{contact ? 'Edit contact' : 'New contact'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-full p-1 hover:bg-gray-200"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
            {errors.display_name && <p className="text-red-500 text-xs mt-1">{errors.display_name}</p>}
          </div>
          <div>
            <label className="label">Phone *</label>
            <input className="input font-mono" placeholder="+39012345678" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notes</label>
            <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Contacts() {
  const [tab, setTab] = useState('local')

  // Local contacts
  const [localContacts, setLocalContacts] = useState([])
  const [loadingLocal, setLoadingLocal] = useState(false)
  const [modalContact, setModalContact] = useState(null) // null=closed, {}=new, {id,...}=edit
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState(null)

  // LDAP contacts
  const [ldapContacts, setLdapContacts] = useState([])
  const [loadingLdap, setLoadingLdap] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [ldapError, setLdapError] = useState(null)
  const [syncMsg, setSyncMsg] = useState(null)
  const [syncProgress, setSyncProgress] = useState(null) // shown while running
  const [ldapSearchQuery, setLdapSearchQuery] = useState('')
  const [ldapPage, setLdapPage] = useState(1)
  const LDAP_PAGE_SIZE = 25
  const pollRef = useRef(null)

  // Global LDAP enabled flag (from superadmin LDAP config)
  const [globalLdapEnabled, setGlobalLdapEnabled] = useState(false)

  // LDAP settings
  const [ldapSettings, setLdapSettings] = useState({ enabled: false, base_dn: '', filter: '' })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState(null)

  // Load local contacts
  function fetchLocal() {
    setLoadingLocal(true)
    setLocalError(null)
    phonebookApi.getLocal()
      .then(setLocalContacts)
      .catch(e => setLocalError(e.response?.data?.error || 'Error loading contacts'))
      .finally(() => setLoadingLocal(false))
  }

  // Load LDAP contacts and settings
  function fetchLdap() {
    setLoadingLdap(true)
    setLdapError(null)
    Promise.all([
      phonebookApi.getLdapContacts().then(r => r.contacts || []),
      phonebookApi.getSettings(),
    ])
      .then(([contacts, settings]) => {
        setLdapContacts(contacts)
        setLdapSettings({ enabled: !!settings.enabled, base_dn: settings.base_dn || '', filter: settings.filter || '' })
      })
      .catch(e => setLdapError(e.response?.data?.error || 'Error loading LDAP data'))
      .finally(() => setLoadingLdap(false))
  }

  useEffect(() => {
    fetchLocal()
    // Check if global LDAP is enabled and configured
    ldapApi.getSettings()
      .then(cfg => setGlobalLdapEnabled(!!(cfg?.enabled && (cfg?.host || cfg?.ldap_server))))
      .catch(() => setGlobalLdapEnabled(false))
    // Clean up any running poll on unmount
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])
  useEffect(() => { if (tab === 'ldap') fetchLdap() }, [tab])

  async function handleSaveContact(form) {
    setSaving(true)
    try {
      if (modalContact?.id) {
        const updated = await phonebookApi.updateLocal(modalContact.id, form)
        setLocalContacts(c => c.map(x => x.id === updated.id ? updated : x))
      } else {
        const created = await phonebookApi.createLocal(form)
        setLocalContacts(c => [...c, created])
      }
      setModalContact(null)
    } catch (e) {
      setLocalError(e.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this contact?')) return
    try {
      await phonebookApi.deleteLocal(id)
      setLocalContacts(c => c.filter(x => x.id !== id))
    } catch (e) {
      setLocalError(e.response?.data?.error || 'Delete failed')
    }
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setSyncMsg(null)
    setSyncProgress('Starting sync…')
    setLdapError(null)
    stopPolling()
    try {
      const res = await phonebookApi.startLdapSync()
      if (res.status === 'already_running') setSyncProgress('Sync already in progress…')
    } catch (e) {
      setLdapError(e.response?.data?.error || 'Failed to start LDAP sync')
      setSyncing(false)
      setSyncProgress(null)
      return
    }
    // Poll every 3 seconds until done or error
    pollRef.current = setInterval(async () => {
      try {
        const s = await phonebookApi.getLdapStatus()
        if (s.status === 'running') {
          const elapsed = s.startedAt
            ? Math.round((Date.now() - new Date(s.startedAt)) / 1000)
            : ''
          setSyncProgress(`Syncing${elapsed ? ` (${elapsed}s)` : ''}… please wait`)
        } else {
          stopPolling()
          setSyncing(false)
          setSyncProgress(null)
          if (s.status === 'error') {
            setLdapError(`Sync failed: ${s.error}`)
          } else {
            setSyncMsg(`Sync complete: ${s.synced} contact${s.synced !== 1 ? 's' : ''} imported.`)
            // Reload contacts from DB
            phonebookApi.getLdapContacts()
              .then(r => { setLdapContacts(r.contacts || []); setLdapPage(1) })
              .catch(() => {})
          }
        }
      } catch {
        stopPolling()
        setSyncing(false)
        setSyncProgress(null)
        setLdapError('Lost contact with server during sync.')
      }
    }, 3000)
  }

  async function handleSaveSettings(e) {
    e.preventDefault()
    setSavingSettings(true)
    setSettingsMsg(null)
    try {
      await phonebookApi.saveSettings(ldapSettings)
      setSettingsMsg('Settings saved.')
    } catch (err) {
      setSettingsMsg('Error saving settings: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Phonebook</h2>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab('local')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'local' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <span className="flex items-center gap-2"><BookOpen size={15} /> Local contacts</span>
        </button>
        {globalLdapEnabled && (
          <button
            onClick={() => setTab('ldap')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'ldap' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <span className="flex items-center gap-2"><Globe size={15} /> LDAP / Active Directory</span>
          </button>
        )}
      </div>

      {/* ── LOCAL TAB ── */}
      {tab === 'local' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{localContacts.length} contact{localContacts.length !== 1 ? 's' : ''}</p>
            <button onClick={() => setModalContact({})} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={15} /> Add contact
            </button>
          </div>

          {localError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
              <AlertCircle size={15} /> {localError}
            </div>
          )}

          {loadingLocal ? (
            <div className="flex justify-center py-12 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading...</div>
          ) : localContacts.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No local contacts yet. Click <strong>Add contact</strong> to create one.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                    <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {localContacts.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">{c.display_name}</td>
                      <td className="px-4 py-3 font-mono text-gray-700">{c.phone}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{c.email || '—'}</td>
                      <td className="hidden md:table-cell px-4 py-3 text-gray-500 max-w-xs truncate">{c.notes || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => setModalContact(c)} className="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors"><Pencil size={14} /></button>
                          <button onClick={() => handleDelete(c.id)} className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── LDAP TAB ── */}
      {tab === 'ldap' && (
        <div className="space-y-6">
          {/* Settings section */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">LDAP settings</h3>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="ldap_enabled"
                  checked={ldapSettings.enabled}
                  onChange={e => setLdapSettings(s => ({ ...s, enabled: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600"
                />
                <label htmlFor="ldap_enabled" className="text-sm font-medium text-gray-700">Enable LDAP phonebook</label>
              </div>
              {ldapSettings.enabled && (
                <>
                  <div>
                    <label className="label">Base DN <span className="text-gray-400 font-normal text-xs">(leave empty to use global LDAP base DN)</span></label>
                    <input className="input font-mono text-sm" placeholder="OU=Users,DC=example,DC=com" value={ldapSettings.base_dn} onChange={e => setLdapSettings(s => ({ ...s, base_dn: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Filter <span className="text-gray-400 font-normal text-xs">(leave empty for default)</span></label>
                    <input className="input font-mono text-sm" placeholder="(objectClass=person)" value={ldapSettings.filter} onChange={e => setLdapSettings(s => ({ ...s, filter: e.target.value }))} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={savingSettings} className="btn-primary flex items-center gap-2 text-sm">
                  {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save settings
                </button>
                {settingsMsg && <p className={`text-xs ${settingsMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{settingsMsg}</p>}
              </div>
            </form>
          </div>

          {/* Contacts list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{ldapContacts.length} LDAP contact{ldapContacts.length !== 1 ? 's' : ''} in DB</p>
              <button
                onClick={handleSync}
                disabled={syncing || !ldapSettings.enabled}
                className="btn-secondary flex items-center gap-2 text-sm"
                title={!ldapSettings.enabled ? 'Enable LDAP phonebook first' : 'Sync contacts from Active Directory'}
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync LDAP'}
              </button>
            </div>

            {syncProgress && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm p-3 rounded-lg">
                <Loader2 size={15} className="animate-spin flex-shrink-0" /> {syncProgress}
              </div>
            )}

            {syncMsg && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm p-3 rounded-lg">
                <CheckCircle size={15} /> {syncMsg}
              </div>
            )}
            {ldapError && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">
                <AlertCircle size={15} /> {ldapError}
              </div>
            )}

            {loadingLdap ? (
              <div className="flex justify-center py-12 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading...</div>
            ) : ldapContacts.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                {ldapSettings.enabled ? 'No LDAP contacts in DB. Click Refresh LDAP to sync.' : 'LDAP phonebook is disabled.'}
              </div>
            ) : (() => {
              const q = ldapSearchQuery.trim().toLowerCase()
              const filtered = q
                ? ldapContacts.filter(c =>
                    c.display_name?.toLowerCase().includes(q) ||
                    c.phone?.includes(ldapSearchQuery.trim()) ||
                    c.email?.toLowerCase().includes(q))
                : ldapContacts
              const totalPages = Math.max(1, Math.ceil(filtered.length / LDAP_PAGE_SIZE))
              const safePage = Math.min(ldapPage, totalPages)
              const paged = filtered.slice((safePage - 1) * LDAP_PAGE_SIZE, safePage * LDAP_PAGE_SIZE)
              const btnCls = (disabled) => `px-2 py-1 text-xs rounded border transition-colors ${
                disabled ? 'border-gray-200 text-gray-300 cursor-not-allowed' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`
              return (
                <div className="space-y-2">
                  {/* Search */}
                  <input
                    type="text"
                    placeholder="Search by name, phone or email…"
                    value={ldapSearchQuery}
                    onChange={e => { setLdapSearchQuery(e.target.value); setLdapPage(1) }}
                    className="input text-sm"
                  />
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Name</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Phone (mobile)</th>
                          <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Email</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {paged.length === 0 ? (
                          <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No contacts match your search.</td></tr>
                        ) : paged.map(c => (
                          <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-800">{c.display_name}</td>
                            <td className="px-4 py-3 font-mono text-gray-700">{c.phone}</td>
                            <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{c.email || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-1">
                      <p className="text-xs text-gray-400">
                        {filtered.length} contact{filtered.length !== 1 ? 's' : ''}{q ? ` matching “${ldapSearchQuery.trim()}”` : ''}
                        {' '}— page {safePage} of {totalPages}
                      </p>
                      <div className="flex gap-1">
                        <button disabled={safePage === 1} onClick={() => setLdapPage(1)} className={btnCls(safePage === 1)}>«</button>
                        <button disabled={safePage === 1} onClick={() => setLdapPage(p => Math.max(1, p - 1))} className={btnCls(safePage === 1)}>‹</button>
                        <button disabled={safePage === totalPages} onClick={() => setLdapPage(p => Math.min(totalPages, p + 1))} className={btnCls(safePage === totalPages)}>›</button>
                        <button disabled={safePage === totalPages} onClick={() => setLdapPage(totalPages)} className={btnCls(safePage === totalPages)}>»</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Contact edit/create modal */}
      {modalContact !== null && (
        <ContactModal
          contact={modalContact?.id ? modalContact : null}
          onSave={handleSaveContact}
          onClose={() => setModalContact(null)}
          saving={saving}
        />
      )}
    </div>
  )
}
