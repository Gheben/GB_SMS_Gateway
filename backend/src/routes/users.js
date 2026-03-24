const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { getAllUsers, createUser, updateUser, deleteUser, PERMISSION_KEYS, safeUser } = require('../services/authService');
const ldapService = require('../services/ldapService');
const auditService = require('../services/auditService');

const router = Router();

// Tutti gli endpoint richiedono login + ruolo admin
router.use(requireAuth, requireAdmin);

// GET /api/users — lista utenti
router.get('/', (req, res) => {
  res.json(getAllUsers());
});

// GET /api/users/me — utente corrente (accessibile a tutti i loggati, ma passiamo
// prima requireAuth sopra che è già richiesto)
// ← Attenzione: questo route è SOTTO requireAdmin, ma /me è utile anche per user normali.
// Lo spostiamo come endpoint separato in auth.js se necessario.

// GET /api/users/permissions — lista chiavi di permesso disponibili
router.get('/permissions', (req, res) => {
  res.json(PERMISSION_KEYS);
});

// POST /api/users — crea utente
router.post('/', [
  body('username').isString().trim().isLength({ min: 3, max: 50 }),
  body('password').isString().isLength({ min: 6 }),
  body('role').optional().isIn(['admin', 'user']),
  body('permissions').optional().isObject(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const id = createUser(
      req.body.username,
      req.body.password,
      req.body.role || 'user',
      req.body.permissions || {}
    );
    auditService.log(req.user?.id, req.user?.username || 'system', 'user:create', 'user', id, `Username: ${req.body.username}`, req.ip);
    res.status(201).json({ id });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username già in uso' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — modifica utente (password, role, permissions)
router.put('/:id', [
  param('id').isUUID(),
  body('password').optional().isString().isLength({ min: 6 }),
  body('role').optional().isIn(['admin', 'user']),
  body('permissions').optional().isObject(),
  body('allowed_ports').optional().isArray(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    updateUser(req.params.id, {
      password: req.body.password,
      role: req.body.role,
      permissions: req.body.permissions,
      allowed_ports: req.body.allowed_ports,
    });
    auditService.log(req.user?.id, req.user?.username || 'system', 'user:update', 'user', req.params.id, null, req.ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.message === 'User not found' ? 404 : 403).json({ error: err.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    deleteUser(req.params.id);
    auditService.log(req.user?.id, req.user?.username || 'system', 'user:delete', 'user', req.params.id, null, req.ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.message === 'User not found' ? 404 : 403).json({ error: err.message });
  }
});

// GET /api/users/ldap-settings
router.get('/ldap-settings', (req, res) => {
  const cfg = ldapService.getLdapSettings() || {};
  // Non inviare password al frontend
  const safe = { ...cfg };
  if (safe.bind_password) safe.bind_password = '__SAVED__';
  if (safe.ldap_service_password) safe.ldap_service_password = '__SAVED__';
  res.json(safe);
});

// POST /api/users/ldap-settings
router.post('/ldap-settings', [body('host').optional().isString()], (req, res) => {
  try {
    const incoming = req.body;
    const existing = ldapService.getLdapSettings();
    // Se inviato come __SAVED__ non sovrascrivere la password esistente
    if (incoming.bind_password === '__SAVED__') incoming.bind_password = existing?.bind_password || '';
    if (incoming.ldap_service_password === '__SAVED__') incoming.ldap_service_password = existing?.ldap_service_password || '';
    ldapService.saveLdapSettings(incoming);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/ldap-groups — restituisce i group_mappings configurati (per la selezione nelle regole)
router.get('/ldap-groups', (req, res) => {
  const cfg = ldapService.getLdapSettings() || {};
  const groups = (cfg.group_mappings || []).map(m => ({ group_dn: m.group_dn, role: m.role }));
  res.json(groups);
});

// GET /api/users/local-groups — restituisce i gruppi locali (per la selezione nelle regole)
router.get('/local-groups', (req, res) => {
  const { getDb } = require('../db/database');
  const db = getDb();
  const groups = db.prepare('SELECT id, name, role FROM local_groups ORDER BY name').all();
  res.json(groups);
});

// POST /api/users/ldap-test
router.post('/ldap-test', async (req, res) => {
  try {
    const result = await ldapService.testConnection();
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

module.exports = router;
