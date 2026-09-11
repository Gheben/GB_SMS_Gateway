const { Router } = require('express');
const { query, body, param, validationResult } = require('express-validator');
const { getDb } = require('../db/database');
const deviceManager = require('../services/deviceManager');
const auditService = require('../services/auditService');

const router = Router();

// GET /api/ports?device_id=xxx
router.get('/', [
  query('device_id').optional().isUUID(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const db = getDb();
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let ports;
  if (req.query.device_id) {
    const conn = deviceManager.get(req.query.device_id);
    if (conn && conn.connected) conn.requestPortStatus();
    ports = db.prepare(`
      SELECT p.*, d.name as device_name,
             COALESCE((
               SELECT COUNT(*) FROM messages m
               WHERE m.device_id = p.device_id AND m.port = p.port_number
                 AND m.direction = 'outbound'
                 AND strftime('%Y-%m', datetime(m.created_at, 'localtime')) = ?
             ), 0) AS sent_count
      FROM ports p
      JOIN devices d ON d.id=p.device_id
      WHERE p.device_id=? ORDER BY p.port_number
    `).all(ym, req.query.device_id);
  } else {
    ports = db.prepare(`
      SELECT p.*, d.name as device_name,
             COALESCE((
               SELECT COUNT(*) FROM messages m
               WHERE m.device_id = p.device_id AND m.port = p.port_number
                 AND m.direction = 'outbound'
                 AND strftime('%Y-%m', datetime(m.created_at, 'localtime')) = ?
             ), 0) AS sent_count
      FROM ports p
      JOIN devices d ON d.id=p.device_id
      ORDER BY d.name, p.port_number
    `).all(ym);
  }
  res.json(ports);
});

// GET /api/ports/stats?month=YYYY-MM — admin/superadmin only
router.get('/stats', (req, res) => {
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const now = new Date();
  const currentLocalMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = (req.query.month || currentLocalMonth).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format (expected YYYY-MM)' });
  }
  const db = getDb();
  const ports = db.prepare(`
    SELECT p.device_id, p.port_number, p.balanced, p.monthly_limit, p.sim_number, p.operator, p.status,
           d.name as device_name,
           COALESCE((
             SELECT COUNT(*) FROM messages m
             WHERE m.device_id = p.device_id AND m.port = p.port_number
               AND m.direction = 'outbound'
               AND strftime('%Y-%m', datetime(m.created_at, 'localtime')) = ?
           ), 0) AS sent_count
    FROM ports p
    JOIN devices d ON d.id = p.device_id
    ORDER BY d.name, p.port_number
  `).all(month);
  res.json({ month, ports });
});

// PUT /api/ports/:device_id/:port_number/info — salva sim_number, carrier, balanced e/o monthly_limit
router.put('/:device_id/:port_number/info', [
  param('device_id').isUUID(),
  param('port_number').isInt({ min: 1 }),
  body('sim_number').optional().isString().trim(),
  body('operator').optional().isString().trim(),
  body('balanced').optional().isBoolean(),
  body('monthly_limit').optional().isInt({ min: 0 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const db = getDb();
  const { sim_number, operator, balanced, monthly_limit } = req.body;
  const device_id   = req.params.device_id;
  const port_number = parseInt(req.params.port_number, 10);

  // Ensure the row exists (INSERT OR IGNORE keeps existing data intact)
  db.prepare(`
    INSERT OR IGNORE INTO ports (device_id, port_number, balanced, updated_at)
    VALUES (?, ?, 0, datetime('now'))
  `).run(device_id, port_number);

  // Build UPDATE only for the fields actually provided in the request body
  const setClauses = [];
  const params     = [];
  if (sim_number    !== undefined) { setClauses.push('sim_number = ?');    params.push(sim_number    || null); }
  if (operator      !== undefined) { setClauses.push('operator = ?');      params.push(operator      || null); }
  if (balanced      !== undefined) { setClauses.push('balanced = ?');      params.push(balanced ? 1 : 0); }
  if (monthly_limit !== undefined) { setClauses.push('monthly_limit = ?'); params.push(parseInt(monthly_limit, 10)); }

  if (setClauses.length > 0) {
    setClauses.push('updated_at = datetime(\'now\')');
    params.push(device_id, port_number);
    db.prepare(`UPDATE ports SET ${setClauses.join(', ')} WHERE device_id = ? AND port_number = ?`).run(...params);
  }

  const detail = [`Port: ${port_number}`];
  if (sim_number  !== undefined) detail.push(`SIM: ${sim_number || '—'}`);
  if (operator    !== undefined) detail.push(`Operator: ${operator || '—'}`);
  if (balanced    !== undefined) detail.push(`Balanced: ${balanced}`);
  if (monthly_limit !== undefined) detail.push(`Monthly limit: ${monthly_limit}`);
  auditService.log(req.user?.id, req.user?.username || 'system', 'port:update', 'port', `${device_id}:${port_number}`, detail.join(', '), req.ip);

  res.json({ ok: true });
});

// Keep backward-compat alias
router.put('/:device_id/:port_number/sim', [
  param('device_id').isUUID(),
  param('port_number').isInt({ min: 1 }),
  body('sim_number').isString().trim(),
], (req, res) => {
  const db = getDb();
  db.prepare(`
    INSERT INTO ports (device_id, port_number, sim_number, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(device_id, port_number) DO UPDATE SET sim_number = excluded.sim_number, updated_at = excluded.updated_at
  `).run(req.params.device_id, parseInt(req.params.port_number, 10), req.body.sim_number || null);
  auditService.log(req.user?.id, req.user?.username || 'system', 'port:update', 'port', `${req.params.device_id}:${req.params.port_number}`, `SIM: ${req.body.sim_number || '—'}`, req.ip);
  res.json({ ok: true });
});

module.exports = router;
