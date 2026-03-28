const { Router } = require('express');
const { query, body, param, validationResult } = require('express-validator');
const { getDb } = require('../db/database');
const deviceManager = require('../services/deviceManager');

const router = Router();

// GET /api/ports?device_id=xxx
router.get('/', [
  query('device_id').optional().isUUID(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const db = getDb();
  let ports;
  if (req.query.device_id) {
    const conn = deviceManager.get(req.query.device_id);
    if (conn && conn.connected) conn.requestPortStatus();
    ports = db.prepare(`
      SELECT p.*, d.name as device_name FROM ports p
      JOIN devices d ON d.id=p.device_id
      WHERE p.device_id=? ORDER BY p.port_number
    `).all(req.query.device_id);
  } else {
    ports = db.prepare(`
      SELECT p.*, d.name as device_name FROM ports p
      JOIN devices d ON d.id=p.device_id
      ORDER BY d.name, p.port_number
    `).all();
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
           COALESCE(s.sent_count, 0) as sent_count
    FROM ports p
    JOIN devices d ON d.id = p.device_id
    LEFT JOIN port_monthly_stats s
      ON s.device_id = p.device_id
      AND s.port_number = p.port_number
      AND s.year_month = ?
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
  res.json({ ok: true });
});

module.exports = router;
