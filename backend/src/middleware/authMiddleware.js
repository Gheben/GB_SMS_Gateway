const { verifyToken } = require('../services/authService');

/**
 * Middleware che verifica il token JWT.
 * Popola req.user con { id, username, role, permissions }.
 */
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non autenticato' });
  try {
    const payload = verifyToken(token);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions || {},
      groups: [], // groups not stored in JWT; fetched from DB when needed
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
