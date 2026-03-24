const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { getAllUsers, createUser, updateUser, deleteUser, PERMISSION_KEYS, safeUser } = require('../services/authService');
const ldapService = require('../services/ldapService');

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
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    updateUser(req.params.id, {
      password: req.body.password,
      role: req.body.role,
      permissions: req.body.permissions,
    });
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
    res.json({ ok: true });
  } catch (err) {
    res.status(err.message === 'User not found' ? 404 : 403).json({ error: err.message });
  }
});

// GET /api/users/ldap-settings
router.get('/ldap-settings', (req, res) => {
  const cfg = ldapService.getLdapSettings() || {};
  // Non inviare la password al frontend — la restituiamo mascherata
  const safe = { ...cfg };
  if (safe.bind_password) safe.bind_password = '__SAVED__';
  res.json(safe);
});

// POST /api/users/ldap-settings
router.post('/ldap-settings', [body('host').optional().isString()], (req, res) => {
  try {
    const incoming = req.body;
    // Se bind_password === '__SAVED__' non sovrascrivere quella esistente
    if (incoming.bind_password === '__SAVED__') {
      const existing = ldapService.getLdapSettings();
      incoming.bind_password = existing?.bind_password || '';
    }
    ldapService.saveLdapSettings(incoming);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
