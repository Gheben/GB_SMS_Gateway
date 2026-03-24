const { Router } = require('express');
const { query, validationResult } = require('express-validator');
const { requireSuperAdmin } = require('../middleware/authMiddleware');
const auditService = require('../services/auditService');

const router = Router();

// Audit log: solo superadmin
router.use(requireSuperAdmin);

// GET /api/audit — lista audit log (paginato, filtrabile)
router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('username').optional().isString().trim().escape(),
  query('action').optional().isString().trim().escape(),
  query('resource_type').optional().isString().trim().escape(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const result = auditService.getAll({
    page: req.query.page || 1,
    limit: req.query.limit || 50,
    username: req.query.username || undefined,
    action: req.query.action || undefined,
    resourceType: req.query.resource_type || undefined,
    from: req.query.from || undefined,
    to: req.query.to || undefined,
  });
  res.json(result);
});

// DELETE /api/audit — purge voci più vecchie di N giorni (solo superadmin)
router.delete('/', [
  query('days').isInt({ min: 1, max: 3650 }).toInt(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo il SuperAdmin può eliminare il log di audit' });
  }
  const removed = auditService.purgeOlderThan(req.query.days);
  res.json({ ok: true, removed });
});

module.exports = router;
