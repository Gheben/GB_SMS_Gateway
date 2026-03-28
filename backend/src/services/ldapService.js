// Load ldapjs gracefully — if the package is not installed the server will still start
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
  // Keep existing password if not re-submitted (both field name formats)
  if (!cfg.ldap_service_password) {
    if (existing?.ldap_service_password) cfg.ldap_service_password = existing.ldap_service_password;
  }
  if (!cfg.bind_password) {
    if (existing?.bind_password) cfg.bind_password = existing.bind_password;
  }
  // Encrypt passwords before saving (guard: skip if already encrypted)
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

/** Returns the DN/UPN used to bind the service account. */
function _serviceBindPrincipal(cfg) {
  if (cfg.ldap_service_username && cfg.ldap_domain) {
    return `${cfg.ldap_service_username}@${cfg.ldap_domain}`;
  }
  return cfg.bind_dn || '';
}

/**
 * Returns the service account password (decrypted).
 * Throws a clear error if decryption fails (wrong ENCRYPTION_SECRET).
 */
function _servicePassword(cfg) {
  const raw = cfg.ldap_service_password || cfg.bind_password || '';
  const decrypted = decrypt(raw);
  // decrypt() returns '' when AES-GCM auth tag fails (wrong key)
  if (decrypted === '' && raw && isEncrypted(raw)) {
    throw new Error(
      'LDAP: impossibile decifrare la password del service account. ' +
      'La variabile ENCRYPTION_SECRET (o JWT_SECRET) in questo ambiente non corrisponde a quella usata quando le impostazioni LDAP sono state salvate. ' +
      'Soluzione: (1) impostare ENCRYPTION_SECRET con lo stesso valore in tutti gli ambienti, oppure ' +
      '(2) reinserire la password del service account in Impostazioni → LDAP.'
    );
  }
  return decrypted;
}

/** Returns the Base DN. */
function _baseDn(cfg) {
  return cfg.ldap_base_dn || cfg.base_dn || '';
}

function makeClient(cfg) {
  // New format: ldap_server is the full URL (ldap:// or ldaps://)
  const url = cfg.ldap_server ||
    `${cfg.use_tls ? 'ldaps' : 'ldap'}://${cfg.host}:${cfg.port || (cfg.use_tls ? 636 : 389)}`;
  const client = ldap.createClient({
    url,
    tlsOptions: { rejectUnauthorized: !cfg.skip_cert_verify },
    reconnect: false,
    timeout: 8000,
    connectTimeout: 8000,
  });
  // MUST handle error event — otherwise Node.js throws an unhandled exception
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
        // ldapjs v3: read from e.attributes (array of {type, values})
        // ldapjs v1/v2: read from e.object (plain object)
        // Normalise all keys to lowercase for consistency
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
 * Resolves all groups (including nested) the user belongs to.
 * In AD mode uses LDAP_MATCHING_RULE_IN_CHAIN (automatic recursion by the DC).
 * Otherwise falls back to BFS over each group's memberOf attribute.
 */
async function getAllGroupsForUser(client, cfg, userDN, directGroups) {
  if (cfg.ad_mode !== false) {
    // Strategy 1: global AD chain search for all groups the user belongs to
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
      logger.warn(`[LDAP] AD chain search failed: ${err.message}, falling back to targeted query`);
    }

    // Strategy 2: single OR-combined query over all configured group mappings.
    // Searches from baseDN with (|(distinguishedName=DN1 & member:OID:=userDN)(DN2 & ...)...).
    // Results are bounded to at most N entries (number of mappings) — size limit is never hit.
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

  // Strategy 3: BFS fallback (non-AD mode or when all AD strategies fail)
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
  if (!ldap) throw new Error('ldapjs is not installed in the backend');
  const cfg = getLdapSettings();
  if (!cfg?.enabled) throw new Error('LDAP is not enabled');
  if (!cfg.host && !cfg.ldap_server) throw new Error('LDAP server is not configured');
  const client = makeClient(cfg);
  try {
    await ldapBind(client, _serviceBindPrincipal(cfg), _servicePassword(cfg));
    return { ok: true, message: 'Connection successful' };
  } finally {
    await ldapUnbind(client);
  }
}

/**
 * Authenticates a user via LDAP.
 * Returns { dn, username, displayName, email, groups } or null.
 */
async function authenticate(username, password) {
  if (!ldap) return null;
  const cfg = getLdapSettings();
  if (!cfg?.enabled || (!cfg.host && !cfg.ldap_server)) return null;

  const svcClient = makeClient(cfg);
  try {
    // 1. Bind with service account
    await ldapBind(svcClient, _serviceBindPrincipal(cfg), _servicePassword(cfg));
    logger.info(`[LDAP] Service bind OK`);

    // 2. Find user
    // Normalise username: strip domain prefix (user@domain or DOMAIN\user)
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

    // 3. Verify user password
    const userClient = makeClient(cfg);
    try {
      await ldapBind(userClient, userDN, password);
    } catch (e) {
      logger.warn(`[LDAP] Invalid password for "${username}": ${e.message}`);
      await ldapUnbind(userClient);
      return null; // wrong password
    }
    await ldapUnbind(userClient);
    logger.info(`[LDAP] Password OK for "${bareUsername}"`);

    // 4. Resolve groups (including nested)
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
 * Given the user's group DNs, returns { role, permissions }
 * based on the configured group_mappings. First admin mapping wins.
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
  let mergedPorts = [];

  for (const m of cfg.group_mappings) {
    if (!groupSet.has(m.group_dn.toLowerCase())) continue;
    if (m.role === 'admin') return { role: 'admin', permissions: {}, allowed_ports: [] };
    role = 'user';
    // Merge permissions (union — if user matches multiple groups, all sections are granted)
    Object.entries(m.permissions || {}).forEach(([k, v]) => { if (v) merged[k] = true; });
    // Merge allowed_ports (union — accumulate all allowed ports across matched groups)
    const mPorts = Array.isArray(m.allowed_ports) ? m.allowed_ports : [];
    mPorts.forEach(ap => {
      if (!mergedPorts.some(p => String(p.device_id) === String(ap.device_id) && p.port_number === ap.port_number)) {
        mergedPorts.push(ap);
      }
    });
  }

  if (!role) {
    logger.warn(`[LDAP] resolvePermissions: user groups don't match any mapping. User groups: ${[...groupSet].slice(0, 5).join('; ')}`);
    logger.warn(`[LDAP] resolvePermissions: configured mappings: ${cfg.group_mappings.map(m => m.group_dn).join('; ')}`);
    return null;
  }
  return { role, permissions: merged, allowed_ports: mergedPorts };
}

/**
 * Looks up a user via service account without verifying their password.
 * Used for SSO flows where the upstream proxy has already authenticated the user.
 * Returns { dn, username, displayName, email, groups } or null.
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

/**
 * Fetches contacts from Active Directory for the phonebook.
 * Uses the main LDAP service account credentials.
 * Returns only entries that have the `mobile` attribute set.
 * Deduplicates by sAMAccountName.
 */
async function searchPhonebook() {
  if (!ldap) throw new Error('ldapjs is not installed');
  const cfg = getLdapSettings();
  if (!cfg?.enabled) throw new Error('LDAP is not enabled');
  if (!cfg.host && !cfg.ldap_server) throw new Error('LDAP server is not configured');

  // Phonebook-specific overrides stored in settings table
  const db = getDb();
  const pbRow = db.prepare("SELECT value FROM settings WHERE key='phonebook_ldap'").get();
  const pbCfg = pbRow ? JSON.parse(pbRow.value) : {};

  const baseDn = pbCfg.base_dn || _baseDn(cfg);
  const filter = pbCfg.filter  || '(&(objectClass=user)(mobile=*))';

  const client = makeClient(cfg);
  const bindDn  = _serviceBindPrincipal(cfg);
  const bindPwd = _servicePassword(cfg);

  try {
    await ldapBind(client, bindDn, bindPwd);
    const entries = await ldapSearch(client, baseDn, {
      scope:      'sub',
      filter,
      attributes: ['displayName', 'cn', 'mobile', 'sAMAccountName'],
      sizeLimit:  1000,
    });

    // Deduplicate by sAMAccountName (a user may appear in multiple groups/OU)
    const seen = new Set();
    const contacts = [];
    for (const e of entries) {
      const sam = e.samaccountname || e.sAMAccountName || e.dn;
      if (seen.has(sam)) continue;
      seen.add(sam);
      const mobile = e.mobile;
      if (!mobile) continue;
      contacts.push({
        display_name: e.displayname || e.displayName || e.cn || sam,
        phone:        Array.isArray(mobile) ? mobile[0] : mobile,
        source:       'ldap',
      });
    }
    logger.info(`[Phonebook] LDAP sync: ${contacts.length} contact(s) with mobile number`);
    return contacts;
  } finally {
    await ldapUnbind(client);
  }
}

module.exports = { getLdapSettings, saveLdapSettings, testConnection, authenticate, lookupUser, resolvePermissions, searchPhonebook };
