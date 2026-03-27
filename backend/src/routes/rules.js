const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const routingEngine = require('../services/routingEngine');
const auditService = require('../services/auditService');

const router = Router();

const MATCH_TYPES = ['any', 'sender', 'sender_regex', 'content', 'content_regex', 'device'];
const COND_OPERATORS = ['AND', 'OR'];

function sanitize(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
}

function getRuleFull(db, id) {
  const rule = db.prepare('SELECT * FROM routing_rules WHERE id=?').get(id);
  if (!rule) return null;
  const targets = db.prepare('SELECT id, email FROM rule_targets WHERE rule_id=? ORDER BY rowid').all(id);
  const conditions = db.prepare('SELECT * FROM rule_conditions WHERE rule_id=? ORDER BY sort_order').all(id);
  return {
    ...rule,
    targets,
    conditions,
    allowed_groups: JSON.parse(rule.allowed_groups || '[]'),
    allowed_local_groups: JSON.parse(rule.allowed_local_groups || '[]'),
    sms_targets: JSON.parse(rule.sms_targets || '[]'),
    webhook_url: rule.webhook_url || '',
    webhook_method: rule.webhook_method || 'POST',
  };
}

function insertConditions(db, ruleId, conditions) {
  const stmt = db.prepare(
    'INSERT INTO rule_conditions (id, rule_id, match_type, match_value, device_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  conditions.forEach((c, i) => {
    stmt.run(
      uuidv4(), ruleId,
      c.match_type || 'any',
      ['any', 'device'].includes(c.match_type) ? null : (c.match_value || null),
      c.match_type === 'device' ? (c.device_id || null) : null,
      i
    );
  });
}

// GET /api/rules
router.get('/', (req, res) => {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM routing_rules ORDER BY priority DESC, created_at').all();
  res.json(rules.map(r => getRuleFull(db, r.id)));
});

// GET /api/rules/:id
router.get('/:id', [param('id').isUUID()], (req, res) => {
  if (!sanitize(req, res)) return;
  const rule = getRuleFull(getDb(), req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json(rule);
});

// POST /api/rules
router.post('/', [
  body('name').isString().trim().notEmpty(),
  body('enabled').optional().isBoolean().toBoolean(),
  body('priority').optional().isInt().toInt(),
  body('condition_operator').optional().isIn(COND_OPERATORS),
  body('conditions').isArray({ min: 1 }).withMessage('Almeno una condizione richiesta'),
  body('conditions.*.match_type').isIn(MATCH_TYPES),
  body('conditions.*.match_value').optional({ checkFalsy: true }).isString().trim(),
  body('stop_on_match').optional().isBoolean().toBoolean(),
  body('targets').optional().isArray(),
  body('targets.*').optional().isEmail(),
  body('sms_targets').optional().isArray(),
  body('sms_targets.*').optional().isString().trim(),
  body('webhook_url').optional({ checkFalsy: true }).isURL({ require_tld: false }),
  body('webhook_method').optional().isIn(['POST', 'GET', 'PUT']),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const id = uuidv4();
  const { name, enabled = true, priority = 0, condition_operator = 'AND', conditions, stop_on_match = false, targets = [], sms_targets = [], allowed_groups = [], allowed_local_groups = [], webhook_url = null, webhook_method = 'POST' } = req.body;

  db.prepare('BEGIN').run();
  db.prepare(
    'INSERT INTO routing_rules (id, name, enabled, priority, condition_operator, stop_on_match, allowed_groups, allowed_local_groups, sms_targets, webhook_url, webhook_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, enabled ? 1 : 0, priority, condition_operator, stop_on_match ? 1 : 0,
    JSON.stringify(Array.isArray(allowed_groups) ? allowed_groups : []),
    JSON.stringify(Array.isArray(allowed_local_groups) ? allowed_local_groups : []),
    JSON.stringify(Array.isArray(sms_targets) ? sms_targets.filter(Boolean) : []),
    webhook_url || null,
    webhook_method || 'POST');
  insertConditions(db, id, conditions);
  const insTarget = db.prepare('INSERT INTO rule_targets (id, rule_id, email) VALUES (?, ?, ?)');
  for (const email of targets.filter(Boolean)) insTarget.run(uuidv4(), id, email.trim().toLowerCase());
  db.prepare('COMMIT').run();

  auditService.log(req.user?.id, req.user?.username || 'system', 'rule:create', 'rule', id, `Nome: ${name}`, req.ip);
  res.status(201).json(getRuleFull(db, id));
});

// PUT /api/rules/:id
router.put('/:id', [
  param('id').isUUID(),
  body('name').optional().isString().trim().notEmpty(),
  body('enabled').optional().isBoolean().toBoolean(),
  body('priority').optional().isInt().toInt(),
  body('condition_operator').optional().isIn(COND_OPERATORS),
  body('conditions').optional().isArray({ min: 1 }),
  body('conditions.*.match_type').optional().isIn(MATCH_TYPES),
  body('conditions.*.match_value').optional({ checkFalsy: true }).isString().trim(),
  body('stop_on_match').optional().isBoolean().toBoolean(),
  body('targets').optional().isArray(),
  body('targets.*').optional().isEmail(),
  body('sms_targets').optional().isArray(),
  body('sms_targets.*').optional().isString().trim(),
  body('webhook_url').optional({ checkFalsy: true }).isURL({ require_tld: false }),
  body('webhook_method').optional().isIn(['POST', 'GET', 'PUT']),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM routing_rules WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const merged = { ...existing, ...req.body };
  db.prepare('BEGIN').run();
  db.prepare(`
    UPDATE routing_rules
    SET name=?, enabled=?, priority=?, condition_operator=?, stop_on_match=?, allowed_groups=?, allowed_local_groups=?, sms_targets=?, webhook_url=?, webhook_method=?, updated_at=datetime('now')
    WHERE id=?
  `).run(merged.name, merged.enabled ? 1 : 0, merged.priority,
         merged.condition_operator || 'AND', merged.stop_on_match ? 1 : 0,
         JSON.stringify(Array.isArray(req.body.allowed_groups) ? req.body.allowed_groups : JSON.parse(existing.allowed_groups || '[]')),
         JSON.stringify(Array.isArray(req.body.allowed_local_groups) ? req.body.allowed_local_groups : JSON.parse(existing.allowed_local_groups || '[]')),
         JSON.stringify(Array.isArray(req.body.sms_targets) ? req.body.sms_targets.filter(Boolean) : JSON.parse(existing.sms_targets || '[]')),
         req.body.webhook_url || existing.webhook_url || null,
         req.body.webhook_method || existing.webhook_method || 'POST',
         req.params.id);

  if (req.body.conditions) {
    db.prepare('DELETE FROM rule_conditions WHERE rule_id=?').run(req.params.id);
    insertConditions(db, req.params.id, req.body.conditions);
  }
  if (req.body.targets !== undefined) {
    db.prepare('DELETE FROM rule_targets WHERE rule_id=?').run(req.params.id);
    const insTarget = db.prepare('INSERT INTO rule_targets (id, rule_id, email) VALUES (?, ?, ?)');
    for (const email of (req.body.targets || []).filter(Boolean)) insTarget.run(uuidv4(), req.params.id, email.trim().toLowerCase());
  }
  db.prepare('COMMIT').run();

  auditService.log(req.user?.id, req.user?.username || 'system', 'rule:update', 'rule', req.params.id, `Nome: ${merged.name}`, req.ip);
  res.json(getRuleFull(db, req.params.id));
});

// DELETE /api/rules/:id
router.delete('/:id', [param('id').isUUID()], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT name FROM routing_rules WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM routing_rules WHERE id=?').run(req.params.id);
  if (existing) {
    auditService.log(req.user?.id, req.user?.username || 'system', 'rule:delete', 'rule', req.params.id, `Nome: ${existing.name}`, req.ip);
  }
  res.json({ ok: true });
});

// POST /api/rules/test â€” simula SMS senza salvare nÃ© inviare email
router.post('/test', [
  body('sender').isString().notEmpty(),
  body('content').isString().notEmpty(),
  body('device_id').optional().isString(),
], (req, res) => {
  if (!sanitize(req, res)) return;
  const db = getDb();
  const { sender, content, device_id } = req.body;

  const rules = db.prepare(`
    SELECT r.*, GROUP_CONCAT(t.email, ',') as emails
    FROM routing_rules r
    LEFT JOIN rule_targets t ON t.rule_id = r.id
    WHERE r.enabled = 1
    GROUP BY r.id
    ORDER BY r.priority DESC
  `).all();

  const matched = [];
  for (const rule of rules) {
    if (routingEngine._matches(rule, { sender, content, deviceId: device_id })) {
      matched.push({
        id: rule.id, name: rule.name,
        emails: rule.emails?.split(',').filter(Boolean) || [],
        stop_on_match: !!rule.stop_on_match,
      });
      if (rule.stop_on_match) break;
    }
  }
  res.json({ matched });
});

module.exports = router;
