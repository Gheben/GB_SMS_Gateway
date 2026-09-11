const { verifyToken, updateLastSeen } = require('../services/authService');
const { getDb } = require('../db/database');
const ldapService = require('../services/ldapService');

/**
 * Middleware che verifica il token JWT.
 * Popola req.user con { id, username, role, permissions, groups }.
 * Per gli utenti LDAP, ri-risolve i permessi dai ldap_groups salvati + config corrente,
 * così le modifiche alle group_mappings hanno effetto immediato senza re-login.
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
      'SELECT role, permissions, allowed_ports, ldap_groups, source FROM users WHERE id = ?'
    ).get(payload.sub);
    if (!dbUser) return res.status(401).json({ error: 'Utente non trovato' });

    let role = dbUser.role;
    let permissions = JSON.parse(dbUser.permissions || '{}');
    let allowed_ports = JSON.parse(dbUser.allowed_ports || '[]');

    // Per gli utenti LDAP, ri-risolve i permessi dalla configurazione corrente dei group_mappings.
    // Questo garantisce che le modifiche alle mappature siano visibili al prossimo tick di polling
    // (o al prossimo F5) senza bisogno di logout/login.
    if (dbUser.source === 'ldap' && dbUser.ldap_groups) {
      try {
        const groups = JSON.parse(dbUser.ldap_groups);
        const resolved = ldapService.resolvePermissions(groups);
        if (resolved) {
          role = resolved.role;
          permissions = resolved.permissions || {};
          allowed_ports = resolved.allowed_ports || [];
        }
      } catch { /* ignora, usa i valori del DB */ }
    }

    const isAdmin = role === 'superadmin' || role === 'admin';
    const groups = !isAdmin && dbUser.ldap_groups ? JSON.parse(dbUser.ldap_groups) : [];
    req.user = {
      id: payload.sub,
      username: payload.username,
      displayName: payload.displayName,
      role,
      permissions,
      allowed_ports,
      groups,
    };
    updateLastSeen(payload.sub);
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
