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
    // Legge sempre role, permissions e allowed_ports dal DB per applicare
    // immediatamente qualsiasi modifica senza richiedere il re-login.
    const dbUser = getDb().prepare(
      'SELECT role, permissions, allowed_ports, ldap_groups FROM users WHERE id = ?'
    ).get(payload.sub);
    if (!dbUser) return res.status(401).json({ error: 'Utente non trovato' });
    const isAdmin = dbUser.role === 'superadmin' || dbUser.role === 'admin';
    const groups = !isAdmin && dbUser.ldap_groups ? JSON.parse(dbUser.ldap_groups) : [];
    req.user = {
      id: payload.sub,
      username: payload.username,
      displayName: payload.displayName,
      role: dbUser.role,
      permissions: JSON.parse(dbUser.permissions || '{}'),
      allowed_ports: JSON.parse(dbUser.allowed_ports || '[]'),
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
