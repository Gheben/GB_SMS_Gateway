import { useState, useEffect } from 'react'
import { settingsApi, messagesApi } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { Save, Send, CheckCircle, AlertCircle, Eye, EyeOff, RotateCcw, Mail, FileCode, Loader2, Shield, ExternalLink, Globe, Clock, RefreshCw } from 'lucide-react'
import MessageDetailModal from '../components/MessageDetailModal'

const DEFAULT_TEMPLATE = `<table style="font-family:Arial,sans-serif;max-width:600px;border-collapse:collapse">
  <tr>
    <td colspan="2" style="background:#1d4ed8;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">
      New SMS received &mdash; GB SMS Gateway
    </td>
  </tr>
  <tr>
    <td style="padding:10px 20px;font-weight:bold;color:#555;width:130px">From</td>
    <td style="padding:10px 20px">{{sender}}</td>
  </tr>
  <tr style="background:#f9fafb">
    <td style="padding:10px 20px;font-weight:bold;color:#555">Device</td>
    <td style="padding:10px 20px">{{device}}</td>
  </tr>
  <tr>
    <td style="padding:10px 20px;font-weight:bold;color:#555">SIM Port</td>
    <td style="padding:10px 20px">{{port}}</td>
  </tr>
  <tr style="background:#f9fafb">
    <td style="padding:10px 20px;font-weight:bold;color:#555">Received</td>
    <td style="padding:10px 20px">{{received_at}}</td>
  </tr>
  <tr>
    <td style="padding:10px 20px;font-weight:bold;color:#555">Rule</td>
    <td style="padding:10px 20px">{{rule}}</td>
  </tr>
  <tr style="background:#eef2ff">
    <td colspan="2" style="padding:16px 20px;font-size:15px;white-space:pre-wrap;word-break:break-word">
      {{content}}
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:10px 20px;font-size:11px;color:#aaa">
      GB SMS Gateway &middot; {{timestamp}}
    </td>
  </tr>
</table>`

const DEFAULT_SUBJECT = '[SMS Gateway] New SMS from {{sender}}'

const SUBJECT_VARIABLES = [
  { key: '{{sender}}',      desc: 'SMS sender number' },
  { key: '{{device}}',      desc: 'GSM device name' },
  { key: '{{port}}',        desc: 'SIM port (number)' },
  { key: '{{rule}}',        desc: 'Name of the triggered rule' },
  { key: '{{received_at}}', desc: 'Date/time received' },
]

const VARIABLES = [
  { key: '{{sender}}',      desc: 'SMS sender number' },
  { key: '{{content}}',     desc: 'SMS message text' },
  { key: '{{device}}',      desc: 'GSM device name' },
  { key: '{{port}}',        desc: 'SIM port (number)' },
  { key: '{{received_at}}', desc: 'Date/time received' },
  { key: '{{rule}}',        desc: 'Name of the triggered rule' },
  { key: '{{email}}',       desc: 'Forwarding recipient email' },
  { key: '{{timestamp}}',   desc: 'Email send timestamp' },
]

export default function Settings() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'superadmin'

  const [smtp, setSmtp] = useState({
    host: '', port: '587', secure: false, ignoreTls: false, user: '', pass: '', from: '',
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [result, setResult] = useState(null)
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('smtp')

  // Template email
  const [template, setTemplate]           = useState('')
  const [templateDirty, setTemplateDirty] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateResult, setTemplateResult] = useState(null)
  const [previewHtml, setPreviewHtml]     = useState(false)

  // Oggetto email
  const [subject, setSubject]             = useState('')
  const [subjectDirty, setSubjectDirty]   = useState(false)
  const [subjectSaving, setSubjectSaving] = useState(false)

  // SAML
  const [saml, setSaml] = useState({
    enabled: false, sp_base_url: window.location.origin, sp_entity_id: '',
    idp_sso_url: '', idp_slo_url: '', idp_cert: '', username_attribute: '', display_name_attribute: 'displayName', default_role: 'user',
  })
  const [samlDirty, setSamlDirty]   = useState(false)
  const [samlSaving, setSamlSaving] = useState(false)
  const [samlResult, setSamlResult] = useState(null)

  // Webhook whitelist
  const [webhookHosts, setWebhookHosts]     = useState('')
  const [webhookDirty, setWebhookDirty]     = useState(false)
  const [webhookSaving, setWebhookSaving]   = useState(false)
  const [webhookResult, setWebhookResult]   = useState(null)

  // NTP / Timezone
  const [ntp, setNtp]             = useState({ ntp_server: 'pool.ntp.org', timezone: 'Europe/Rome' })
  const [ntpDirty, setNtpDirty]   = useState(false)
  const [ntpSaving, setNtpSaving] = useState(false)
  const [ntpResult, setNtpResult] = useState(null)
  const [ntpSyncing, setNtpSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  useEffect(() => {
    Promise.all([
      settingsApi.getSmtp(),
      settingsApi.getTemplate(),
      settingsApi.getSubject(),
      isSuperAdmin ? settingsApi.getSaml() : Promise.resolve(null),
      settingsApi.getWebhook(),
      isSuperAdmin ? settingsApi.getNtp() : Promise.resolve(null),
    ]).then(([smtpData, tplData, subjData, samlData, webhookData, ntpData]) => {
        setSmtp(s => ({ ...s, ...smtpData, pass: '' }))
        setTestEmail(smtpData.user || '')
        setTemplate(tplData.template || DEFAULT_TEMPLATE)
        setSubject(subjData.subject || DEFAULT_SUBJECT)
        if (samlData) setSaml(s => ({ ...s, ...samlData }))
        if (webhookData) setWebhookHosts(webhookData.allowed_hosts || '')
        if (ntpData) setNtp(n => ({ ...n, ...ntpData }))
        setLoading(false)
      }).catch(() => setLoading(false))
  }, [])

  function set(field, value) {
    setSmtp(s => ({ ...s, [field]: value }))
    setDirty(true)
    setResult(null)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setResult(null)
    try {
      await settingsApi.saveSmtp(smtp)
      setResult({ success: true, message: 'SMTP settings saved.' })
      setDirty(false)
    } catch (err) {
      setResult({ success: false, message: err.response?.data?.error || 'Save error.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!testEmail) return
    setTesting(true)
    setResult(null)
    try {
      await settingsApi.testSmtp(testEmail)
      setResult({ success: true, message: `Test email sent to ${testEmail}.` })
    } catch (err) {
      setResult({ success: false, message: err.response?.data?.error || 'Error sending test email.' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveSubject() {
    setSubjectSaving(true)
    setTemplateResult(null)
    try {
      await settingsApi.saveSubject(subject)
      setSubjectDirty(false)
      setTemplateResult({ success: true, message: 'Email subject saved.' })
    } catch {
      setTemplateResult({ success: false, message: "Error saving email subject." })
    } finally {
      setSubjectSaving(false)
    }
  }

  async function handleSaveTemplate() {
    setTemplateSaving(true)
    setTemplateResult(null)
    try {
      await settingsApi.saveTemplate(template)
      setTemplateDirty(false)
      setTemplateResult({ success: true, message: 'Template saved.' })
    } catch {
      setTemplateResult({ success: false, message: 'Error saving template.' })
    } finally {
      setTemplateSaving(false)
    }
  }

  async function handleSaveSaml() {
    setSamlSaving(true); setSamlResult(null)
    try {
      await settingsApi.saveSaml(saml)
      setSamlDirty(false)
      setSamlResult({ success: true, message: 'SAML configuration saved.' })
    } catch {
      setSamlResult({ success: false, message: 'Error saving SAML configuration.' })
    } finally {
      setSamlSaving(false)
    }
  }

  async function handleSaveWebhook() {
    setWebhookSaving(true); setWebhookResult(null)
    try {
      await settingsApi.saveWebhook({ allowed_hosts: webhookHosts })
      setWebhookDirty(false)
      setWebhookResult({ success: true, message: 'Webhook whitelist saved.' })
    } catch {
      setWebhookResult({ success: false, message: 'Error saving webhook whitelist.' })
    } finally {
      setWebhookSaving(false)
    }
  }

  async function handleSaveNtp() {
    setNtpSaving(true); setNtpResult(null)
    try {
      await settingsApi.saveNtp(ntp)
      setNtpDirty(false)
      setNtpResult({ success: true, message: 'NTP / timezone settings saved.' })
    } catch (err) {
      setNtpResult({ success: false, message: err.response?.data?.error || 'Error saving settings.' })
    } finally {
      setNtpSaving(false)
    }
  }

  async function handleSyncNtp() {
    setNtpSyncing(true); setSyncResult(null)
    try {
      const r = await settingsApi.syncNtp()
      const offsetSec = (r.offset_ms / 1000).toFixed(2)
      const sign = r.offset_ms >= 0 ? '+' : ''
      setSyncResult({
        success: true,
        message: `NTP OK — server time: ${new Date(r.ntp_time).toLocaleString()} — offset: ${sign}${offsetSec}s`,
      })
    } catch (err) {
      setSyncResult({ success: false, message: err.response?.data?.error || 'NTP query failed.' })
    } finally {
      setNtpSyncing(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center py-8 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading...
    </div>
  )

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Settings</h2>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {[
          { key: 'smtp',     label: 'SMTP & Email',   icon: <Mail size={14} />,    superadminOnly: false },
          { key: 'template', label: 'Template',        icon: <FileCode size={14} />, superadminOnly: false },
          { key: 'saml',     label: 'SAML / SSO',      icon: <Shield size={14} />,  superadminOnly: true  },
          { key: 'webhook',  label: 'Webhook',         icon: <Globe size={14} />,   superadminOnly: false },
          { key: 'system',   label: 'System',          icon: <Clock size={14} />,   superadminOnly: true  },
        ].filter(t => !t.superadminOnly || isSuperAdmin).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── SMTP & Test ── */}
      {tab === 'smtp' && (
        <div className="space-y-8">
          {/* SMTP */}
          <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            <h3 className="text-base font-semibold text-gray-700">SMTP Configuration</h3>
            <p className="text-sm text-gray-500">
              Used to send SMS forwarding emails when routing rules are triggered.
            </p>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="label">SMTP Server</label>
                  <input className="input" placeholder="smtp.company.com" value={smtp.host}
                    onChange={e => set('host', e.target.value)} />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="input" type="number" placeholder="587" value={smtp.port}
                    onChange={e => set('port', e.target.value)} />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="secure" checked={smtp.secure}
                    onChange={e => set('secure', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  <label htmlFor="secure" className="text-sm text-gray-700">
                    Direct TLS (SSL, port 465) — disable for STARTTLS
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="ignoreTls" checked={smtp.ignoreTls}
                    onChange={e => set('ignoreTls', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  <label htmlFor="ignoreTls" className="text-sm text-gray-700">
                    Skip STARTTLS — relay without authentication (e.g. internal port 25)
                  </label>
                </div>
              </div>

              <div>
                <label className="label">SMTP User</label>
                <input className="input" type="email" placeholder="smsgateway@company.com"
                  value={smtp.user} onChange={e => set('user', e.target.value)} />
              </div>

              <div>
                <label className="label">Password <span className="text-gray-400 font-normal">(leave blank to keep current)</span></label>
                <div className="relative">
                  <input className="input pr-10" type={showPass ? 'text' : 'password'}
                    placeholder="••••••••" value={smtp.pass}
                    onChange={e => set('pass', e.target.value)} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Sender (From)</label>
                <input className="input" placeholder='GB SMS Gateway <smsgateway@company.com>'
                  value={smtp.from} onChange={e => set('from', e.target.value)} />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={saving || !dirty} className="btn-primary flex items-center gap-2">
                  <Save size={15} />{saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </section>

          {/* Test email */}
          <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-700">Email test</h3>
            <p className="text-sm text-gray-500">
              Send a test email using the current (already saved) SMTP configuration.
            </p>
            <div className="flex gap-3">
              <input className="input flex-1" type="email" placeholder="destinatario@esempio.it"
                value={testEmail} onChange={e => setTestEmail(e.target.value)} />
              <button onClick={handleTest} disabled={testing || !testEmail}
                className="btn-primary flex items-center gap-2 whitespace-nowrap">
                <Send size={15} />{testing ? 'Sending...' : 'Send test'}
              </button>
            </div>
          </section>

          {result && (
            <div className={`flex items-start gap-3 p-4 rounded-lg border ${result.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {result.success ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
              <p className="text-sm">{result.message}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Template email ── */}
      {tab === 'template' && (
        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-gray-700">HTML Email Template</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Customize the HTML body of the email sent for each forwarded SMS.
                  Use the variables below to insert dynamic data.
                </p>
              </div>
              <button type="button" onClick={() => setPreviewHtml(v => !v)}
                className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100 whitespace-nowrap flex items-center gap-1.5">
                <Eye size={13} />{previewHtml ? 'Edit' : 'Preview'}
              </button>
            </div>

            {/* Oggetto email */}
            <div className="space-y-1">
                <label className="label">Email subject</label>
              <div className="flex gap-2">
                <input
                  className="input flex-1 font-mono text-sm"
                  value={subject}
                  onChange={e => { setSubject(e.target.value); setSubjectDirty(true); setTemplateResult(null) }}
                  placeholder={DEFAULT_SUBJECT}
                />
                <button type="button" onClick={handleSaveSubject} disabled={subjectSaving || !subjectDirty}
                  className="btn-primary flex items-center gap-2 whitespace-nowrap">
                  <Save size={14} />{subjectSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUBJECT_VARIABLES.map(v => (
                  <button key={v.key} type="button" title={v.desc}
                    onClick={() => { setSubject(s => s + v.key); setSubjectDirty(true) }}
                    className="font-mono text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5 hover:bg-blue-100 transition-colors">
                    {v.key}
                  </button>
                ))}
                <button type="button"
                  onClick={() => { setSubject(DEFAULT_SUBJECT); setSubjectDirty(true); setTemplateResult(null) }}
                  className="text-xs border border-gray-300 rounded px-2 py-0.5 text-gray-500 hover:bg-gray-50 flex items-center gap-1">
                  <RotateCcw size={10} /> default
                </button>
              </div>
            </div>

            <hr className="border-gray-100" />

            {/* Variabili corpo email */}
            <div>
              <p className="text-sm text-gray-500 mb-2">HTML body — available variables:</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {VARIABLES.map(v => (
                <button key={v.key} type="button" title={v.desc}
                  onClick={() => { setTemplate(t => t + v.key); setTemplateDirty(true) }}
                  className="font-mono text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5 hover:bg-blue-100 transition-colors">
                  {v.key}
                </button>
              ))}
            </div>

            {previewHtml ? (
              <div className="border border-gray-200 rounded-lg p-4 min-h-[300px] overflow-auto"
                dangerouslySetInnerHTML={{ __html: template
                  .replace(/{{sender}}/g, '+39347123456')
                  .replace(/{{content}}/g, 'This is a sample SMS for the preview.')
                  .replace(/{{device}}/g, 'GSM-01 Main')
                  .replace(/{{port}}/g, '3')
                  .replace(/{{received_at}}/g, new Date().toISOString())
                  .replace(/{{rule}}/g, 'OTP Forward')
                  .replace(/{{email}}/g, 'recipient@company.com')
                  .replace(/{{timestamp}}/g, new Date().toLocaleString('en-US'))
                }}
              />
            ) : (
              <textarea className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                rows={18} value={template} spellCheck={false}
                onChange={e => { setTemplate(e.target.value); setTemplateDirty(true); setTemplateResult(null) }} />
            )}

            <div className="flex items-center gap-3">
              <button type="button" onClick={handleSaveTemplate} disabled={templateSaving || !templateDirty}
                className="btn-primary flex items-center gap-2">
                <Save size={14} />{templateSaving ? 'Saving...' : 'Save template'}
              </button>
              <button type="button"
                onClick={() => { setTemplate(DEFAULT_TEMPLATE); setTemplateDirty(true); setTemplateResult(null) }}
                className="btn-ghost flex items-center gap-2 text-gray-500">
                <RotateCcw size={14} />Restore default
              </button>
            </div>

            {templateResult && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                templateResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {templateResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {templateResult.message}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── SAML / SSO ── */}
      {tab === 'saml' && (
        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-gray-700">SAML 2.0 Authentication</h3>
              <p className="text-sm text-gray-500 mt-1">
                Enable login via a SAML Identity Provider (e.g. NetScaler, ADFS, Azure AD).
                The Service Provider is configured as SP-initiated (the browser is redirected to the IdP and then back here).
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={saml.enabled}
                onChange={e => { setSaml(s => ({ ...s, enabled: e.target.checked })); setSamlDirty(true) }}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Enable SAML 2.0 authentication</span>
            </label>

            {/* Info da comunicare al tecnico IdP */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Data to share with IdP</p>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-blue-600 font-medium">ACS URL (Assertion Consumer Service):</span>
                  <code className="block text-xs bg-white border border-blue-200 rounded px-2 py-1 mt-0.5 break-all">
                    {saml.sp_base_url}/api/auth/saml/callback
                  </code>
                </div>
                <div>
                  <span className="text-xs text-blue-600 font-medium">SP Entity ID:</span>
                  <code className="block text-xs bg-white border border-blue-200 rounded px-2 py-1 mt-0.5 break-all">
                    {saml.sp_entity_id || `${saml.sp_base_url}/api/auth/saml/metadata`}
                  </code>
                </div>
                <div>
                  <span className="text-xs text-blue-600 font-medium">SP Metadata XML:</span>
                  <a href="/api/auth/saml/metadata" target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-700 underline mt-0.5 hover:text-blue-900">
                    <ExternalLink size={11} /> /api/auth/saml/metadata
                  </a>
                </div>
                <div>
                  <span className="text-xs text-blue-600 font-medium">SLO URL (Single Logout):</span>
                  <code className="block text-xs bg-white border border-blue-200 rounded px-2 py-1 mt-0.5 break-all">
                    {saml.sp_base_url}/api/auth/saml/slo
                  </code>
                </div>
                <div>
                  <span className="text-xs text-blue-600 font-medium">Binding:</span>
                  <span className="text-xs text-blue-800 ml-1">HTTP-POST</span>
                </div>
              </div>
            </div>

            {/* Note LDAP mapping */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Integration with LDAP group mapping</p>
              <p className="text-xs text-amber-700">
                If group mappings are configured in <strong>User management → LDAP / Active Directory</strong>,
                the system applies them automatically to SAML users too: at each login the user&rsquo;s AD groups
                are retrieved and the role is assigned based on the configured mapping.
                Only if no group matches is the <em>Default role</em> configured below used.
              </p>
              <p className="text-xs text-amber-600">
                <strong>Tip:</strong> ask the IdP admin to include the{' '}
                <code className="bg-amber-100 px-1 rounded">memberOf</code> attribute in the SAML assertion —
                this reduces traffic to the Domain Controller and ensures group resolution
                even if the DC is temporarily unreachable from the gateway.
              </p>
            </div>

            {/* SP Config */}
            <div>
              <label className="label">SP Base URL <span className="text-gray-400 font-normal">(public URL of this application)</span></label>
              <input className="input" placeholder="https://smsgateway.company.com"
                value={saml.sp_base_url}
                onChange={e => { setSaml(s => ({ ...s, sp_base_url: e.target.value })); setSamlDirty(true) }} />
              <p className="text-xs text-gray-400 mt-1">Must match the URL users use to access the application.</p>
            </div>
            <div>
              <label className="label">SP Entity ID <span className="text-gray-400 font-normal">(leave empty to use default)</span></label>
              <input className="input" placeholder={`${saml.sp_base_url}/api/auth/saml/metadata`}
                value={saml.sp_entity_id}
                onChange={e => { setSaml(s => ({ ...s, sp_entity_id: e.target.value })); setSamlDirty(true) }} />
            </div>

            {/* IdP Config */}
            <div>
              <label className="label">IdP SSO URL <span className="text-gray-400 font-normal">(Identity Provider login URL)</span></label>
              <input className="input" placeholder="https://nfactor.azienda.it/saml/login"
                value={saml.idp_sso_url}
                onChange={e => { setSaml(s => ({ ...s, idp_sso_url: e.target.value })); setSamlDirty(true) }} />
            </div>
            <div>
              <label className="label">IdP SLO URL <span className="text-gray-400 font-normal">(Single Logout — optional)</span></label>
              <input className="input" placeholder="https://nfactor.azienda.it/cgi/tmlogout"
                value={saml.idp_slo_url}
                onChange={e => { setSaml(s => ({ ...s, idp_slo_url: e.target.value })); setSamlDirty(true) }} />
              <p className="text-xs text-gray-400 mt-1">If configured, logging out from this app will also terminate the session on the Identity Provider (NetScaler).</p>
            </div>
            <div>
              <label className="label">Certificato IdP (X.509 PEM)</label>
              <textarea className="input font-mono text-xs" rows={6}
                placeholder={'-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----'}
                value={saml.idp_cert}
                onChange={e => { setSaml(s => ({ ...s, idp_cert: e.target.value })); setSamlDirty(true) }} />
              <p className="text-xs text-gray-400 mt-1">Paste the X.509 certificate provided by the NetScaler administrator. Accepted with or without PEM header.</p>
            </div>

            {/* Attribute mapping */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Username attribute <span className="text-gray-400 font-normal">(empty = NameID)</span></label>
                <input className="input" placeholder="NameID (default)"
                  value={saml.username_attribute}
                  onChange={e => { setSaml(s => ({ ...s, username_attribute: e.target.value })); setSamlDirty(true) }} />
              </div>
              <div>
                <label className="label">Attributo display name</label>
                <input className="input" placeholder="displayName"
                  value={saml.display_name_attribute}
                  onChange={e => { setSaml(s => ({ ...s, display_name_attribute: e.target.value })); setSamlDirty(true) }} />
              </div>
            </div>
            <div>
              <label className="label">Default role for new SAML users</label>
              <select className="input" value={saml.default_role}
                onChange={e => { setSaml(s => ({ ...s, default_role: e.target.value })); setSamlDirty(true) }}>
                <option value="user">User (user)</option>
                <option value="admin">Administrator (admin)</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">The role can be changed individually in &ldquo;User management&rdquo; after the first login.</p>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={handleSaveSaml} disabled={samlSaving || !samlDirty}
                className="btn-primary flex items-center gap-2">
                <Save size={15} />{samlSaving ? 'Saving...' : 'Save SAML configuration'}
              </button>
            </div>

            {samlResult && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                samlResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {samlResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {samlResult.message}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Webhook ── */}
      {tab === 'webhook' && (
        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-gray-700">Webhook Allowed Hosts</h3>
              <p className="text-sm text-gray-500 mt-1">
                Define which hosts routing rules are allowed to send webhook requests to.
                One entry per line (or comma-separated). Supported formats:
              </p>
              <ul className="text-xs text-gray-500 list-disc list-inside mt-2 space-y-0.5">
                <li><code className="bg-gray-100 px-1 rounded">myserver.internal</code> — exact hostname</li>
                <li><code className="bg-gray-100 px-1 rounded">*.company.com</code> — wildcard subdomain</li>
                <li><code className="bg-gray-100 px-1 rounded">192.168.1.0/24</code> — CIDR range</li>
              </ul>
              <p className="text-xs text-amber-600 mt-2">
                An empty whitelist blocks <strong>all</strong> webhook requests.
              </p>
            </div>

            <div>
              <label className="label">Allowed hosts</label>
              <textarea
                className="input font-mono text-xs"
                rows={8}
                placeholder={"myserver.internal\n*.company.com\n192.168.1.0/24"}
                value={webhookHosts}
                onChange={e => { setWebhookHosts(e.target.value); setWebhookDirty(true); setWebhookResult(null) }}
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={handleSaveWebhook} disabled={webhookSaving || !webhookDirty}
                className="btn-primary flex items-center gap-2">
                <Save size={15} />{webhookSaving ? 'Saving...' : 'Save whitelist'}
              </button>
            </div>

            {webhookResult && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                webhookResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {webhookResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {webhookResult.message}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── System (NTP / Timezone) ── */}
      {tab === 'system' && (
        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-gray-700">Date &amp; Time</h3>
              <p className="text-sm text-gray-500 mt-1">
                Configure the NTP server used to verify server time accuracy and the timezone applied
                to all timestamps in the application.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="label">NTP Server</label>
                <input
                  className="input font-mono"
                  placeholder="pool.ntp.org"
                  value={ntp.ntp_server}
                  onChange={e => { setNtp(n => ({ ...n, ntp_server: e.target.value })); setNtpDirty(true); setNtpResult(null) }}
                />
                <p className="text-xs text-gray-400 mt-1">e.g. <code>pool.ntp.org</code>, <code>ntp.inrim.it</code>, <code>time.windows.com</code></p>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="label">Timezone (IANA)</label>
                <input
                  className="input font-mono"
                  placeholder="Europe/Rome"
                  value={ntp.timezone}
                  onChange={e => { setNtp(n => ({ ...n, timezone: e.target.value })); setNtpDirty(true); setNtpResult(null) }}
                />
                <p className="text-xs text-gray-400 mt-1">e.g. <code>Europe/Rome</code>, <code>UTC</code>, <code>America/New_York</code></p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button type="button" onClick={handleSaveNtp} disabled={ntpSaving || !ntpDirty}
                className="btn-primary flex items-center gap-2">
                <Save size={14} />{ntpSaving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={handleSyncNtp} disabled={ntpSyncing}
                className="btn-ghost flex items-center gap-2 text-gray-600 border border-gray-200 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
                <RefreshCw size={14} className={ntpSyncing ? 'animate-spin' : ''} />
                {ntpSyncing ? 'Querying...' : 'Query NTP server'}
              </button>
            </div>

            {ntpResult && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                ntpResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {ntpResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {ntpResult.message}
              </div>
            )}

            {syncResult && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm font-mono ${
                syncResult.success ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {syncResult.success ? <Clock size={16} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={16} />}
                <span className="break-all">{syncResult.message}</span>
              </div>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Note</p>
              <p className="text-xs text-amber-700">
                The timezone is applied immediately to the running process and persisted in the database
                (survives restarts). The <strong>Query NTP server</strong> button checks reachability and
                reports the offset between the NTP server clock and the server&rsquo;s system clock — it does
                not modify the system clock (use your OS/Docker host NTP daemon for that).
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
