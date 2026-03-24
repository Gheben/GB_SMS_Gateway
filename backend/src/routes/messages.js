const { Router } = require('express');
const { body, query, param, validationResult } = require('express-validator');
const messageService = require('../services/messageService');
const deviceManager = require('../services/deviceManager');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');

const router = Router();

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
  res.json(result);
});

// GET /api/messages/stats
router.get('/stats', (req, res) => {
  res.json(messageService.getStats());
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
  body('device_id').isUUID().withMessage('device_id (UUID) is required'),
  body('port').isInt({ min: 1, max: 16 }).withMessage('port must be between 1 and 16'),
  body('recipient').isMobilePhone('any').withMessage('Invalid recipient phone number'),
  body('message').isString().trim().isLength({ min: 1, max: 1024 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { device_id, port, recipient, message } = req.body;
  const connector = deviceManager.get(device_id);
  if (!connector || !connector.connected) {
    return res.status(503).json({ error: 'Device not connected' });
  }

  try {
    const localId = messageService.saveOutbound({ deviceId: device_id, port, recipient, content: message });
    const gsmId = connector.sendSMS(port, recipient, message);
    messageService.setGsmId(localId, gsmId);
    logger.info(`SMS send request: localId=${localId} gsmId=${gsmId} device=${device_id}`);
    auditService.log(req.user.id, req.user.username, 'sms:send', 'message', localId, `A: ${recipient} | Porta: ${port} | Device: ${device_id}`, req.ip);
    res.status(202).json({ id: localId, gsmId, status: 'pending' });
  } catch (err) {
    logger.error(`Send SMS error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
