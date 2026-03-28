const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');

class MessageService {
  saveInbound(smsEvent) {
    const db = getDb();
    const id = uuidv4();
    // Lookup SIM phone number for this port to store as recipient
    const portRow = smsEvent.deviceId && smsEvent.port
      ? db.prepare('SELECT sim_number FROM ports WHERE device_id = ? AND port_number = ?')
          .get(smsEvent.deviceId, smsEvent.port)
      : null;
    const simNumber = portRow?.sim_number || null;
    db.prepare(`
      INSERT INTO messages (id, device_id, direction, port, sender, recipient, content, status, gsm_id, smsc, received_at)
      VALUES (?, ?, 'inbound', ?, ?, ?, ?, 'received', ?, ?, ?)
    `).run(id, smsEvent.deviceId || null, smsEvent.port, smsEvent.sender, simNumber, smsEvent.content, smsEvent.id, smsEvent.smsc, smsEvent.recvtime);
    logger.info(`Inbound SMS saved: id=${id} from=${smsEvent.sender}`);
    return id;
  }

  saveOutbound({ deviceId, port, recipient, content, sentByUserId = null }) {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, device_id, direction, port, recipient, content, status, sent_by_user_id)
      VALUES (?, ?, 'outbound', ?, ?, ?, 'pending', ?)
    `).run(id, deviceId || null, port, recipient, content, sentByUserId);
    return id;
  }

  updateOutboundStatus(gsmId, status, smsc) {
    const db = getDb();
    db.prepare(`
      UPDATE messages SET status = ?, smsc = ?, gsm_id = ?, updated_at = datetime('now')
      WHERE id = (
        SELECT id FROM messages WHERE direction = 'outbound' AND gsm_id = ? LIMIT 1
      )
    `).run(status, smsc, gsmId, gsmId);
  }

  setGsmId(localId, gsmId) {
    const db = getDb();
    db.prepare(`UPDATE messages SET gsm_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(gsmId, localId);
  }

  /** Returns outbound messages still 'pending' for more than 5 minutes (stuck). */
  getPendingStuck() {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM messages
      WHERE direction = 'outbound' AND status = 'pending'
        AND created_at < datetime('now', '-5 minutes')
    `).all();
  }

  incrementRetryCount(id) {
    const db = getDb();
    db.prepare(`UPDATE messages SET retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  }

  markFailed(id) {
    const db = getDb();
    db.prepare(`UPDATE messages SET status = 'failed', updated_at = datetime('now') WHERE id = ?`).run(id);
  }

  /**
   * Returns visible rule IDs for a non-admin user, or null for admins (= no filter).
   * A rule is visible if it has no group restrictions, OR the user belongs to an allowed group.
   */
  _getVisibleRuleIds({ userRole, userGroups, userId } = {}) {
    const isAdmin = userRole === 'superadmin' || userRole === 'admin';
    if (isAdmin) return null;
    const db = getDb();
    const userLocalGroups = userId
      ? db.prepare('SELECT group_id FROM local_group_members WHERE user_id = ?').all(userId).map(r => r.group_id)
      : [];
    const allRules = db.prepare('SELECT id, allowed_groups, allowed_local_groups FROM routing_rules').all();
    return allRules
      .filter(r => {
        const ldapGroups = JSON.parse(r.allowed_groups || '[]');
        const localGroups = JSON.parse(r.allowed_local_groups || '[]');
        if (ldapGroups.length === 0 && localGroups.length === 0) return true;
        const ldapMatch = ldapGroups.length > 0 && (userGroups || []).some(g => ldapGroups.map(x => x.toLowerCase()).includes(g.toLowerCase()));
        const localMatch = localGroups.length > 0 && userLocalGroups.some(gId => localGroups.includes(gId));
        return ldapMatch || localMatch;
      })
      .map(r => r.id);
  }

  getAll({ direction, deviceId, page = 1, limit = 50, search, userRole, userGroups, userId } = {}) {
    const db = getDb();
    const offset = (page - 1) * limit;
    let query = `SELECT m.*, d.name as device_name, p.sim_number as port_sim_number,
       c_s.display_name as sender_name, c_r.display_name as recipient_name
FROM messages m LEFT JOIN devices d ON d.id = m.device_id LEFT JOIN ports p ON p.device_id = m.device_id AND p.port_number = m.port LEFT JOIN contacts c_s ON c_s.phone = m.sender LEFT JOIN contacts c_r ON c_r.phone = m.recipient WHERE 1=1`;
    const params = [];

    if (direction) {
      query += ` AND m.direction = ?`;
      params.push(direction);
    }
    if (deviceId) {
      query += ` AND m.device_id = ?`;
      params.push(deviceId);
    }
    if (search) {
      query += ` AND (m.sender LIKE ? OR m.recipient LIKE ? OR m.content LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const isAdmin = userRole === 'superadmin' || userRole === 'admin';
    if (!isAdmin) {
      const visibleRuleIds = this._getVisibleRuleIds({ userRole, userGroups, userId });
      if (visibleRuleIds !== null) {
        const conditions = [];
        if (visibleRuleIds.length > 0) {
          const placeholders = visibleRuleIds.map(() => '?').join(',');
          conditions.push(`EXISTS (SELECT 1 FROM dispatches dp3 WHERE dp3.message_id = m.id AND dp3.rule_id IN (${placeholders}))`);
          conditions.push(`EXISTS (SELECT 1 FROM message_rule_matches mrm WHERE mrm.message_id = m.id AND mrm.rule_id IN (${placeholders}))`);
          params.push(...visibleRuleIds, ...visibleRuleIds);
        }
        if (userId) {
          conditions.push(`(m.sent_by_user_id = ? AND m.direction = 'outbound')`);
          params.push(userId);
        }
        query += conditions.length > 0 ? ` AND (${conditions.join(' OR ')})` : ` AND 1=0`;
      }
    }

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM (${query})`).get(...params).cnt;
    query += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params);
    return { total, page, limit, data: rows };
  }

  getById(id) {
    const db = getDb();
    const msg = db.prepare(`
      SELECT m.*, d.name as device_name, p.sim_number as port_sim_number,
             c_s.display_name as sender_name, c_r.display_name as recipient_name
      FROM messages m
      LEFT JOIN devices d ON d.id = m.device_id
      LEFT JOIN ports p ON p.device_id = m.device_id AND p.port_number = m.port
      LEFT JOIN contacts c_s ON c_s.phone = m.sender
      LEFT JOIN contacts c_r ON c_r.phone = m.recipient
      WHERE m.id = ?
    `).get(id);
    if (!msg) return null;
    const dispatches = db.prepare(`
      SELECT dp.*, r.name as rule_name
      FROM dispatches dp
      LEFT JOIN routing_rules r ON r.id = dp.rule_id
      WHERE dp.message_id = ?
      ORDER BY dp.created_at
    `).all(id);
    return { ...msg, dispatches };
  }

  getStats({ userRole, userGroups, userId } = {}) {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const visibleRuleIds = this._getVisibleRuleIds({ userRole, userGroups, userId });

    if (visibleRuleIds === null) {
      // Admin: totali globali
      return {
        total_inbound:  db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='inbound'`).get().c,
        total_outbound: db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='outbound'`).get().c,
        sent_today:     db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='outbound' AND date(created_at)=?`).get(today).c,
        received_today: db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='inbound' AND date(created_at)=?`).get(today).c,
        failed:         db.prepare(`SELECT COUNT(*) as c FROM messages WHERE status='failed'`).get().c,
      };
    }

    // Utente: messaggi da regole visibili + propri messaggi inviati direttamente
    const ph = visibleRuleIds.length > 0 ? visibleRuleIds.map(() => '?').join(',') : null;
    const ruleVis = ph
      ? `(EXISTS (SELECT 1 FROM dispatches dp WHERE dp.message_id = m.id AND dp.rule_id IN (${ph})) OR EXISTS (SELECT 1 FROM message_rule_matches mrm WHERE mrm.message_id = m.id AND mrm.rule_id IN (${ph})))`
      : null;
    const ownSent = userId ? `m.sent_by_user_id = ?` : null;
    const outFilter = [ruleVis, ownSent].filter(Boolean).join(' OR ');
    const inFilter  = ruleVis;
    const rp = [...visibleRuleIds, ...visibleRuleIds]; // double for 2 EXISTS placeholders
    const up = userId ? [userId] : [];

    if (!outFilter && !inFilter) {
      return { total_inbound: 0, total_outbound: 0, sent_today: 0, received_today: 0, failed: 0 };
    }
    return {
      total_inbound:  inFilter
        ? db.prepare(`SELECT COUNT(*) as c FROM messages m WHERE direction='inbound' AND (${inFilter})`).get(...rp).c
        : 0,
      total_outbound: outFilter
        ? db.prepare(`SELECT COUNT(*) as c FROM messages m WHERE direction='outbound' AND (${outFilter})`).get(...rp, ...up).c
        : 0,
      sent_today:     outFilter
        ? db.prepare(`SELECT COUNT(*) as c FROM messages m WHERE direction='outbound' AND date(created_at)=? AND (${outFilter})`).get(today, ...rp, ...up).c
        : 0,
      received_today: inFilter
        ? db.prepare(`SELECT COUNT(*) as c FROM messages m WHERE direction='inbound' AND date(created_at)=? AND (${inFilter})`).get(today, ...rp).c
        : 0,
      failed:         outFilter
        ? db.prepare(`SELECT COUNT(*) as c FROM messages m WHERE direction='outbound' AND status='failed' AND (${outFilter})`).get(...rp, ...up).c
        : 0,
    };
  }
}

module.exports = new MessageService();
