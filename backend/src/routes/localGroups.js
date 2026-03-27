const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/authMiddleware');
const auditService = require('../services/auditService');

const router = Router();

// Tutti gli endpoint gruppi locali richiedono ruolo admin
router.use(requireAdmin);

function sanitize(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
}

function getGroupFull(db, id) {
  const group = db.prepare('SELECT * FROM local_groups WHERE id = ?').get(id);
  if (!group) return null;
  const members = db.prepare(`
    SELECT u.id, u.username, u.role, u.source
    FROM local_group_members lgm
    JOIN users u ON u.id = lgm.user_id
    WHERE lgm.group_id = ?
    ORDER BY u.username
  `).all(id);
  return {
    ...group,
    permissions: JSON.parse(group.permissions || '{}'),
    allowed_ports: JSON.parse(group.allowed_ports || '[]'),
    members,
  };
}

// GET /api/groups — lista tutti i gruppi locali con conteggio membri
router.get('/', (req, res) => {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.*, COUNT(lgm.user_id) as member_count
    FROM local_groups g
    LEFT JOIN local_group_members lgm ON lgm.group_id = g.id
    GROUP BY g.id
    ORDER BY g.name
  `).all();
  res.json(groups.map(g => ({
    ...g,
    permissions: JSON.parse(g.permissions || '{}'),
    allowed_ports: JSON.parse(g.allowed_ports || '[]'),
  })));
});

// GET /api/groups/:id — dettaglio gruppo con membri
router.get('/:id', [param('id').isUUID()], (req, res) => {
  if (!sanitize(req, res)) return;
  const group = getGroupFull(getDb(), req.params.id);
  if (!group) return res.status(404).json({ error: 'Gruppo non trovato' });
  res.json(group);
});

// POST /api/groups — crea gruppo
router.post('/', [
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  body('description').optional().isString().trim().isLength({ max: 500 }),
  body('role').optional().isIn(['admin', 'user']),
  body('permissions').optional().isObject(),
  body('allowed_ports').optional().isArray(),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const id = uuidv4();
  const { name, description = '', role = 'user', permissions = {}, allowed_ports = [] } = req.body;
  try {
    db.prepare(`
      INSERT INTO local_groups (id, name, description, role, permissions, allowed_ports)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), description.trim(), role, JSON.stringify(permissions), JSON.stringify(allowed_ports));
    auditService.log(req.user.id, req.user.username, 'group:create', 'local_group', id, `Nome: ${name}`, req.ip);
    res.status(201).json(getGroupFull(db, id));
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Nome gruppo già in uso' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/groups/:id — modifica gruppo
router.put('/:id', [
  param('id').isUUID(),
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('description').optional().isString().trim().isLength({ max: 500 }),
  body('role').optional().isIn(['admin', 'user']),
  body('permissions').optional().isObject(),
  body('allowed_ports').optional().isArray(),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM local_groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Gruppo non trovato' });

  const name        = req.body.name        !== undefined ? req.body.name.trim()           : existing.name;
  const description = req.body.description !== undefined ? req.body.description.trim()    : existing.description;
  const role        = req.body.role        !== undefined ? req.body.role                  : existing.role;
  const permissions = req.body.permissions !== undefined ? req.body.permissions           : JSON.parse(existing.permissions || '{}');
  const allowed_ports = req.body.allowed_ports !== undefined ? req.body.allowed_ports     : JSON.parse(existing.allowed_ports || '[]');

  try {
    db.prepare(`
      UPDATE local_groups SET name=?, description=?, role=?, permissions=?, allowed_ports=? WHERE id=?
    `).run(name, description, role, JSON.stringify(permissions), JSON.stringify(allowed_ports), req.params.id);
    auditService.log(req.user.id, req.user.username, 'group:update', 'local_group', req.params.id, `Nome: ${name}`, req.ip);
    res.json(getGroupFull(db, req.params.id));
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Nome gruppo già in uso' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id — elimina gruppo (i membri vengono rimossi via CASCADE)
router.delete('/:id', [param('id').isUUID()], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT name FROM local_groups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Gruppo non trovato' });
  db.prepare('DELETE FROM local_groups WHERE id = ?').run(req.params.id);
  auditService.log(req.user.id, req.user.username, 'group:delete', 'local_group', req.params.id, `Nome: ${existing.name}`, req.ip);
  res.json({ ok: true });
});

// GET /api/groups/:id/members — lista membri del gruppo
router.get('/:id/members', [param('id').isUUID()], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM local_groups WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Gruppo non trovato' });
  }
  const members = db.prepare(`
    SELECT u.id, u.username, u.role, u.source
    FROM local_group_members lgm
    JOIN users u ON u.id = lgm.user_id
    WHERE lgm.group_id = ?
    ORDER BY u.username
  `).all(req.params.id);
  res.json(members);
});

// POST /api/groups/:id/members — aggiungi utente al gruppo
router.post('/:id/members', [
  param('id').isUUID(),
  body('userId').isUUID(),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM local_groups WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Gruppo non trovato' });
  }
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.body.userId);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  try {
    db.prepare('INSERT OR IGNORE INTO local_group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, req.body.userId);
    auditService.log(req.user.id, req.user.username, 'group:add_member', 'local_group', req.params.id, `Utente: ${user.username}`, req.ip);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id/members/:userId — rimuovi utente dal gruppo
router.delete('/:id/members/:userId', [
  param('id').isUUID(),
  param('userId').isUUID(),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.userId);
  db.prepare('DELETE FROM local_group_members WHERE group_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  auditService.log(req.user.id, req.user.username, 'group:remove_member', 'local_group', req.params.id, `Utente: ${user?.username || req.params.userId}`, req.ip);
  res.json({ ok: true });
});

// GET /api/groups/all — lista gruppi semplice per la selezione nelle regole (accessibile a tutti i loggati)
// Nota: questa route la aggiungiamo come endpoint separato in users.js per coerenza con ldap-groups
// Qui la esponiamo solo per admin, il frontend usa /api/users/local-groups per le regole

module.exports = router;
