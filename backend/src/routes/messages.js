const { Router } = require('express');
const { body, query, param, validationResult } = require('express-validator');
const messageService = require('../services/messageService');
const deviceManager = require('../services/deviceManager');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/authMiddleware');

const router = Router();

// ── Balanced SIM round-robin ──────────────────────────────────────────────────

/**
 * Returns the next connected balanced SIM port using a "least-sent this month"
 * algorithm: always picks the port with the fewest outbound SMS in the current
 * month, so any imbalance (e.g. from manual sends or restarts) self-corrects.
 * Ties are broken by stable ordering (device_id, port_number) to avoid
 * oscillation. Returns null if no balanced port is connected.
 */
/** Returns current local year-month string "YYYY-MM" respecting the process TZ. */
function localYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function pickBalancedPort(allowedPorts = []) {
  const db = getDb();
  const ym = localYearMonth();

  // Count sent this month directly from messages table — includes ALL historical sends,
  // not just those tracked since port_monthly_stats was introduced.
  // Uses datetime(created_at, 'localtime') to respect the TZ env variable (Linux/Docker).
  const ports = db.prepare(`
    WITH monthly_counts AS (
      SELECT device_id, port, COUNT(*) AS cnt
      FROM messages
      WHERE direction = 'outbound'
        AND strftime('%Y-%m', datetime(created_at, 'localtime')) = ?
      GROUP BY device_id, port
    )
    SELECT p.device_id, p.port_number, p.monthly_limit,
           COALESCE(mc.cnt, 0) AS sent_count
    FROM ports p
    JOIN devices d ON d.id = p.device_id
    LEFT JOIN monthly_counts mc ON mc.device_id = p.device_id AND mc.port = p.port_number
    WHERE p.balanced = 1 AND d.enabled = 1
      AND (p.monthly_limit = 0 OR COALESCE(mc.cnt, 0) < p.monthly_limit)
    ORDER BY
      CASE WHEN p.monthly_limit > 0
           THEN CAST(COALESCE(mc.cnt, 0) AS REAL) / p.monthly_limit
           ELSE CAST(COALESCE(mc.cnt, 0) AS REAL)
      END ASC,
      p.device_id, p.port_number
  `).all(ym).filter(p => {
    // Enforce allowed_ports restriction for non-admin users
    if (allowedPorts.length > 0) {
      const permitted = allowedPorts.some(ap =>
        String(ap.device_id) === String(p.device_id) && Number(ap.port_number) === p.port_number
      );
      if (!permitted) return false;
    }
    const conn = deviceManager.get(p.device_id);
    return conn && conn.connected;
  });

  if (!ports.length) return null;
  // Pick the port with the lowest usage ratio (first after ORDER BY)
  return ports[0];
}

/**
 * Increments the monthly SMS counter for a given port.
 */
function incrementMonthlyStat(deviceId, portNumber) {
  const db = getDb();
  const ym = localYearMonth();
  db.prepare(`
    INSERT INTO port_monthly_stats (device_id, port_number, year_month, sent_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(device_id, port_number, year_month) DO UPDATE SET sent_count = sent_count + 1
  `).run(deviceId, portNumber, ym);
}

// GET /api/messages
router.get('/', [
  query('direction').optional().isIn(['inbound', 'outbound']),
  query('device_id').optional().isUUID(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('search').optional().isString().trim().escape(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const result = messageService.getAll({
    direction: req.query.direction,
    deviceId: req.query.device_id,
    page: req.query.page || 1,
    limit: req.query.limit || 50,
    search: req.query.search,
    userRole: req.user?.role,
    userGroups: req.user?.groups,
    userId: req.user?.id,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
});

// GET /api/messages/stats
router.get('/stats', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(messageService.getStats({
    userRole:   req.user?.role,
    userGroups: req.user?.groups,
    userId:     req.user?.id,
  }));
});

// GET /api/messages/:id
router.get('/:id', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const msg = messageService.getById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  res.json(msg);
});

// POST /api/messages/send
router.post('/send', [
  body('device_id').optional({ nullable: true }).isUUID().withMessage('device_id must be a valid UUID'),
  body('port').custom(val => {
    if (val === 'auto') return true;
    const n = Number(val);
    if (Number.isInteger(n) && n >= 1 && n <= 16) return true;
    throw new Error('port must be an integer 1-16 or "auto"');
  }),
  body('recipient').custom(val => {
    // Accept normalized phone numbers: optional +, then only digits, 6–20 chars
    if (typeof val !== 'string' || !/^\+?[\d]{6,20}$/.test(val.replace(/[\s\-\(\)]+/g, '')))
      throw new Error('Invalid recipient phone number (expected digits with optional + prefix)');
    return true;
  }),
  body('message').isString().trim().isLength({ min: 1, max: 1024 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  let { device_id, port, recipient, message } = req.body;
  // Normalize recipient: strip spaces, dashes, parens (consistent with frontend normalization)
  recipient = String(recipient).replace(/[\s\-\(\)]+/g, '');

  if (port === 'auto') {
    // For non-admin users, pass their allowed_ports so balanced routing respects permissions
    const isAdmin = req.user.role === 'superadmin' || req.user.role === 'admin';
    const allowedPorts = isAdmin ? [] : (req.user.allowed_ports || []);
    const chosen = pickBalancedPort(allowedPorts);
    if (!chosen) return res.status(503).json({ error: 'No balanced SIM ports available or connected. Configure balanced ports in Settings → Devices.' });
    device_id = chosen.device_id;
    port = chosen.port_number;
  } else {
    port = parseInt(port, 10);
    if (!device_id) return res.status(400).json({ error: 'device_id is required when port is not "auto"' });

    // Enforce monthly_limit for manually selected ports — count directly from messages
    // so that historical sends (before port_monthly_stats was introduced) are included.
    const db = getDb();
    const ym = localYearMonth();
    const portRow = db.prepare(`
      SELECT p.monthly_limit,
             COALESCE((
               SELECT COUNT(*) FROM messages m
               WHERE m.device_id = p.device_id AND m.port = p.port_number
                 AND m.direction = 'outbound'
                 AND strftime('%Y-%m', datetime(m.created_at, 'localtime')) = ?
             ), 0) AS sent_count
      FROM ports p
      WHERE p.device_id = ? AND p.port_number = ?
    `).get(ym, device_id, port);
    if (portRow && portRow.monthly_limit > 0 && portRow.sent_count >= portRow.monthly_limit) {
      return res.status(429).json({ error: `Monthly limit reached for port ${port} (${portRow.sent_count}/${portRow.monthly_limit}). Wait until next month or choose another port.` });
    }
  }

  const connector = deviceManager.get(device_id);
  if (!connector || !connector.connected) {
    return res.status(503).json({ error: 'Device not connected' });
  }

  try {
    const localId = messageService.saveOutbound({ deviceId: device_id, port, recipient, content: message, sentByUserId: req.user.id });
    const gsmId = connector.sendSMS(port, recipient, message);
    messageService.setGsmId(localId, gsmId);
    incrementMonthlyStat(device_id, port);
    logger.info(`SMS send request: localId=${localId} gsmId=${gsmId} device=${device_id} port=${port}`);
    auditService.log(req.user.id, req.user.username, 'sms:send', 'message', localId, `A: ${recipient} | Porta: ${port} | Device: ${device_id}`, req.ip);
    res.status(202).json({ id: localId, gsmId, status: 'pending' });
  } catch (err) {
    logger.error(`Send SMS error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/messages — bulk delete (admin + superadmin only)
router.delete('/', requireAdmin, [
  body('ids').isArray({ min: 1 }).withMessage('ids must be a non-empty array'),
  body('ids.*').isUUID().withMessage('each id must be a valid UUID'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { ids } = req.body;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');

  // Delete cascade-dependent rows first
  db.prepare(`DELETE FROM dispatches WHERE message_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM message_rule_matches WHERE message_id IN (${placeholders})`).run(...ids);
  const result = db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);

  logger.info(`[messages] Bulk delete: ${result.changes} messages deleted by user ${req.user.username}`);
  auditService.log(req.user.id, req.user.username, 'messages:bulk_delete', 'messages', null,
    `Deleted ${result.changes} messages (ids: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '...' : ''})`, req.ip);
  res.json({ deleted: result.changes });
});

module.exports = router;
