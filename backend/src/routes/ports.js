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

// PUT /api/ports/:device_id/:port_number/info — salva sim_number e/o carrier della porta
router.put('/:device_id/:port_number/info', [
  param('device_id').isUUID(),
  param('port_number').isInt({ min: 1 }),
  body('sim_number').optional().isString().trim(),
  body('operator').optional().isString().trim(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const db = getDb();
  const { sim_number, operator } = req.body;
  db.prepare(`
    INSERT INTO ports (device_id, port_number, sim_number, operator, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(device_id, port_number) DO UPDATE SET
      sim_number = COALESCE(excluded.sim_number, sim_number),
      operator   = COALESCE(excluded.operator, operator),
      updated_at = excluded.updated_at
  `).run(req.params.device_id, parseInt(req.params.port_number, 10),
    sim_number !== undefined ? (sim_number || null) : null,
    operator   !== undefined ? (operator   || null) : null);
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
