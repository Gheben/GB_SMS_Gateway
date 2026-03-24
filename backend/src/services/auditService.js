const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');

class AuditService {
  /**
   * Registra un'azione nell'audit log.
   * @param {string|null} userId - ID utente (null per eventi di sistema)
   * @param {string} username - Username (o 'system')
   * @param {string} action - Azione (es. 'sms:send', 'user:create', 'rule:delete', 'auth:login')
   * @param {string|null} resourceType - Tipo di risorsa (es. 'message', 'rule', 'user')
   * @param {string|null} resourceId - ID della risorsa
   * @param {string|null} detail - Dettaglio testuale addizionale
   * @param {string|null} ip - Indirizzo IP del client
   */
  log(userId, username, action, resourceType = null, resourceId = null, detail = null, ip = null) {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO audit_log (id, user_id, username, action, resource_type, resource_id, detail, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), userId || null, username, action, resourceType, resourceId, detail, ip);
    } catch (err) {
      // Non bloccare l'operazione principale se l'audit fallisce
      console.error('[audit] Error writing audit log:', err.message);
    }
  }

  /**
   * Recupera le voci dell'audit log con filtri e paginazione.
   * @param {object} opts
   * @param {number} opts.page
   * @param {number} opts.limit
   * @param {string} [opts.userId]
   * @param {string} [opts.username]
   * @param {string} [opts.action]
   * @param {string} [opts.resourceType]
   * @param {string} [opts.from] - ISO date string (start)
   * @param {string} [opts.to] - ISO date string (end)
   */
  getAll({ page = 1, limit = 50, userId, username, action, resourceType, from, to } = {}) {
    const db = getDb();
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    if (username) {
      query += ' AND username LIKE ?';
      params.push(`%${username}%`);
    }
    if (action) {
      query += ' AND action LIKE ?';
      params.push(`%${action}%`);
    }
    if (resourceType) {
      query += ' AND resource_type = ?';
      params.push(resourceType);
    }
    if (from) {
      query += ' AND created_at >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND created_at <= ?';
      params.push(to);
    }

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM (${query})`).get(...params).cnt;
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return { total, page, limit, data: db.prepare(query).all(...params) };
  }

  /** Elimina voci più vecchie di N giorni (pulizia admin). */
  purgeOlderThan(days) {
    const db = getDb();
    const result = db.prepare(`DELETE FROM audit_log WHERE created_at < datetime('now', ?)`).run(`-${days} days`);
    return result.changes;
  }
}

module.exports = new AuditService();
