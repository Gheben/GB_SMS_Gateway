const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { login, safeUser, signToken: _st } = require('../services/authService');
// Re-export signToken for SSO use
const authService = require('../services/authService');
const ldapService = require('../services/ldapService');
const { getDb } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');

const router = Router();

// POST /api/auth/login
router.post('/login', [
  body('username').isString().trim().notEmpty(),
  body('password').isString().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const result = await login(req.body.username, req.body.password);
    if (!result) return res.status(401).json({ error: 'Credenziali non valide' });
    auditService.log(result.user?.id, result.user?.username || req.body.username, 'auth:login', 'user', result.user?.id, null, req.ip);
    res.json(result); // { token, user }
  } catch (err) {
    res.status(500).json({ error: 'Errore interno durante il login' });
  }
});

/**
 * GET /api/auth/sso
 * Endpoint per SSO via proxy (Authentik, NetScaler ADC, Nginx auth_request ecc.)
 * Il proxy autentica l'utente e passa il suo username nell'header configurato (default: X-Remote-User).
 * Se SSO_ENABLED=true nel .env, questo endpoint restituisce un JWT senza richiedere password.
 * SICUREZZA: abilitare solo se il proxy gestisce l'autenticazione e non è raggiungibile direttamente.
 */
router.get('/sso', async (req, res) => {
  if (process.env.SSO_ENABLED !== 'true') {
    return res.status(404).json({ error: 'SSO non abilitato' });
  }

  const headerName = (process.env.SSO_HEADER || 'X-Remote-User').toLowerCase();
  const rawUsername = req.headers[headerName];
  if (!rawUsername) {
    return res.status(401).json({ error: 'Header SSO non presente' });
  }

  // Estrai solo lo username (Authentik passa user@domain, AD pass: DOMAIN\\user o user@domain)
  const username = rawUsername.split('@')[0].split('\\').pop().trim();
  if (!username) return res.status(401).json({ error: 'Username SSO non valido' });

  try {
    const db = getDb();
    // 1. Cerca utente locale
    let user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (user) {
      const permissions = JSON.parse(user.permissions || '{}');
      const u = authService.safeUser({ ...user, permissions });
      return res.json({ token: authService.signJwt({ ...user, permissions, groups: u.groups || [] }), user: u });
    }

    // 2. Prova a risolvere i gruppi LDAP
    const ldapSettings = ldapService.getLdapSettings();
    if (ldapSettings?.enabled) {
      try {
        // Solo lookup (senza password) usando service account
        const svcResult = await ldapService.lookupUser(username);
        if (svcResult) {
          const permResult = ldapService.resolvePermissions(svcResult.groups);
          if (permResult) {
            const { role, permissions } = permResult;
            let ldapUser = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND source = 'ldap'").get(svcResult.username);
            if (!ldapUser) {
              const id = uuidv4();
              db.prepare(`INSERT INTO users (id, username, password_hash, role, permissions, source, ldap_dn) VALUES (?, ?, '', ?, ?, 'ldap', ?)`)
                .run(id, svcResult.username, role, JSON.stringify(permissions), svcResult.dn || null);
              ldapUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
            } else {
              db.prepare(`UPDATE users SET role=?, permissions=?, ldap_dn=?, updated_at=datetime('now') WHERE id=?`)
                .run(role, JSON.stringify(permissions), svcResult.dn || null, ldapUser.id);
              ldapUser = db.prepare('SELECT * FROM users WHERE id = ?').get(ldapUser.id);
            }
            const u = authService.safeUser({ ...ldapUser, permissions, groups: svcResult.groups });
            return res.json({ token: authService.signJwt({ ...ldapUser, permissions, groups: svcResult.groups }), user: u });
          }
        }
      } catch (ldapErr) {
        logger.warn(`[SSO] LDAP lookup failed for "${username}": ${ldapErr.message}`);
      }
    }

    return res.status(403).json({ error: 'Utente SSO non autorizzato (nessun gruppo mappato)' });
  } catch (err) {
    logger.error(`[SSO] Error: ${err.message}`);
    res.status(500).json({ error: 'Errore SSO interno' });
  }
});

module.exports = router;
