// Carica ldapjs in modo che il server non crashi se il pacchetto non fosse installato
let ldap;
try { ldap = require('ldapjs'); } catch { ldap = null; }

const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');

const SETTINGS_KEY = 'ldap_config';

/* ─── Settings CRUD ─────────────────────────────────────────── */

function getLdapSettings() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
    if (!row) return null;
    return JSON.parse(row.value);
  } catch { return null; }
}

function saveLdapSettings(cfg) {
  const db = getDb();
  const existing = getLdapSettings();
  // Mantieni password esistente se non ri-inviata (entrambi i formati)
  if (!cfg.ldap_service_password) {
    if (existing?.ldap_service_password) cfg.ldap_service_password = existing.ldap_service_password;
  }
  if (!cfg.bind_password) {
    if (existing?.bind_password) cfg.bind_password = existing.bind_password;
  }
  // Cifra le password prima di salvarle (guard: non ricifrare se già cifrate)
  if (cfg.ldap_service_password && !isEncrypted(cfg.ldap_service_password)) {
    cfg.ldap_service_password = encrypt(cfg.ldap_service_password);
  }
  if (cfg.bind_password && !isEncrypted(cfg.bind_password)) {
    cfg.bind_password = encrypt(cfg.bind_password);
  }
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(SETTINGS_KEY, JSON.stringify(cfg));
}

/* ─── Client helpers ─────────────────────────────────────────── */

/** Restituisce il DN/UPN con cui eseguire il bind dell'account di servizio */
function _serviceBindPrincipal(cfg) {
  if (cfg.ldap_service_username && cfg.ldap_domain) {
    return `${cfg.ldap_service_username}@${cfg.ldap_domain}`;
  }
  return cfg.bind_dn || '';
}

/** Restituisce la password dell'account di servizio (decifrata) */
function _servicePassword(cfg) {
  const raw = cfg.ldap_service_password || cfg.bind_password || '';
  return decrypt(raw);
}

/** Restituisce il Base DN */
function _baseDn(cfg) {
  return cfg.ldap_base_dn || cfg.base_dn || '';
}

function makeClient(cfg) {
  // Nuovo formato: ldap_server è l'URL completo (ldap:// o ldaps://)
  const url = cfg.ldap_server ||
    `${cfg.use_tls ? 'ldaps' : 'ldap'}://${cfg.host}:${cfg.port || (cfg.use_tls ? 636 : 389)}`;
  const client = ldap.createClient({
    url,
    tlsOptions: { rejectUnauthorized: !cfg.skip_cert_verify },
    reconnect: false,
    timeout: 8000,
    connectTimeout: 8000,
  });
  // MUST handle error event — altrimenti Node.js lancia eccezione non gestita
  client.on('error', err => logger.warn(`[LDAP] client error: ${err.message}`));
  return client;
}

function ldapBind(client, dn, password) {
  return new Promise((resolve, reject) =>
    client.bind(dn, password, err => (err ? reject(err) : resolve()))
  );
}

function ldapSearch(client, base, options) {
  return new Promise((resolve, reject) => {
    const entries = [];
    client.search(base, options, (err, res) => {
      if (err) return reject(err);
      res.on('searchEntry', e => {
        // ldapjs v3: leggi da e.attributes (array di {type, values})
        // ldapjs v1/v2: leggi da e.object (plain object)
        // Normalizziamo tutte le chiavi in lowercase per uniformità
        const obj = {};
        if (Array.isArray(e.attributes)) {
          for (const attr of e.attributes) {
            const key = (attr.type || '').toLowerCase();
            if (!key) continue;
            const vals = attr.values || attr.vals || [];
            obj[key] = vals.length === 1 ? vals[0] : (vals.length === 0 ? undefined : vals);
          }
        }
        // Fallback: e.object (ldapjs v1/v2)
        if (Object.keys(obj).length === 0 && e.object) {
          for (const k of Object.keys(e.object)) obj[k.toLowerCase()] = e.object[k];
        }
        if (!obj.dn && e.objectName) obj.dn = String(e.objectName);
        entries.push(obj);
      });
      res.on('error', e => reject(e));
      res.on('end',   () => resolve(entries));
    });
  });
}

function ldapUnbind(client) {
  return new Promise(resolve => client.unbind(() => resolve()));
}

function escapeLdap(s) {
  return String(s).replace(/[\\*()[\]/\0]/g, c =>
    '\\' + c.charCodeAt(0).toString(16).padStart(2, '0')
  );
}

/* ─── Group resolution ───────────────────────────────────────── */

/**
 * Risolve tutti i gruppi (anche nested) a cui l'utente appartiene.
 * In modalità AD usa LDAP_MATCHING_RULE_IN_CHAIN (ricorsione automatica).
 * Altrimenti fa BFS sui memberOf di ogni gruppo.
 */
async function getAllGroupsForUser(client, cfg, userDN, directGroups) {
  if (cfg.ad_mode !== false) {
    // Tentativo 1: chain search globale per tutti i gruppi dell'utente
    try {
      const filter = `(member:1.2.840.113556.1.4.1941:=${escapeLdap(userDN)})`;
      const entries = await ldapSearch(client, _baseDn(cfg), {
        scope: 'sub',
        filter,
        attributes: ['dn'],
        sizeLimit: 500,
      });
      const dns = entries.map(e => e.dn || e.objectName).filter(Boolean);
      if (dns.length) return dns;
    } catch (err) {
      logger.warn(`[LDAP] AD chain search failed: ${err.message}, usando BFS memberOf`);
    }

    // Tentativo 2: unica query con filtro OR su tutti i gruppi configurati nel mapping.
    // Cerca da baseDN con (|(distinguishedName=DN1 & member:OID:=userDN)(DN2 & ...)...).
    // I risultati sono al massimo N (numero di mapping) → il size limit non viene mai colpito.
    const mappings = cfg.group_mappings || [];
    if (mappings.length) {
      try {
        const parts = mappings.map(m =>
          `(&(distinguishedName=${escapeLdap(m.group_dn)})(member:1.2.840.113556.1.4.1941:=${escapeLdap(userDN)}))`
        );
        const filter = parts.length === 1 ? parts[0] : `(|${parts.join('')})`;
        const entries = await ldapSearch(client, _baseDn(cfg), {
          scope: 'sub',
          filter,
          attributes: ['dn'],
          sizeLimit: mappings.length + 1,
        });
        const matched = entries.map(e => e.dn || e.objectName).filter(Boolean);
        if (matched.length) {
          logger.info(`[LDAP] Single targeted query: user is transitive member of ${matched.length} configured group(s)`);
          return [...new Set([...directGroups, ...matched])];
        }
      } catch (err) {
        logger.warn(`[LDAP] Single targeted query failed: ${err.message}, falling back to BFS`);
      }
    }
  }

  // BFS standard (fallback per non-AD o quando tutti i metodi falliscono)
  const visited = new Set(directGroups);
  const queue   = [...directGroups];
  while (queue.length) {
    const gDN = queue.shift();
    try {
      const entries = await ldapSearch(client, gDN, {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: ['memberOf'],
        sizeLimit: 1,
      });
      [].concat(entries[0]?.memberOf || []).forEach(dn => {
        if (!visited.has(dn)) { visited.add(dn); queue.push(dn); }
      });
    } catch {}
  }
  return [...visited];
}

/* ─── Public API ─────────────────────────────────────────────── */

async function testConnection() {
  if (!ldap) throw new Error('ldapjs non installato nel backend');
  const cfg = getLdapSettings();
  if (!cfg?.enabled) throw new Error('LDAP non abilitato');
  if (!cfg.host && !cfg.ldap_server) throw new Error('Server LDAP non configurato');
  const client = makeClient(cfg);
  try {
    await ldapBind(client, _serviceBindPrincipal(cfg), _servicePassword(cfg));
    return { ok: true, message: 'Connessione riuscita' };
  } finally {
    await ldapUnbind(client);
  }
}

/**
 * Autentica un utente tramite LDAP.
 * Restituisce { dn, username, displayName, email, groups } oppure null.
 */
async function authenticate(username, password) {
  if (!ldap) return null;
  const cfg = getLdapSettings();
  if (!cfg?.enabled || (!cfg.host && !cfg.ldap_server)) return null;

  const svcClient = makeClient(cfg);
  try {
    // 1. Bind con service account
    await ldapBind(svcClient, _serviceBindPrincipal(cfg), _servicePassword(cfg));
    logger.info(`[LDAP] Service bind OK`);

    // 2. Trova utente
    // Normalizza username: rimuovi dominio (user@domain o DOMAIN\user)
    const bareUsername = username.includes('@') ? username.split('@')[0]
      : username.includes('\\') ? username.split('\\').pop()
      : username;
    const userFilter = (cfg.user_filter || '(sAMAccountName={{username}})')
      .replace('{{username}}', escapeLdap(bareUsername));
    logger.info(`[LDAP] Searching user "${bareUsername}" in "${_baseDn(cfg)}" with filter: ${userFilter}`);
    const users = await ldapSearch(svcClient, _baseDn(cfg), {
      scope: 'sub',
      filter: userFilter,
      attributes: ['dn', 'sAMAccountName', 'cn', 'displayName', 'mail', 'memberOf'],
      sizeLimit: 1,
    });
    if (!users.length) {
      logger.warn(`[LDAP] User "${bareUsername}" not found in directory`);
      return null;
    }

    const entry  = users[0];
    const userDN = entry.dn || entry.objectName;
    logger.info(`[LDAP] User found: DN=${userDN}`);

    // 3. Verifica password utente
    const userClient = makeClient(cfg);
    try {
      await ldapBind(userClient, userDN, password);
    } catch (e) {
      logger.warn(`[LDAP] Invalid password for "${username}": ${e.message}`);
      await ldapUnbind(userClient);
      return null; // password errata
    }
    await ldapUnbind(userClient);
    logger.info(`[LDAP] Password OK for "${bareUsername}"`);

    // 4. Risolvi gruppi (anche nested)
    const directGroups = [].concat(entry.memberOf || []);
    logger.info(`[LDAP] Direct groups (${directGroups.length}): ${directGroups.slice(0, 5).join('; ')}${directGroups.length > 5 ? '...' : ''}`);
    const allGroups    = await getAllGroupsForUser(svcClient, cfg, userDN, directGroups);
    logger.info(`[LDAP] All resolved groups (${allGroups.length}): ${allGroups.slice(0, 5).join('; ')}${allGroups.length > 5 ? '...' : ''}`);

    return {
      dn:          userDN,
      username:    entry.samaccountname || entry.cn || bareUsername,
      displayName: entry.displayname    || entry.cn || bareUsername,
      email:       entry.mail || null,
      groups:      allGroups,
    };
  } catch (err) {
    logger.warn(`[LDAP] Authenticate error for "${username}": ${err.message}`);
    return null;
  } finally {
    await ldapUnbind(svcClient);
  }
}

/**
 * Dati i gruppi DN dell'utente, restituisce { role, permissions }
 * in base al group_mappings configurato. Primo mapping admin vince.
 */
function resolvePermissions(groups) {
  const cfg = getLdapSettings();
  if (!cfg?.group_mappings?.length) {
    logger.warn('[LDAP] resolvePermissions: no group_mappings configured');
    return null;
  }

  const groupSet = new Set(groups.map(g => g.toLowerCase()));
  let role   = null;
  let merged = {};

  for (const m of cfg.group_mappings) {
    if (!groupSet.has(m.group_dn.toLowerCase())) continue;
    if (m.role === 'admin') return { role: 'admin', permissions: {} };
    role = 'user';
    // Merge permessi (unione — se più gruppi, tutte le sezioni permesse)
    Object.entries(m.permissions || {}).forEach(([k, v]) => { if (v) merged[k] = true; });
  }

  if (!role) {
    logger.warn(`[LDAP] resolvePermissions: user groups don't match any mapping. User groups: ${[...groupSet].slice(0, 5).join('; ')}`);
    logger.warn(`[LDAP] resolvePermissions: configured mappings: ${cfg.group_mappings.map(m => m.group_dn).join('; ')}`);
    return null;
  }
  return { role, permissions: merged };
}

/**
 * Cerca un utente tramite service account senza verificare la sua password.
 * Usato per SSO dove il proxy ha già autenticato l'utente.
 * Restituisce { dn, username, displayName, email, groups } oppure null.
 */
async function lookupUser(username) {
  if (!ldap) return null;
  const cfg = getLdapSettings();
  if (!cfg?.enabled || (!cfg.host && !cfg.ldap_server)) return null;

  const svcClient = makeClient(cfg);
  try {
    await ldapBind(svcClient, _serviceBindPrincipal(cfg), _servicePassword(cfg));

    const userFilter = (cfg.user_filter || '(sAMAccountName={{username}})')
      .replace('{{username}}', escapeLdap(username.includes('@') ? username.split('@')[0] : username));
    const users = await ldapSearch(svcClient, _baseDn(cfg), {
      scope: 'sub',
      filter: userFilter,
      attributes: ['dn', 'sAMAccountName', 'cn', 'displayName', 'mail', 'memberOf'],
      sizeLimit: 1,
    });
    if (!users.length) return null;

    const entry  = users[0];
    const userDN = entry.dn || entry.objectName;
    const directGroups = [].concat(entry.memberOf || []);
    const allGroups    = await getAllGroupsForUser(svcClient, cfg, userDN, directGroups);

    return {
      dn:          userDN,
      username:    entry.samaccountname || entry.cn || username,
      displayName: entry.displayname    || entry.cn || username,
      email:       entry.mail || null,
      groups:      allGroups,
    };
  } catch (err) {
    logger.warn(`[LDAP] LookupUser error for "${username}": ${err.message}`);
    return null;
  } finally {
    await ldapUnbind(svcClient);
  }
}

module.exports = { getLdapSettings, saveLdapSettings, testConnection, authenticate, lookupUser, resolvePermissions };
