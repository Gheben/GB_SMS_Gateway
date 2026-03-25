const { verifyToken } = require('../services/authService');
const { getDb } = require('../db/database');

/**
 * Middleware che verifica il token JWT.
 * Popola req.user con { id, username, role, permissions, groups }.
 * Per gli utenti LDAP non-admin, carica i gruppi AD dal DB (non dal JWT).
 */
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non autenticato' });
  try {
    const payload = verifyToken(token);
    const isAdmin = payload.role === 'superadmin' || payload.role === 'admin';
    let groups = [];
    if (!isAdmin) {
      // Carica i gruppi LDAP dal DB per il filtro messaggi, senza appesantire il JWT
      try {
        const dbUser = getDb().prepare('SELECT ldap_groups FROM users WHERE id = ?').get(payload.sub);
        if (dbUser?.ldap_groups) groups = JSON.parse(dbUser.ldap_groups);
      } catch (_) { /* ignora errori DB opzionali */ }
    }
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions || {},
      groups,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

/** Solo superadmin o admin */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
  if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  next();
}

/** Solo superadmin */
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin };
