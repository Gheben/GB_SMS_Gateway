const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const { getSetting, setSettings } = require('../db/database');
const routingEngine = require('../services/routingEngine');
const { encrypt, decrypt } = require('../utils/encryption');

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
  res.json({ ok: true });
});

// GET /api/settings/saml
router.get('/saml', (req, res) => {
  const raw = getSetting('saml_config');
  if (!raw) return res.json({ enabled: false });
  try { res.json(JSON.parse(raw)); } catch { res.json({ enabled: false }); }
});

// POST /api/settings/saml
router.post('/saml', [
  body('enabled').isBoolean().toBoolean(),
  body('sp_base_url').optional({ checkFalsy: true }).isString().trim(),
  body('sp_entity_id').optional({ checkFalsy: true }).isString().trim(),
  body('idp_sso_url').optional({ checkFalsy: true }).isString().trim(),
  body('idp_cert').optional({ checkFalsy: true }).isString(),
  body('username_attribute').optional({ checkFalsy: true }).isString().trim(),
  body('display_name_attribute').optional({ checkFalsy: true }).isString().trim(),
  body('default_role').optional({ checkFalsy: true }).isIn(['admin', 'user']),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  setSettings({ saml_config: JSON.stringify(req.body) });
  res.json({ ok: true });
});

module.exports = router;

