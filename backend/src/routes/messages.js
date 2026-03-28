const { Router } = require('express');
const { body, query, param, validationResult } = require('express-validator');
const messageService = require('../services/messageService');
const deviceManager = require('../services/deviceManager');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');
const { getDb } = require('../db/database');

const router = Router();

// ── Balanced SIM round-robin ──────────────────────────────────────────────────

/**
 * Returns the next connected balanced SIM port using a "least-sent this month"
 * algorithm: always picks the port with the fewest outbound SMS in the current
 * month, so any imbalance (e.g. from manual sends or restarts) self-corrects.
 * Ties are broken by stable ordering (device_id, port_number) to avoid
 * oscillation. Returns null if no balanced port is connected.
 */
function pickBalancedPort() {
  const db = getDb();
  const ym = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  // Fetch balanced+enabled ports with their monthly sent count and limit
  // Ports that have reached their monthly_limit are excluded.
  // Ordering: ratio = sent_count / monthly_limit (if limit set), else raw sent_count.
  // This way a SIM with limit=200@50sent (25%) is preferred over limit=100@40sent (40%).
  const ports = db.prepare(`
    SELECT p.device_id, p.port_number, p.monthly_limit,
           COALESCE(s.sent_count, 0) AS sent_count
    FROM ports p
    JOIN devices d ON d.id = p.device_id
    LEFT JOIN port_monthly_stats s
      ON s.device_id = p.device_id
      AND s.port_number = p.port_number
      AND s.year_month = ?
    WHERE p.balanced = 1 AND d.enabled = 1
      AND (p.monthly_limit = 0 OR COALESCE(s.sent_count, 0) < p.monthly_limit)
    ORDER BY
      CASE WHEN p.monthly_limit > 0
           THEN CAST(COALESCE(s.sent_count, 0) AS REAL) / p.monthly_limit
           ELSE CAST(COALESCE(s.sent_count, 0) AS REAL)
      END ASC,
      p.device_id, p.port_number
  `).all(ym).filter(p => {
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
  const ym = new Date().toISOString().slice(0, 7); // "YYYY-MM"
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
  body('recipient').isMobilePhone('any').withMessage('Invalid recipient phone number'),
  body('message').isString().trim().isLength({ min: 1, max: 1024 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  let { device_id, port, recipient, message } = req.body;

  if (port === 'auto') {
    const chosen = pickBalancedPort();
    if (!chosen) return res.status(503).json({ error: 'No balanced SIM ports available or connected. Configure balanced ports in Settings → Devices.' });
    device_id = chosen.device_id;
    port = chosen.port_number;
  } else {
    port = parseInt(port, 10);
    if (!device_id) return res.status(400).json({ error: 'device_id is required when port is not "auto"' });
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

module.exports = router;
