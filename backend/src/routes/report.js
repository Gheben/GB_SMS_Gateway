const { Router } = require('express');
const { query, validationResult } = require('express-validator');
const { getDb } = require('../db/database');

const router = Router();

// GET /api/report?days=30
router.get('/', [
  query('days').optional().isInt({ min: 1, max: 365 }).toInt(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const days = req.query.days || 30;
  const db = getDb();

  // SMS per giorno (ultimi N giorni)
  const smsByDay = db.prepare(`
    SELECT date(created_at) as day,
           SUM(CASE WHEN direction='inbound'  THEN 1 ELSE 0 END) as inbound,
           SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) as outbound
    FROM messages
    WHERE created_at >= datetime('now', ?)
    GROUP BY day
    ORDER BY day ASC
  `).all(`-${days} days`);

  // SMS per dispositivo
  const smsByDevice = db.prepare(`
    SELECT d.name as device, COUNT(*) as total,
           SUM(CASE WHEN m.direction='inbound'  THEN 1 ELSE 0 END) as inbound,
           SUM(CASE WHEN m.direction='outbound' THEN 1 ELSE 0 END) as outbound
    FROM messages m
    LEFT JOIN devices d ON d.id = m.device_id
    WHERE m.created_at >= datetime('now', ?)
    GROUP BY m.device_id
    ORDER BY total DESC
  `).all(`-${days} days`);

  // Dispatch per regola
  const dispatchByRule = db.prepare(`
    SELECT r.name as rule, COUNT(*) as dispatches,
           SUM(CASE WHEN d.status='sent' THEN 1 ELSE 0 END) as sent,
           SUM(CASE WHEN d.status='failed' THEN 1 ELSE 0 END) as failed
    FROM dispatches d
    LEFT JOIN routing_rules r ON r.id = d.rule_id
    WHERE d.created_at >= datetime('now', ?)
    GROUP BY d.rule_id
    ORDER BY dispatches DESC
  `).all(`-${days} days`);

  // Log dettagliato dispatches (ultimi 200)
  const dispatchLog = db.prepare(`
    SELECT
      d.id,
      d.message_id,
      d.status,
      d.email,
      d.error,
      d.sent_at,
      d.created_at,
      r.name   AS rule_name,
      m.sender,
      m.content,
      m.received_at,
      dev.name AS device_name
    FROM dispatches d
    LEFT JOIN messages m      ON m.id  = d.message_id
    LEFT JOIN routing_rules r ON r.id  = d.rule_id
    LEFT JOIN devices dev     ON dev.id = m.device_id
    ORDER BY d.created_at DESC
    LIMIT 200
  `).all();

  // Totali globali
  const totals = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE direction='inbound')  as total_inbound,
      COUNT(*) FILTER (WHERE direction='outbound') as total_outbound
    FROM messages
    WHERE created_at >= datetime('now', ?)
  `).get(`-${days} days`);

  const dispatchTotals = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status='sent')   as sent,
      COUNT(*) FILTER (WHERE status='failed') as failed
    FROM dispatches
    WHERE created_at >= datetime('now', ?)
  `).get(`-${days} days`);

  res.json({
    days,
    totals: { ...totals, ...dispatchTotals },
    smsByDay,
    smsByDevice,
    dispatchByRule,
    dispatchLog,
  });
});

module.exports = router;
