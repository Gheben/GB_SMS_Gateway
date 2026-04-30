const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { login, safeUser, signToken: _st } = require('../services/authService');
// Re-export signToken for SSO use
const authService = require('../services/authService');
const ldapService = require('../services/ldapService');
const samlService = require('../services/samlService');
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
    if (!result) {
      logger.warn(`[Auth] login fallito per username="${req.body.username}"`);
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
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
      return res.json({ token: authService.signJwt({ ...user, permissions }), user: u });
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
              db.prepare(`INSERT INTO users (id, username, password_hash, role, permissions, source, ldap_dn, ldap_groups) VALUES (?, ?, '', ?, ?, 'ldap', ?, ?)`)
                .run(id, svcResult.username, role, JSON.stringify(permissions), svcResult.dn || null, JSON.stringify(svcResult.groups || []));
              ldapUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
            } else {
              db.prepare(`UPDATE users SET role=?, permissions=?, ldap_dn=?, ldap_groups=?, updated_at=datetime('now') WHERE id=?`)
                .run(role, JSON.stringify(permissions), svcResult.dn || null, JSON.stringify(svcResult.groups || []), ldapUser.id);
              ldapUser = db.prepare('SELECT * FROM users WHERE id = ?').get(ldapUser.id);
            }
            const u = authService.safeUser({ ...ldapUser, permissions });
            return res.json({ token: authService.signJwt({ ...ldapUser, permissions }), user: u });
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

/**
 * GET /api/auth/me — restituisce le info del token JWT corrente (debug / verifica)
 * Richiede il Bearer token nell'header Authorization.
 */
const { requireAuth } = require('../middleware/authMiddleware');
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const dbUser = db.prepare('SELECT id, username, display_name, role, permissions, allowed_ports, source FROM users WHERE id = ?').get(req.user.id);
  res.json({
    token_payload: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      permissions: req.user.permissions,
    },
    db_record: dbUser ? {
      ...dbUser,
      permissions: JSON.parse(dbUser.permissions || '{}'),
      allowed_ports: JSON.parse(dbUser.allowed_ports || '[]'),
    } : null,
  });
});

/**
 * GET /api/auth/refresh-token — emette un nuovo JWT con role/permissions aggiornati.
 * Per gli utenti LDAP i permessi sono già ri-risolti dai group_mappings in requireAuth.
 * Usato dal frontend per aggiornare la UI senza re-login.
 */
router.get('/refresh-token', requireAuth, (req, res) => {
  // req.user contiene già role/permissions/allowed_ports aggiornati dal middleware
  // (per LDAP: ri-risolti dai group_mappings correnti; per local: letti dal DB).
  // Leggiamo solo display_name dal DB perché non è in req.user.
  const dbUser = getDb().prepare(
    'SELECT display_name FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!dbUser) return res.status(404).json({ error: 'Utente non trovato' });
  const { signJwt } = require('../services/authService');
  const token = signJwt({
    id: req.user.id,
    username: req.user.username,
    display_name: dbUser.display_name,
    role: req.user.role,
    permissions: req.user.permissions,
    allowed_ports: req.user.allowed_ports,
  });
  res.json({ token });
});

// ── SAML 2.0 routes ─────────────────────────────────────────────────────────

// GET /api/auth/saml/status — public, returns whether SAML is actively configured
router.get('/saml/status', (req, res) => {
  try {
    const cfg = samlService.getSamlConfig();
    const certOk = !!(cfg?.idp_cert && samlService.normalizeCert(cfg.idp_cert));
    const enabled = !!(cfg?.enabled && cfg?.idp_sso_url && certOk);
    const auto_redirect = !!(enabled && cfg?.auto_redirect);
    res.json({ enabled, auto_redirect });
  } catch {
    res.json({ enabled: false, auto_redirect: false });
  }
});

// GET /api/auth/saml/metadata — SP metadata XML (public, used by IdP setup)
router.get('/saml/metadata', (req, res) => {
  try {
    const cfg = samlService.getSamlConfig();
    if (!cfg?.enabled) return res.status(404).json({ error: 'SAML non configurato o non abilitato' });
    const xml = samlService.getMetadataXml(cfg);
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    logger.error(`[SAML] metadata error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/saml/login — avvia il flusso SP-initiated SAML (redirect a IdP)
router.get('/saml/login', async (req, res) => {
  try {
    const cfg = samlService.getSamlConfig();
    if (!cfg?.enabled) return res.status(404).json({ error: 'SAML non configurato o non abilitato' });
    const saml = samlService.createSamlInstance(cfg);
    const loginUrl = await saml.getAuthorizeUrlAsync('', req.hostname, {});  // node-saml v5: returns string, not { context }
    res.redirect(loginUrl);
  } catch (err) {
    logger.error(`[SAML] login redirect error: ${err.message}`);
    res.redirect('/login?error=saml_error');
  }
});

// POST /api/auth/saml/callback — ACS endpoint (l'IdP fa POST qui dopo l'autenticazione)
router.post('/saml/callback', async (req, res) => {
  try {
    const cfg = samlService.getSamlConfig();
    if (!cfg?.enabled) return res.status(404).json({ error: 'SAML non configurato o non abilitato' });
    const saml = samlService.createSamlInstance(cfg);
    let profile;
    try {
      ({ profile } = await saml.validatePostResponseAsync(req.body));
    } catch (sigErr) {
      // On signature/cert error: extract and log the certificate embedded in the
      // SAMLResponse so the admin can copy the correct cert into settings.
      if (req.body?.SAMLResponse) {
        try {
          const xml = Buffer.from(req.body.SAMLResponse, 'base64').toString('utf8');
          const certMatch = xml.match(/<(?:[^:>]+:)?X509Certificate[^>]*>\s*([A-Za-z0-9+/=\s]+?)\s*<\/(?:[^:>]+:)?X509Certificate>/);
          if (certMatch) {
            const cert = certMatch[1].replace(/\s+/g, '');
            logger.error(`[SAML] ${sigErr.message} — certificato nella risposta IdP (incollalo in Settings):\n-----BEGIN CERTIFICATE-----\n${cert.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`);
          } else {
            logger.error(`[SAML] ${sigErr.message} — nessun certificato nell'XML della risposta`);
          }
        } catch { logger.error(`[SAML] ${sigErr.message}`); }
      } else {
        logger.error(`[SAML] ${sigErr.message}`);
      }
      return res.redirect('/login?error=saml_failed');
    }
    if (!profile) {
      logger.warn('[SAML] validatePostResponseAsync: nessun profilo restituito');
      return res.redirect('/login?error=saml_no_profile');
    }

    // Estrai username
    const usernameAttr = cfg.username_attribute;
    const rawUsername = usernameAttr
      ? (profile[usernameAttr] || profile.nameID)
      : profile.nameID;
    const username = (rawUsername || '').toString().trim();
    if (!username) {
      logger.warn(`[SAML] Nessuno username nel profilo: ${JSON.stringify(profile)}`);
      return res.redirect('/login?error=saml_no_username');
    }

    // Estrai displayName (let per poter aggiornare da LDAP)
    const displayNameAttr = cfg.display_name_attribute || 'displayName';
    let displayName = (
      profile[displayNameAttr] ||
      profile['http://schemas.microsoft.com/identity/claims/displayname'] ||
      profile['urn:oid:2.16.840.1.113730.3.1.241'] ||
      username
    ).toString().trim();

    // Upsert utente SAML nel DB
    const db = getDb();

    // Prima prova a risolvere il ruolo tramite mappatura gruppi LDAP.
    // L'IdP (NetScaler) spesso inietta i gruppi come attributo SAML; in alternativa
    // si fa un lookup LDAP con il service account.
    let ldapRole = null;
    let ldapPerms = null;
    try {
      // 1. Prova gruppi dal profilo SAML (attributo standard memberOf o simili)
      const rawGroups = profile['memberOf'] || profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'] || [];
      const samlGroups = Array.isArray(rawGroups) ? rawGroups : (rawGroups ? [rawGroups] : []);

      // 2. Prova lookup LDAP con service account (se LDAP configurato e abilitato)
      let allGroups = samlGroups;
      const ldapResult = await ldapService.lookupUser(username);
      if (ldapResult?.groups?.length) {
        // Unisce i gruppi SAML e LDAP (rimuove duplicati, case-insensitive)
        const seen = new Set(samlGroups.map(g => g.toLowerCase()));
        for (const g of ldapResult.groups) {
          if (!seen.has(g.toLowerCase())) { allGroups.push(g); seen.add(g.toLowerCase()); }
        }
        // Aggiorna displayName da LDAP se non già ottenuto da SAML
        if (!profile[displayNameAttr] && ldapResult.displayName) {
          displayName = ldapResult.displayName;
        }
      }

      if (allGroups.length) {
        const permResult = ldapService.resolvePermissions(allGroups);
        if (permResult) {
          ldapRole  = permResult.role;
          ldapPerms = permResult.permissions;
          logger.info(`[SAML] Utente "${username}" → ruolo da mapping LDAP: ${ldapRole} (${allGroups.length} gruppi)`);
        }
      }
    } catch (ldapErr) {
      logger.warn(`[SAML] Lookup LDAP opzionale fallito per "${username}": ${ldapErr.message}`);
    }

    // Ruolo finale: LDAP mapping > default configurato nel tab SAML
    const { PERMISSION_KEYS } = authService;
    const defaultRole = cfg.default_role || 'user';
    const finalRole  = ldapRole  || defaultRole;
    const finalPerms = ldapPerms || (
      defaultRole === 'admin'
        ? Object.fromEntries(PERMISSION_KEYS.map(k => [k, k !== 'users']))
        : { dashboard: true, inbox: true, sent: true }
    );

    // Se require_group_match è abilitato e nessun gruppo dell'utente corrisponde
    // ad una mappatura LDAP, nega l'accesso redirigendo alla pagina dedicata.
    if (cfg.require_group_match && !ldapRole) {
      logger.warn(`[SAML] Access denied for "${username}": authenticated by IdP but no LDAP group mapping matched (require_group_match=true)`);
      return res.redirect('/access-denied');
    }

    let dbUser = db.prepare(
      "SELECT * FROM users WHERE username = ? COLLATE NOCASE AND source = 'saml'"
    ).get(username);

    if (!dbUser) {
      const id = uuidv4();
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, permissions, source, display_name)
         VALUES (?, ?, '', ?, ?, 'saml', ?)`
      ).run(id, username, finalRole, JSON.stringify(finalPerms), displayName);
      dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      logger.info(`[SAML] Nuovo utente SAML creato: "${username}" con ruolo "${finalRole}" (da ${ldapRole ? 'mapping LDAP' : 'default config'})`);
    } else {
      // Aggiorna displayName e, se i gruppi LDAP sono attivi, aggiorna anche il ruolo ad ogni login
      if (ldapRole) {
        db.prepare(
          `UPDATE users SET display_name=?, role=?, permissions=?, updated_at=datetime('now') WHERE id=?`
        ).run(displayName, finalRole, JSON.stringify(finalPerms), dbUser.id);
      } else {
        db.prepare(
          `UPDATE users SET display_name=?, updated_at=datetime('now') WHERE id=?`
        ).run(displayName, dbUser.id);
      }
      dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(dbUser.id);
    }

    const permissions  = JSON.parse(dbUser.permissions  || '{}');
    const allowed_ports = JSON.parse(dbUser.allowed_ports || '[]');
    const token = authService.signJwt({ ...dbUser, permissions, allowed_ports }, {
      saml_name_id:        profile.nameID        || '',
      saml_name_id_format: profile.nameIDFormat  || '',
      saml_session_index:  profile.sessionIndex  || '',
    });
    auditService.log(dbUser.id, dbUser.username, 'auth:saml_login', 'user', dbUser.id, null, req.ip);

    res.redirect(`/saml-callback?token=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.error(`[SAML] callback error: ${err.message}\n${err.stack}`);
    res.redirect('/login?error=saml_failed');
  }
});

// POST /api/auth/saml/logout — SP-initiated SLO
// Il frontend invia il JWT nel header, noi generiamo l'URL del LogoutRequest e lo restituiamo.
// Se idp_slo_url non è configurato, risponde { logoutUrl: null } → logout locale.
router.post('/saml/logout', requireAuth, async (req, res) => {
  try {
    const cfg = samlService.getSamlConfig();
    if (!cfg?.enabled || !cfg?.idp_slo_url) {
      return res.json({ logoutUrl: null });
    }
    const { saml_name_id, saml_name_id_format, saml_session_index } = req.user;
    const logoutUrl = await samlService.getLogoutUrlAsync(
      cfg,
      saml_name_id,
      saml_name_id_format,
      saml_session_index
    );
    auditService.log(req.user.sub, req.user.username, 'auth:saml_logout', 'user', req.user.sub, null, req.ip);
    res.json({ logoutUrl: logoutUrl || null });
  } catch (err) {
    logger.error(`[SAML] SLO error: ${err.message}`);
    res.json({ logoutUrl: null });
  }
});

// POST /api/auth/saml/slo — IdP-initiated SLO
// L'IdP invia un LogoutRequest su questo endpoint (HTTP-POST binding).
// Noi completiamo il logout e reindirizziamo a /login.
router.post('/saml/slo', async (req, res) => {
  try {
    const cfg = samlService.getSamlConfig();
    if (!cfg?.enabled) return res.redirect('/login');
    // Per NetScaler /cgi/tmlogout il SLO è semplice: basta redirezionare a /login.
    // node-saml può anche validare il LogoutRequest in ingresso se necessario.
    logger.info('[SAML] IdP-initiated SLO received');
    res.redirect('/login?saml_logout=1');
  } catch (err) {
    logger.error(`[SAML] IdP SLO error: ${err.message}`);
    res.redirect('/login');
  }
});

module.exports = router;
