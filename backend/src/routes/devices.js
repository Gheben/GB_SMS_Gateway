const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const deviceManager = require('../services/deviceManager');

const router = Router();

const sanitize = (req, res) => {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
};

// GET /api/devices — lista tutti i dispositivi con stato connessione
router.get('/', (req, res) => {
  res.json(deviceManager.statusAll());
});

// GET /api/devices/:id
router.get('/:id', [param('id').isUUID()], (req, res) => {
  if (!sanitize(req, res)) return;
  const device = getDb().prepare(`SELECT id,name,host,port,username,enabled,created_at,updated_at FROM devices WHERE id=?`).get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ ...device, connected: deviceManager.get(req.params.id)?.connected ?? false });
});

// POST /api/devices — crea nuovo dispositivo
router.post('/', [
  body('name').isString().trim().notEmpty(),
  body('host').isString().trim().notEmpty(),
  body('port').optional().isInt({ min: 1, max: 65535 }).toInt(),
  body('username').optional().isString().trim(),
  body('password').optional().isString(),
  body('enabled').optional().isBoolean().toBoolean(),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const id = uuidv4();
  const { name, host, port = 5038, username = 'apiuser', password = 'apipass', enabled = true } = req.body;
  getDb().prepare(`
    INSERT INTO devices (id,name,host,port,username,password,enabled)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, name, host, port, username, password, enabled ? 1 : 0);
  deviceManager.reload(id);
  res.status(201).json({ id });
});

// PUT /api/devices/:id — aggiorna dispositivo
router.put('/:id', [
  param('id').isUUID(),
  body('name').optional().isString().trim().notEmpty(),
  body('host').optional().isString().trim().notEmpty(),
  body('port').optional().isInt({ min: 1, max: 65535 }).toInt(),
  body('username').optional().isString().trim(),
  body('password').optional().isString(),
  body('enabled').optional().isBoolean().toBoolean(),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM devices WHERE id=?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Device not found' });

  const fields = { ...existing, ...req.body, updated_at: new Date().toISOString() };
  // Se la password non è stata fornita o è stringa vuota, mantieni quella esistente
  if (!req.body.password) fields.password = existing.password;
  db.prepare(`
    UPDATE devices SET name=?,host=?,port=?,username=?,password=?,enabled=?,updated_at=? WHERE id=?
  `).run(fields.name, fields.host, fields.port, fields.username,
         fields.password, fields.enabled ? 1 : 0, fields.updated_at, req.params.id);

  deviceManager.reload(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/devices/:id
router.delete('/:id', [param('id').isUUID()], (req, res) => {
  if (!sanitize(req, res)) return;
  deviceManager.disconnect(req.params.id);
  getDb().prepare(`DELETE FROM devices WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
