// Carica ldapjs in modo che il server non crashi se il pacchetto non fosse installato
let ldap;
try { ldap = require('ldapjs'); } catch { ldap = null; }

const { getDb } = require('../db/database');
const logger = require('../utils/logger');

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
  // Se bind_password è vuota, mantieni quella esistente
  if (!cfg.bind_password) {
    const existing = getLdapSettings();
    if (existing?.bind_password) cfg.bind_password = existing.bind_password;
  }
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(SETTINGS_KEY, JSON.stringify(cfg));
}

/* ─── Client helpers ─────────────────────────────────────────── */

function makeClient(cfg) {
  const proto = cfg.use_tls ? 'ldaps' : 'ldap';
  const port  = cfg.port  || (cfg.use_tls ? 636 : 389);
  const client = ldap.createClient({
    url: `${proto}://${cfg.host}:${port}`,
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
      res.on('searchEntry', e => entries.push(e.object));
      res.on('error',       e => reject(e));
      res.on('end',         () => resolve(entries));
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
    try {
      const filter = `(member:1.2.840.113556.1.4.1941:=${escapeLdap(userDN)})`;
      const entries = await ldapSearch(client, cfg.base_dn, {
        filter,
        attributes: ['dn'],
        sizeLimit: 500,
      });
      // ad_mode restituisce anche gli objectName come DN
      const dns = entries.map(e => e.dn || e.objectName).filter(Boolean);
      if (dns.length) return dns;
    } catch (err) {
      logger.warn(`[LDAP] AD chain search failed: ${err.message}, usando BFS memberOf`);
    }
  }

  // BFS standard
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
  if (!cfg.host)     throw new Error('Server LDAP non configurato');
  const client = makeClient(cfg);
  try {
    await ldapBind(client, cfg.bind_dn, cfg.bind_password);
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
  if (!cfg?.enabled || !cfg.host) return null;

  const svcClient = makeClient(cfg);
  try {
    // 1. Bind con service account
    await ldapBind(svcClient, cfg.bind_dn, cfg.bind_password);

    // 2. Trova utente
    const userFilter = (cfg.user_filter || '(sAMAccountName={{username}})')
      .replace('{{username}}', escapeLdap(username));
    const users = await ldapSearch(svcClient, cfg.base_dn, {
      filter: userFilter,
      attributes: ['dn', 'sAMAccountName', 'cn', 'displayName', 'mail', 'memberOf'],
      sizeLimit: 1,
    });
    if (!users.length) return null;

    const entry  = users[0];
    const userDN = entry.dn || entry.objectName;

    // 3. Verifica password utente
    const userClient = makeClient(cfg);
    try {
      await ldapBind(userClient, userDN, password);
    } catch {
      await ldapUnbind(userClient);
      return null; // password errata
    }
    await ldapUnbind(userClient);

    // 4. Risolvi gruppi (anche nested)
    const directGroups = [].concat(entry.memberOf || []);
    const allGroups    = await getAllGroupsForUser(svcClient, cfg, userDN, directGroups);

    return {
      dn:          userDN,
      username:    entry.sAMAccountName || entry.cn || username,
      displayName: entry.displayName    || entry.cn || username,
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
  if (!cfg?.group_mappings?.length) return null;

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

  if (!role) return null;
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
  if (!cfg?.enabled || !cfg.host) return null;

  const svcClient = makeClient(cfg);
  try {
    await ldapBind(svcClient, cfg.bind_dn, cfg.bind_password);

    const userFilter = (cfg.user_filter || '(sAMAccountName={{username}})')
      .replace('{{username}}', escapeLdap(username));
    const users = await ldapSearch(svcClient, cfg.base_dn, {
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
      username:    entry.sAMAccountName || entry.cn || username,
      displayName: entry.displayName    || entry.cn || username,
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
