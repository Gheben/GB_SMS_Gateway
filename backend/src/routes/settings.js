const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const { getSetting, setSettings } = require('../db/database');
const routingEngine = require('../services/routingEngine');
const { encrypt, decrypt } = require('../utils/encryption');
const { requireSuperAdmin, requireAdmin } = require('../middleware/authMiddleware');
const auditService = require('../services/auditService');

const router = Router();

// GET /api/settings/smtp — ritorna config attuale dal DB (senza password)
router.get('/smtp', (req, res) => {
  res.json({
    host:      getSetting('SMTP_HOST'),
    port:      getSetting('SMTP_PORT', '587'),
    secure:    getSetting('SMTP_SECURE', 'false') === 'true',
    ignoreTls: getSetting('SMTP_IGNORE_TLS', 'false') === 'true',
    user:      getSetting('SMTP_USER'),
    from:      getSetting('SMTP_FROM'),
  });
});

// POST /api/settings/smtp — salva config SMTP nel DB
router.post('/smtp', [
  body('host').notEmpty().withMessage('SMTP host obbligatorio'),
  body('port').isInt({ min: 1, max: 65535 }),
  body('user').optional({ checkFalsy: true }).isEmail(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { host, port, secure, ignoreTls, user, pass, from } = req.body;

  const updates = {
    SMTP_HOST:       host,
    SMTP_PORT:       String(port),
    SMTP_SECURE:     secure ? 'true' : 'false',
    SMTP_IGNORE_TLS: ignoreTls ? 'true' : 'false',
    SMTP_USER:       user || '',
    SMTP_FROM:       from || '',
  };
  if (pass) updates.SMTP_PASS = encrypt(pass);

  setSettings(updates);
  routingEngine.resetTransporter();

  auditService.log(req.user?.id, req.user?.username || 'system', 'settings:smtp_update', 'settings', null, `Host: ${host}:${port}, User: ${user || '(none)'}`, req.ip);
  res.json({ ok: true });
});

// POST /api/settings/smtp/test — invia email di test con la config salvata
router.post('/smtp/test', [
  body('to').isEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const host = getSetting('SMTP_HOST');
  if (!host) return res.status(400).json({ error: 'SMTP non configurato. Salva prima le impostazioni.' });

  try {
    const user = getSetting('SMTP_USER');
    const transporter = nodemailer.createTransport({
      host,
      port:      parseInt(getSetting('SMTP_PORT', '587'), 10),
      secure:    getSetting('SMTP_SECURE', 'false') === 'true',
      ignoreTLS: getSetting('SMTP_IGNORE_TLS', 'false') === 'true',
      auth: user ? { user, pass: decrypt(getSetting('SMTP_PASS')) } : undefined,
    });
    await transporter.sendMail({
      from: getSetting('SMTP_FROM') || 'smsgateway@local',
      to:   req.body.to,
      subject: '[GB SMS Gateway] Test email',
      html: '<p>Configurazione SMTP funzionante ✓</p>',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/email-template
router.get('/email-template', (req, res) => {
  res.json({ template: getSetting('EMAIL_TEMPLATE') || '' });
});

// POST /api/settings/email-template
router.post('/email-template', [
  body('template').isString().isLength({ max: 50000 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  setSettings({ EMAIL_TEMPLATE: req.body.template });
  auditService.log(req.user?.id, req.user?.username || 'system', 'settings:email_template_update', 'settings', null, null, req.ip);
  res.json({ ok: true });
});

// GET /api/settings/email-subject
router.get('/email-subject', (req, res) => {
  res.json({ subject: getSetting('EMAIL_SUBJECT') || '' });
});

// POST /api/settings/email-subject
router.post('/email-subject', [
  body('subject').isString().trim().isLength({ min: 1, max: 200 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  setSettings({ EMAIL_SUBJECT: req.body.subject.trim() });
  auditService.log(req.user?.id, req.user?.username || 'system', 'settings:email_subject_update', 'settings', null, `Subject: ${req.body.subject.trim()}`, req.ip);
  res.json({ ok: true });
});

// GET /api/settings/saml — solo superadmin
router.get('/saml', requireSuperAdmin, (req, res) => {
  const raw = getSetting('saml_config');
  if (!raw) return res.json({ enabled: false });
  try { res.json(JSON.parse(raw)); } catch { res.json({ enabled: false }); }
});

// POST /api/settings/saml — solo superadmin
router.post('/saml', requireSuperAdmin, [
  body('enabled').isBoolean().toBoolean(),
  body('auto_redirect').optional({ checkFalsy: false }).isBoolean().toBoolean(),
  body('sp_base_url').optional({ checkFalsy: true }).isString().trim(),
  body('sp_entity_id').optional({ checkFalsy: true }).isString().trim(),
  body('idp_sso_url').optional({ checkFalsy: true }).isString().trim(),
  body('idp_slo_url').optional({ checkFalsy: true }).isString().trim(),
  body('idp_cert').optional({ checkFalsy: true }).isString(),
  body('username_attribute').optional({ checkFalsy: true }).isString().trim(),
  body('display_name_attribute').optional({ checkFalsy: true }).isString().trim(),
  body('default_role').optional({ checkFalsy: true }).isIn(['admin', 'user']),
  body('require_group_match').optional({ checkFalsy: false }).isBoolean().toBoolean(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  setSettings({ saml_config: JSON.stringify(req.body) });
  auditService.log(req.user?.id, req.user?.username || 'system', 'settings:saml_update', 'settings', null, `enabled=${req.body.enabled}`, req.ip);
  res.json({ ok: true });
});

// GET /api/settings/webhook
router.get('/webhook', (req, res) => {
  res.json({ allowed_hosts: getSetting('WEBHOOK_ALLOWED_HOSTS') || '' });
});

// POST /api/settings/webhook
router.post('/webhook', [
  body('allowed_hosts').isString().isLength({ max: 10000 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  setSettings({ WEBHOOK_ALLOWED_HOSTS: req.body.allowed_hosts });
  auditService.log(req.user?.id, req.user?.username || 'system', 'settings:webhook_update', 'settings', null, null, req.ip);
  res.json({ ok: true });
});

// ─── NTP / Timezone ──────────────────────────────────────────────────────────

const NTP_HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

// GET /api/settings/ntp — admin + superadmin
router.get('/ntp', requireAdmin, (req, res) => {
  res.json({
    ntp_server: getSetting('NTP_SERVER', 'pool.ntp.org'),
    timezone:   getSetting('TZ', process.env.TZ || 'UTC'),
  });
});

// POST /api/settings/ntp — admin + superadmin
router.post('/ntp', requireAdmin, [
  body('ntp_server').isString().trim().isLength({ min: 1, max: 253 }),
  body('timezone').isString().trim().isLength({ min: 1, max: 100 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { ntp_server, timezone } = req.body;

  if (!NTP_HOST_RE.test(ntp_server.trim()))
    return res.status(400).json({ error: 'Invalid NTP server address (only hostname or IP allowed).' });

  try { new Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
  catch { return res.status(400).json({ error: 'Invalid IANA timezone identifier.' }); }

  setSettings({ NTP_SERVER: ntp_server.trim(), TZ: timezone.trim() });
  // Apply timezone immediately to the running process
  process.env.TZ = timezone.trim();
  auditService.log(req.user?.id, req.user?.username || 'system', 'settings:ntp_update', 'settings', null, `NTP: ${ntp_server.trim()}, TZ: ${timezone.trim()}`, req.ip);
  res.json({ ok: true });
});

// POST /api/settings/ntp/sync — queries NTP server and returns offset vs system clock
// Pure Node.js UDP — no extra npm packages required
router.post('/ntp/sync', requireAdmin, async (req, res) => {
  const ntpServer = getSetting('NTP_SERVER', 'pool.ntp.org');
  if (!NTP_HOST_RE.test(ntpServer))
    return res.status(400).json({ error: 'Invalid NTP server configured.' });

  const dgram = require('dgram');
  const NTP_PORT = 123;
  const socket = dgram.createSocket('udp4');
  const msg = Buffer.alloc(48, 0);
  msg[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)

  const timer = setTimeout(() => {
    try { socket.close(); } catch {}
    return res.status(504).json({ error: `NTP query timed out (server: ${ntpServer})` });
  }, 8000);

  socket.on('error', (err) => {
    clearTimeout(timer);
    try { socket.close(); } catch {}
    return res.status(500).json({ error: err.message });
  });

  socket.on('message', (data) => {
    clearTimeout(timer);
    socket.close();
    try {
      // Transmit timestamp: bytes 40-43 (seconds), 44-47 (fraction)
      const ntpSeconds = data.readUInt32BE(40);
      const ntpMs = Math.round((data.readUInt32BE(44) / 0x100000000) * 1000);
      const NTP_EPOCH_DELTA = 2208988800; // NTP epoch (1900) → Unix epoch (1970) in seconds
      const ntpTime = new Date((ntpSeconds - NTP_EPOCH_DELTA) * 1000 + ntpMs);
      const systemTime = new Date();
      const offsetMs = ntpTime.getTime() - systemTime.getTime();
      res.json({
        ok:          true,
        ntp_server:  ntpServer,
        ntp_time:    ntpTime.toISOString(),
        system_time: systemTime.toISOString(),
        offset_ms:   offsetMs,
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse NTP response: ' + e.message });
    }
  });

  socket.send(msg, NTP_PORT, ntpServer, (err) => {
    if (err) {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      return res.status(500).json({ error: err.message });
    }
  });
});

module.exports = router;

