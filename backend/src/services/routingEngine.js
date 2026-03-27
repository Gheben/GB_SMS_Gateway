const nodemailer = require('nodemailer');
const { getDb, getSetting } = require('../db/database');

// ── CIDR / hostname helpers for webhook whitelist ──────────────────────────
function _isIp(str) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(str); }
function _ipToInt(ip) { return ip.split('.').reduce((acc, b) => ((acc << 8) | parseInt(b, 10)) >>> 0, 0); }
function _isInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = bits ? (~0 << (32 - parseInt(bits, 10))) >>> 0 : 0xFFFFFFFF;
  return (_ipToInt(ip) & mask) === (_ipToInt(range) & mask);
}
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/encryption');

/**
 * RoutingEngine
 *
 * When an inbound SMS arrives, evaluates routing_rules (ordered by priority DESC)
 * and dispatches emails to the configured rule_targets.
 *
 * Rule match types:
 *   'any'            — always matches
 *   'sender'         — exact match on sender number
 *   'sender_regex'   — regex match on sender
 *   'content'        — case-insensitive substring match
 *   'content_regex'  — regex match on content
 *   'device'         — matches only messages from a specific device_id
 */
class RoutingEngine {
  constructor() {
    this._transporter = null;
  }

  _getTransporter() {
    if (!this._transporter) {
      const host      = getSetting('SMTP_HOST');
      const port      = parseInt(getSetting('SMTP_PORT', '587'), 10);
      const secure    = getSetting('SMTP_SECURE', 'false') === 'true';
      const ignoreTLS = getSetting('SMTP_IGNORE_TLS', 'false') === 'true';
      const user      = getSetting('SMTP_USER');
      const pass      = decrypt(getSetting('SMTP_PASS'));
      this._transporter = nodemailer.createTransport({
        host, port, secure, ignoreTLS,
        auth: user ? { user, pass } : undefined,
      });
    }
    return this._transporter;
  }

  /** Call after SMTP config changes to force reconnect */
  resetTransporter() {
    this._transporter = null;
  }

  /**
   * Process an incoming SMS through the rule engine.
   * @param {{ deviceId, messageId, sender, content, port, recvtime, deviceName }} sms
   */
  async process(sms) {
    const db = getDb();
    const rules = db.prepare(`
      SELECT r.*, GROUP_CONCAT(t.email, ',') as emails
      FROM routing_rules r
      LEFT JOIN rule_targets t ON t.rule_id = r.id
      WHERE r.enabled = 1
      GROUP BY r.id
      ORDER BY r.priority DESC
    `).all();

    for (const rule of rules) {
      if (!this._matches(rule, sms)) continue;

      // Always record the rule match for message visibility (inbox), regardless of targets
      try {
        db.prepare(`
          INSERT OR IGNORE INTO message_rule_matches (message_id, rule_id)
          VALUES (?, ?)
        `).run(sms.messageId, rule.id);
      } catch (err) {
        logger.warn(`Could not record rule match: ${err.message}`);
      }

      const emails = rule.emails ? rule.emails.split(',').filter(Boolean) : [];
      if (emails.length === 0 && !rule.sms_targets && !rule.webhook_url) {
        logger.warn(`Rule "${rule.name}" matched but has no targets.`);
      }

      for (const email of emails) {
        await this._dispatch(sms, rule, email);
      }

      // SMS forwarding — send back via same port that received the SMS
      const smsTargets = JSON.parse(rule.sms_targets || '[]');
      for (const phone of smsTargets) {
        await this._dispatchSms(sms, rule, phone);
      }

      // Webhook forwarding
      await this._dispatchWebhook(sms, rule);

      if (rule.stop_on_match) {
        logger.info(`Rule "${rule.name}" matched with stop_on_match — halting chain.`);
        break;
      }
    }
  }

  _matches(rule, sms) {
    const db = getDb();
    const conditions = db.prepare(
      'SELECT * FROM rule_conditions WHERE rule_id=? ORDER BY sort_order'
    ).all(rule.id);

    if (conditions.length === 0) {
      // Fallback legacy: nessuna condizione → corrisponde sempre
      return true;
    }

    const op = (rule.condition_operator || 'AND').toUpperCase();
    if (op === 'OR') return conditions.some(c => this._evalCondition(c, sms));
    return conditions.every(c => this._evalCondition(c, sms));
  }

  _evalCondition(cond, sms) {
    const val = cond.match_value || '';
    switch (cond.match_type) {
      case 'any':    return true;
      case 'sender': return sms.sender === val;
      case 'sender_regex':
        try { return new RegExp(val, 'i').test(sms.sender || ''); } catch { return false; }
      case 'content':
        return (sms.content || '').toLowerCase().includes(val.toLowerCase());
      case 'content_regex':
        try { return new RegExp(val, 'i').test(sms.content || ''); } catch { return false; }
      case 'device':
        return sms.deviceId === (cond.device_id || val);
      default: return false;
    }
  }

  async _dispatch(sms, rule, email) {
    const db = getDb();
    const dispatchId = uuidv4();
    db.prepare(`
      INSERT INTO dispatches (id, message_id, rule_id, email, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(dispatchId, sms.messageId, rule.id, email);

    try {
      if (!getSetting('SMTP_HOST')) {
        throw new Error('SMTP non configurato. Vai in Impostazioni → SMTP.');
      }

      const recvTime = sms.recvtime || new Date().toISOString();
      const deviceInfo = sms.deviceName ? `${sms.deviceName} (${sms.deviceId})` : sms.deviceId || 'N/D';

      const DEFAULT_SUBJECT = '[SMS Gateway] Nuovo SMS da {{sender}}';
      const subjectTpl = getSetting('EMAIL_SUBJECT') || DEFAULT_SUBJECT;
      const subject = subjectTpl
        .replace(/{{sender}}/g,      sms.sender || 'N/D')
        .replace(/{{device}}/g,       deviceInfo)
        .replace(/{{port}}/g,         String(sms.port || 'N/D'))
        .replace(/{{rule}}/g,         rule.name || '')
        .replace(/{{received_at}}/g,  recvTime);

      const from = getSetting('SMTP_FROM') || 'smsgateway@local';

      // Usa template personalizzato se presente, altrimenti fallback predefinito
      const DEFAULT_TEMPLATE = `<table style="font-family:Arial,sans-serif;max-width:600px;border-collapse:collapse">
  <tr><td colspan="2" style="background:#1d4ed8;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">Nuovo SMS ricevuto — GB SMS Gateway</td></tr>
  <tr><td style="padding:10px 20px;font-weight:bold;color:#555;width:130px">Da</td><td style="padding:10px 20px">{{sender}}</td></tr>
  <tr style="background:#f9fafb"><td style="padding:10px 20px;font-weight:bold;color:#555">Dispositivo</td><td style="padding:10px 20px">{{device}}</td></tr>
  <tr><td style="padding:10px 20px;font-weight:bold;color:#555">Porta SIM</td><td style="padding:10px 20px">{{port}}</td></tr>
  <tr style="background:#f9fafb"><td style="padding:10px 20px;font-weight:bold;color:#555">Ricevuto</td><td style="padding:10px 20px">{{received_at}}</td></tr>
  <tr><td style="padding:10px 20px;font-weight:bold;color:#555">Regola</td><td style="padding:10px 20px">{{rule}}</td></tr>
  <tr style="background:#eef2ff"><td colspan="2" style="padding:16px 20px;font-size:15px;white-space:pre-wrap;word-break:break-word">{{content}}</td></tr>
  <tr><td colspan="2" style="padding:10px 20px;font-size:11px;color:#aaa">GB SMS Gateway · {{timestamp}}</td></tr>
</table>`;

      const tpl = getSetting('EMAIL_TEMPLATE') || DEFAULT_TEMPLATE;
      const html = tpl
        .replace(/{{sender}}/g,      sms.sender || 'N/D')
        .replace(/{{device}}/g,       deviceInfo)
        .replace(/{{port}}/g,         String(sms.port || 'N/D'))
        .replace(/{{received_at}}/g,  recvTime)
        .replace(/{{rule}}/g,         rule.name)
        .replace(/{{content}}/g,      sms.content || '')
        .replace(/{{timestamp}}/g,    new Date().toLocaleString('it-IT'))
        .replace(/{{email}}/g,        email);

      await this._getTransporter().sendMail({
        from,
        to: email,
        subject,
        html,
      });

      db.prepare(`UPDATE dispatches SET status='sent', sent_at=datetime('now') WHERE id=?`).run(dispatchId);
      logger.info(`Email dispatched → ${email} (rule: ${rule.name})`);
    } catch (err) {
      db.prepare(`UPDATE dispatches SET status='failed', error=? WHERE id=?`).run(err.message, dispatchId);
      logger.error(`Email dispatch failed → ${email}: ${err.message}`);
    }
  }

  async _dispatchSms(sms, rule, phone) {
    const db = getDb();
    const dispatchId = uuidv4();
    db.prepare(`
      INSERT INTO dispatches (id, message_id, rule_id, email, status, action_type)
      VALUES (?, ?, ?, ?, 'pending', 'sms')
    `).run(dispatchId, sms.messageId, rule.id, phone);

    try {
      // Lazy require to avoid circular dependency with deviceManager
      const deviceManager = require('./deviceManager');
      const connector = deviceManager.get(sms.deviceId);
      if (!connector || !connector.connected) {
        const errMsg = `Device ${sms.deviceId} not connected`;
        db.prepare(`UPDATE dispatches SET status='failed', error=? WHERE id=?`).run(errMsg, dispatchId);
        logger.warn(`SMS forward skipped: device ${sms.deviceId} not connected (rule: ${rule.name})`);
        return;
      }
      connector.sendSMS(sms.port, phone, sms.content);
      db.prepare(`UPDATE dispatches SET status='sent', sent_at=datetime('now') WHERE id=?`).run(dispatchId);
      logger.info(`SMS forwarded → ${phone} via port ${sms.port} (rule: ${rule.name})`);
    } catch (err) {
      db.prepare(`UPDATE dispatches SET status='failed', error=? WHERE id=?`).run(err.message, dispatchId);
      logger.error(`SMS forward failed → ${phone}: ${err.message}`);
    }
  }

  _isWebhookAllowed(url) {
    const allowedHostsRaw = getSetting('WEBHOOK_ALLOWED_HOSTS') || '';
    if (!allowedHostsRaw.trim()) return false; // empty whitelist = deny all
    let hostname;
    try { hostname = new URL(url).hostname; } catch { return false; }
    const entries = allowedHostsRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (entry.includes('/')) {
        // CIDR range
        if (_isIp(hostname) && _isInCidr(hostname, entry)) return true;
      } else if (entry.startsWith('*.')) {
        // Wildcard subdomain
        if (hostname.endsWith(entry.slice(1))) return true;
      } else {
        // Exact hostname
        if (hostname === entry) return true;
      }
    }
    return false;
  }

  async _dispatchWebhook(sms, rule) {
    if (!rule.webhook_url) return;
    const db = getDb();
    const dispatchId = uuidv4();

    if (!this._isWebhookAllowed(rule.webhook_url)) {
      db.prepare(`
        INSERT INTO dispatches (id, message_id, rule_id, email, status, action_type, error)
        VALUES (?, ?, ?, ?, 'failed', 'webhook', 'URL not in allowed hosts whitelist')
      `).run(dispatchId, sms.messageId, rule.id, rule.webhook_url);
      logger.warn(`Webhook blocked (not in whitelist): ${rule.webhook_url} (rule: ${rule.name})`);
      return;
    }

    db.prepare(`
      INSERT INTO dispatches (id, message_id, rule_id, email, status, action_type)
      VALUES (?, ?, ?, ?, 'pending', 'webhook')
    `).run(dispatchId, sms.messageId, rule.id, rule.webhook_url);

    const method = (rule.webhook_method || 'POST').toUpperCase();
    const payload = {
      sender:      sms.sender,
      content:     sms.content,
      device_id:   sms.deviceId,
      port:        sms.port,
      received_at: sms.recvtime,
      rule_id:     rule.id,
      rule_name:   rule.name,
    };
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    const url = method === 'GET'
      ? `${rule.webhook_url}?${new URLSearchParams(payload)}`
      : rule.webhook_url;
    if (method !== 'GET') options.body = JSON.stringify(payload);
    try {
      const resp = await fetch(url, options);
      db.prepare(`UPDATE dispatches SET status='sent', sent_at=datetime('now') WHERE id=?`).run(dispatchId);
      logger.info(`Webhook → ${rule.webhook_url} → HTTP ${resp.status} (rule: ${rule.name})`);
    } catch (err) {
      db.prepare(`UPDATE dispatches SET status='failed', error=? WHERE id=?`).run(err.message, dispatchId);
      logger.error(`Webhook failed → ${rule.webhook_url}: ${err.message} (rule: ${rule.name})`);
    }
  }
}

module.exports = new RoutingEngine();
