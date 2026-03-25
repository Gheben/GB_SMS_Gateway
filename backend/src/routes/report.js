const { Router } = require('express');
const { query, validationResult } = require('express-validator');
const { getDb } = require('../db/database');
const messageService = require('../services/messageService');

const router = Router();

// GET /api/report?days=30
router.get('/', [
  query('days').optional().isInt({ min: 1, max: 365 }).toInt(),
], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const days = req.query.days || 30;
  const db = getDb();

  // Calcola regole visibili per questo utente (null = admin, vede tutto)
  const visibleRuleIds = messageService._getVisibleRuleIds({
    userRole:   req.user?.role,
    userGroups: req.user?.groups,
    userId:     req.user?.id,
  });
  const isFiltered = visibleRuleIds !== null;
  const hasRules   = isFiltered && visibleRuleIds.length > 0;
  const ph         = hasRules ? visibleRuleIds.map(() => '?').join(',') : null;

  // Filtri SQL riutilizzabili
  // Per messaggi: deve esistere un dispatch O un match da una regola visibile
  const msgFilter  = hasRules
    ? `(EXISTS (SELECT 1 FROM dispatches dp WHERE dp.message_id = m.id AND dp.rule_id IN (${ph}))` +
      ` OR EXISTS (SELECT 1 FROM message_rule_matches mrm WHERE mrm.message_id = m.id AND mrm.rule_id IN (${ph})))`
    : '1=0';
  // Per dispatches: la regola deve essere visibile
  const dispFilter = hasRules ? `d.rule_id IN (${ph})` : '1=0';

  // Se utente senza regole visibili, restituisci tutto vuoto
  if (isFiltered && !hasRules) {
    return res.json({
      days,
      totals: { total_inbound: 0, total_outbound: 0, total: 0, sent: 0, failed: 0 },
      smsByDay: [], smsByDevice: [], dispatchByRule: [], dispatchLog: [],
    });
  }

  // SMS per giorno
  const smsByDay = isFiltered
    ? db.prepare(`
        SELECT date(m.created_at) as day,
               SUM(CASE WHEN m.direction='inbound'  THEN 1 ELSE 0 END) as inbound,
               SUM(CASE WHEN m.direction='outbound' THEN 1 ELSE 0 END) as outbound
        FROM messages m
        WHERE m.created_at >= datetime('now', ?) AND ${msgFilter}
        GROUP BY day ORDER BY day ASC
      `).all(`-${days} days`, ...visibleRuleIds, ...visibleRuleIds)
    : db.prepare(`
        SELECT date(created_at) as day,
               SUM(CASE WHEN direction='inbound'  THEN 1 ELSE 0 END) as inbound,
               SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) as outbound
        FROM messages
        WHERE created_at >= datetime('now', ?)
        GROUP BY day ORDER BY day ASC
      `).all(`-${days} days`);

  // SMS per dispositivo
  const smsByDevice = isFiltered
    ? db.prepare(`
        SELECT d.name as device, COUNT(*) as total,
               SUM(CASE WHEN m.direction='inbound'  THEN 1 ELSE 0 END) as inbound,
               SUM(CASE WHEN m.direction='outbound' THEN 1 ELSE 0 END) as outbound
        FROM messages m
        LEFT JOIN devices d ON d.id = m.device_id
        WHERE m.created_at >= datetime('now', ?) AND ${msgFilter}
        GROUP BY m.device_id ORDER BY total DESC
      `).all(`-${days} days`, ...visibleRuleIds, ...visibleRuleIds)
    : db.prepare(`
        SELECT d.name as device, COUNT(*) as total,
               SUM(CASE WHEN m.direction='inbound'  THEN 1 ELSE 0 END) as inbound,
               SUM(CASE WHEN m.direction='outbound' THEN 1 ELSE 0 END) as outbound
        FROM messages m
        LEFT JOIN devices d ON d.id = m.device_id
        WHERE m.created_at >= datetime('now', ?)
        GROUP BY m.device_id ORDER BY total DESC
      `).all(`-${days} days`);

  // Dispatch per regola
  const dispatchByRule = isFiltered
    ? db.prepare(`
        SELECT r.name as rule, COUNT(*) as dispatches,
               SUM(CASE WHEN d.status='sent' THEN 1 ELSE 0 END) as sent,
               SUM(CASE WHEN d.status='failed' THEN 1 ELSE 0 END) as failed
        FROM dispatches d
        LEFT JOIN routing_rules r ON r.id = d.rule_id
        WHERE d.created_at >= datetime('now', ?) AND ${dispFilter}
        GROUP BY d.rule_id ORDER BY dispatches DESC
      `).all(`-${days} days`, ...visibleRuleIds)
    : db.prepare(`
        SELECT r.name as rule, COUNT(*) as dispatches,
               SUM(CASE WHEN d.status='sent' THEN 1 ELSE 0 END) as sent,
               SUM(CASE WHEN d.status='failed' THEN 1 ELSE 0 END) as failed
        FROM dispatches d
        LEFT JOIN routing_rules r ON r.id = d.rule_id
        WHERE d.created_at >= datetime('now', ?)
        GROUP BY d.rule_id ORDER BY dispatches DESC
      `).all(`-${days} days`);

  // Log dettagliato dispatches (ultimi 200)
  const dispatchLog = isFiltered
    ? db.prepare(`
        SELECT d.id, d.message_id, d.status, d.email, d.error, d.sent_at, d.created_at,
               r.name AS rule_name, m.sender, m.content, m.received_at, dev.name AS device_name
        FROM dispatches d
        LEFT JOIN messages m      ON m.id  = d.message_id
        LEFT JOIN routing_rules r ON r.id  = d.rule_id
        LEFT JOIN devices dev     ON dev.id = m.device_id
        WHERE ${dispFilter}
        ORDER BY d.created_at DESC LIMIT 200
      `).all(...visibleRuleIds)
    : db.prepare(`
        SELECT d.id, d.message_id, d.status, d.email, d.error, d.sent_at, d.created_at,
               r.name AS rule_name, m.sender, m.content, m.received_at, dev.name AS device_name
        FROM dispatches d
        LEFT JOIN messages m      ON m.id  = d.message_id
        LEFT JOIN routing_rules r ON r.id  = d.rule_id
        LEFT JOIN devices dev     ON dev.id = m.device_id
        ORDER BY d.created_at DESC LIMIT 200
      `).all();

  // Totali
  const totals = isFiltered
    ? db.prepare(`
        SELECT
          SUM(CASE WHEN direction='inbound'  THEN 1 ELSE 0 END) as total_inbound,
          SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) as total_outbound
        FROM messages m
        WHERE created_at >= datetime('now', ?) AND ${msgFilter}
      `).get(`-${days} days`, ...visibleRuleIds, ...visibleRuleIds)
    : db.prepare(`
        SELECT
          SUM(CASE WHEN direction='inbound'  THEN 1 ELSE 0 END) as total_inbound,
          SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) as total_outbound
        FROM messages
        WHERE created_at >= datetime('now', ?)
      `).get(`-${days} days`);

  const dispatchTotals = isFiltered
    ? db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status='sent'   THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
        FROM dispatches d
        WHERE created_at >= datetime('now', ?) AND ${dispFilter}
      `).get(`-${days} days`, ...visibleRuleIds)
    : db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status='sent'   THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
        FROM dispatches
        WHERE created_at >= datetime('now', ?)
      `).get(`-${days} days`);

  const safeTotals = {
    total_inbound:  totals?.total_inbound  ?? 0,
    total_outbound: totals?.total_outbound ?? 0,
    total:   dispatchTotals?.total   ?? 0,
    sent:    dispatchTotals?.sent    ?? 0,
    failed:  dispatchTotals?.failed  ?? 0,
  };

  res.json({
    days,
    totals: safeTotals,
    smsByDay,
    smsByDevice,
    dispatchByRule,
    dispatchLog,
  });
});

module.exports = router;
