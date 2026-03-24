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

  saveOutbound({ deviceId, port, recipient, content }) {
    const db = getDb();
    const id = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, device_id, direction, port, recipient, content, status)
      VALUES (?, ?, 'outbound', ?, ?, ?, 'pending')
    `).run(id, deviceId || null, port, recipient, content);
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

  getAll({ direction, deviceId, page = 1, limit = 50, search, userRole, userGroups } = {}) {
    const db = getDb();
    const offset = (page - 1) * limit;
    let query = `SELECT m.*, d.name as device_name, p.sim_number as port_sim_number FROM messages m LEFT JOIN devices d ON d.id = m.device_id LEFT JOIN ports p ON p.device_id = m.device_id AND p.port_number = m.port WHERE 1=1`;
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

    // Filtro visibilità basato sui gruppi LDAP dell'utente (solo per utenti non-admin)
    const isAdmin = userRole === 'superadmin' || userRole === 'admin';
    if (!isAdmin && userGroups !== undefined) {
      // Trova le regole visibili per i gruppi dell'utente
      const allRules = db.prepare('SELECT id, allowed_groups FROM routing_rules').all();
      const visibleRuleIds = allRules
        .filter(r => {
          const groups = JSON.parse(r.allowed_groups || '[]');
          if (groups.length === 0) return true; // nessuna restrizione → tutti la vedono
          return (userGroups || []).some(g => groups.map(x => x.toLowerCase()).includes(g.toLowerCase()));
        })
        .map(r => r.id);

      if (visibleRuleIds.length > 0) {
        const placeholders = visibleRuleIds.map(() => '?').join(',');
        query += ` AND (
          NOT EXISTS (SELECT 1 FROM dispatches dp2 WHERE dp2.message_id = m.id)
          OR EXISTS (SELECT 1 FROM dispatches dp3 WHERE dp3.message_id = m.id AND dp3.rule_id IN (${placeholders}))
        )`;
        params.push(...visibleRuleIds);
      } else {
        // Nessuna regola visibile: mostra solo messaggi non instradati
        query += ` AND NOT EXISTS (SELECT 1 FROM dispatches dp2 WHERE dp2.message_id = m.id)`;
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
      SELECT m.*, d.name as device_name, p.sim_number as port_sim_number
      FROM messages m
      LEFT JOIN devices d ON d.id = m.device_id
      LEFT JOIN ports p ON p.device_id = m.device_id AND p.port_number = m.port
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

  getStats() {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    return {
      total_inbound:    db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='inbound'`).get().c,
      total_outbound:   db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='outbound'`).get().c,
      sent_today:       db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='outbound' AND date(created_at)=?`).get(today).c,
      received_today:   db.prepare(`SELECT COUNT(*) as c FROM messages WHERE direction='inbound' AND date(created_at)=?`).get(today).c,
      failed:           db.prepare(`SELECT COUNT(*) as c FROM messages WHERE status='failed'`).get().c,
    };
  }
}

module.exports = new MessageService();
