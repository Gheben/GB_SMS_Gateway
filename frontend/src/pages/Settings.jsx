import { useState, useEffect } from 'react'
import { settingsApi, messagesApi } from '../api'
import { Save, Send, CheckCircle, AlertCircle, Eye, EyeOff, RotateCcw } from 'lucide-react'
import MessageDetailModal from '../components/MessageDetailModal'

const DEFAULT_TEMPLATE = `<table style="font-family:Arial,sans-serif;max-width:600px;border-collapse:collapse">
  <tr>
    <td colspan="2" style="background:#1d4ed8;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">
      Nuovo SMS ricevuto &mdash; GB SMS Gateway
    </td>
  </tr>
  <tr>
    <td style="padding:10px 20px;font-weight:bold;color:#555;width:130px">Da</td>
    <td style="padding:10px 20px">{{sender}}</td>
  </tr>
  <tr style="background:#f9fafb">
    <td style="padding:10px 20px;font-weight:bold;color:#555">Dispositivo</td>
    <td style="padding:10px 20px">{{device}}</td>
  </tr>
  <tr>
    <td style="padding:10px 20px;font-weight:bold;color:#555">Porta SIM</td>
    <td style="padding:10px 20px">{{port}}</td>
  </tr>
  <tr style="background:#f9fafb">
    <td style="padding:10px 20px;font-weight:bold;color:#555">Ricevuto</td>
    <td style="padding:10px 20px">{{received_at}}</td>
  </tr>
  <tr>
    <td style="padding:10px 20px;font-weight:bold;color:#555">Regola</td>
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

const VARIABLES = [
  { key: '{{sender}}',      desc: 'Numero mittente SMS' },
  { key: '{{content}}',     desc: 'Testo del messaggio SMS' },
  { key: '{{device}}',      desc: 'Nome del dispositivo GSM' },
  { key: '{{port}}',        desc: 'Porta SIM (numero)' },
  { key: '{{received_at}}', desc: 'Data/ora ricezione' },
  { key: '{{rule}}',        desc: 'Nome della regola attivata' },
  { key: '{{email}}',       desc: 'Email destinatario inoltro' },
  { key: '{{timestamp}}',   desc: 'Timestamp invio email' },
]

export default function Settings() {
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

  // Template email
  const [template, setTemplate]           = useState('')
  const [templateDirty, setTemplateDirty] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateResult, setTemplateResult] = useState(null)
  const [previewHtml, setPreviewHtml]     = useState(false)

  useEffect(() => {
    Promise.all([settingsApi.getSmtp(), settingsApi.getTemplate()])
      .then(([smtpData, tplData]) => {
        setSmtp(s => ({ ...s, ...smtpData, pass: '' }))
        setTestEmail(smtpData.user || '')
        setTemplate(tplData.template || DEFAULT_TEMPLATE)
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
      setResult({ success: true, message: 'Impostazioni SMTP salvate.' })
      setDirty(false)
    } catch (err) {
      setResult({ success: false, message: err.response?.data?.error || 'Errore nel salvataggio.' })
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
      setResult({ success: true, message: `Email di test inviata a ${testEmail}.` })
    } catch (err) {
      setResult({ success: false, message: err.response?.data?.error || 'Errore invio email di test.' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveTemplate() {
    setTemplateSaving(true)
    setTemplateResult(null)
    try {
      await settingsApi.saveTemplate(template)
      setTemplateDirty(false)
      setTemplateResult({ success: true, message: 'Template salvato.' })
    } catch {
      setTemplateResult({ success: false, message: 'Errore nel salvataggio del template.' })
    } finally {
      setTemplateSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-gray-500">Caricamento...</div>

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-2xl font-bold text-gray-800">Impostazioni</h2>

      {/* SMTP */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <h3 className="text-base font-semibold text-gray-700">Configurazione SMTP</h3>
        <p className="text-sm text-gray-500">
          Usato per inviare le email di inoltro SMS quando si attivano le regole di routing.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="label">Server SMTP</label>
              <input className="input" placeholder="smtp.azienda.it" value={smtp.host}
                onChange={e => set('host', e.target.value)} />
            </div>
            <div>
              <label className="label">Porta</label>
              <input className="input" type="number" placeholder="587" value={smtp.port}
                onChange={e => set('port', e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="secure"
                checked={smtp.secure}
                onChange={e => set('secure', e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <label htmlFor="secure" className="text-sm text-gray-700">
                TLS diretto (SSL, porta 465) — disabilita per STARTTLS
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="ignoreTls"
                checked={smtp.ignoreTls}
                onChange={e => set('ignoreTls', e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <label htmlFor="ignoreTls" className="text-sm text-gray-700">
                Ignora STARTTLS — relay senza autenticazione (es. porta 25 interno)
              </label>
            </div>
          </div>

          <div>
            <label className="label">Utente SMTP</label>
            <input className="input" type="email" placeholder="smsgateway@azienda.it"
              value={smtp.user} onChange={e => set('user', e.target.value)} />
          </div>

          <div>
            <label className="label">Password <span className="text-gray-400 font-normal">(lascia vuoto per non modificare)</span></label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••"
                value={smtp.pass}
                onChange={e => set('pass', e.target.value)}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Mittente (From)</label>
            <input className="input" placeholder='GB SMS Gateway <smsgateway@azienda.it>'
              value={smtp.from} onChange={e => set('from', e.target.value)} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving || !dirty} className="btn-primary flex items-center gap-2">
              <Save size={15} />{saving ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </form>
      </section>

      {/* Test email */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-700">Test email</h3>
        <p className="text-sm text-gray-500">
          Invia un'email di prova con la configurazione SMTP attuale (già salvata).
        </p>
        <div className="flex gap-3">
          <input
            className="input flex-1"
            type="email"
            placeholder="destinatario@esempio.it"
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
          />
          <button
            onClick={handleTest}
            disabled={testing || !testEmail}
            className="btn-primary flex items-center gap-2 whitespace-nowrap"
          >
            <Send size={15} />{testing ? 'Invio...' : 'Invia test'}
          </button>
        </div>
      </section>

      {result && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${result.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {result.success ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <p className="text-sm">{result.message}</p>
        </div>
      )}

      {/* Template email */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-gray-700">Template Email HTML</h3>
            <p className="text-sm text-gray-500 mt-1">
              Personalizza il corpo HTML dell&rsquo;email inviata per ogni SMS inoltrato.
              Usa le variabili sotto per inserire i dati dinamici.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewHtml(v => !v)}
            className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100 whitespace-nowrap flex items-center gap-1.5"
          >
            <Eye size={13} />{previewHtml ? 'Modifica' : 'Anteprima'}
          </button>
        </div>

        {/* Variabili disponibili */}
        <div className="flex flex-wrap gap-2">
          {VARIABLES.map(v => (
            <button
              key={v.key}
              type="button"
              title={v.desc}
              onClick={() => {
                setTemplate(t => t + v.key)
                setTemplateDirty(true)
              }}
              className="font-mono text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5 hover:bg-blue-100 transition-colors"
            >
              {v.key}
            </button>
          ))}
        </div>

        {previewHtml ? (
          <div
            className="border border-gray-200 rounded-lg p-4 min-h-[300px] overflow-auto"
            dangerouslySetInnerHTML={{ __html: template
              .replace(/{{sender}}/g, '+39347123456')
              .replace(/{{content}}/g, 'Questo è un SMS di esempio per la preview.')
              .replace(/{{device}}/g, 'GSM-01 Verona')
              .replace(/{{port}}/g, '3')
              .replace(/{{received_at}}/g, new Date().toISOString())
              .replace(/{{rule}}/g, 'Inoltro OTP')
              .replace(/{{email}}/g, 'destinatario@azienda.it')
              .replace(/{{timestamp}}/g, new Date().toLocaleString('it-IT'))
            }}
          />
        ) : (
          <textarea
            className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            rows={18}
            value={template}
            onChange={e => { setTemplate(e.target.value); setTemplateDirty(true); setTemplateResult(null) }}
            spellCheck={false}
          />
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={templateSaving || !templateDirty}
            className="btn-primary flex items-center gap-2"
          >
            <Save size={15} />{templateSaving ? 'Salvataggio...' : 'Salva template'}
          </button>
          <button
            type="button"
            onClick={() => { setTemplate(DEFAULT_TEMPLATE); setTemplateDirty(true); setTemplateResult(null) }}
            className="btn-ghost flex items-center gap-2 text-gray-500"
          >
            <RotateCcw size={14} />Ripristina default
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
  )
}
