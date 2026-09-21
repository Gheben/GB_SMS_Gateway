// Load ldapjs gracefully — if the package is not installed the server will still start
let ldap;
try { ldap = require('ldapjs'); } catch { ldap = null; }

const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');

const SETTINGS_KEY = 'ldap_config';

/* ─── Helpers ───────────────────────────────────────────────── */

/**
 * Strip spaces, dashes, parentheses, and dots from a phone number string
 * so that AD-formatted numbers (e.g. "+39 345 678 9875") are stored in a
 * canonical form that matches manually-entered numbers.
 */
function normalizePhone(raw) {
  return String(raw || '').replace(/[\s\-().]/g, '');
}

/* ─── Avatar / thumbnailPhoto helpers ────────────────────────── */

function detectImageMime(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return 'image/png';
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61) return 'image/gif';
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  return null;
}

function toBufferMaybe(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value) && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return Buffer.from(value);
  if (value?.type === 'Buffer' && Array.isArray(value?.data)) return Buffer.from(value.data);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function normalizeThumbnailPhotoDataUrl(raw) {
  if (!raw) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return null;
  if (typeof first === 'string' && first.startsWith('data:image/')) return first;
  let buffer = toBufferMaybe(first);
  if (typeof first === 'string') {
    const value = first.trim();
    if (!value) return null;
    const base64Decoded = Buffer.from(value, 'base64');
    if (base64Decoded.length > 0 && detectImageMime(base64Decoded)) buffer = base64Decoded;
    if (!buffer || buffer.length === 0 || !detectImageMime(buffer)) {
      const binaryDecoded = Buffer.from(value, 'latin1');
      if (binaryDecoded.length > 0 && detectImageMime(binaryDecoded)) buffer = binaryDecoded;
    }
  }
  if (!buffer || buffer.length === 0) return null;
  if (buffer.length > 200 * 1024) return null; // max 200 KB
  const mime = detectImageMime(buffer);
  if (!mime) return null;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function extractRawAttributeFromSearchEntry(entry, attrName) {
  const attr = String(attrName || '').trim().toLowerCase();
  if (!attr) return null;
  const candidates = [entry?.attributes, entry?.raw?.attributes, entry?.pojo?.attributes];
  for (const attrs of candidates) {
    if (!Array.isArray(attrs)) continue;
    for (const a of attrs) {
      const type = String(a?.type || a?.name || '').trim().toLowerCase();
      if (type !== attr) continue;
      const values = [
        ...(Array.isArray(a?.buffers) ? a.buffers : []),
        ...(Array.isArray(a?.vals)    ? a.vals    : []),
        ...(Array.isArray(a?.values)  ? a.values  : []),
      ];
      for (const v of values) {
        const buf = toBufferMaybe(v);
        if (buf && buf.length > 0) return buf;
      }
    }
  }
  return null;
}

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

function normalizeEntry(e) {
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
  // Extract raw binary for thumbnailPhoto (ldapjs may strip buffer data from .values)
  const rawThumb = extractRawAttributeFromSearchEntry(e, 'thumbnailPhoto');
  if (rawThumb) obj.thumbnailphoto = rawThumb;
  return obj;
}

function ldapSearch(client, base, options) {
  return new Promise((resolve, reject) => {
    const entries = [];
    client.search(base, options, (err, res) => {
      if (err) return reject(err);
      res.on('searchEntry', e => entries.push(normalizeEntry(e)));
      res.on('error', e => reject(e));
      res.on('end',   () => resolve(entries));
    });
  });
}

/**
 * Paged LDAP search — handles AD server-side size limits by requesting results
 * in pages of `pageSize` using LDAP Paged Results Control (RFC 2696).
 * Falls back to a plain ldapSearch with large sizeLimit if control unavailable.
 * Each page has a hard timeout of `pageTimeoutMs` (default 30s) to avoid hanging forever.
 */
async function ldapSearchPaged(client, base, options, pageSize = 500, pageTimeoutMs = 30000) {
  const PRC = ldap?.controls?.PagedResultsControl;
  if (!PRC) {
    logger.warn('[LDAP] PagedResultsControl not available, falling back to single search');
    return ldapSearch(client, base, { ...options, sizeLimit: options.sizeLimit || 5000 });
  }

  const allEntries = [];
  let cookie = Buffer.alloc(0);

  for (let page = 1; ; page++) {
    const ctrl = new PRC({ value: { size: pageSize, cookie } });
    const { entries: pageEntries, nextCookie } = await new Promise((resolve, reject) => {
      const collected = [];
      // Hard timeout per page so we never hang indefinitely if AD stops responding
      const timer = setTimeout(() => {
        reject(new Error(`[LDAP paged] timeout waiting for page ${page} after ${pageTimeoutMs}ms`))
      }, pageTimeoutMs);
      client.search(base, { ...options, sizeLimit: 0 }, [ctrl], (err, res) => {
        if (err) { clearTimeout(timer); return reject(err); }
        res.on('searchEntry', e => collected.push(normalizeEntry(e)));
        res.on('error', err => {
          clearTimeout(timer);
          if (err.name === 'SizeLimitExceededError' || err.code === 4) {
            return resolve({ entries: collected, nextCookie: null });
          }
          reject(err);
        });
        res.on('end', result => {
          clearTimeout(timer);
          let nextCookie = null;
          (result?.controls || []).forEach(c => {
            if (c.type === '1.2.840.113556.1.4.319') nextCookie = c.value?.cookie;
          });
          resolve({ entries: collected, nextCookie });
        });
      });
    });

    allEntries.push(...pageEntries);
    logger.debug(`[LDAP paged] page ${page}: +${pageEntries.length} entries (total ${allEntries.length})`);
    if (!nextCookie || (Buffer.isBuffer(nextCookie) && nextCookie.length === 0)) break;
    cookie = nextCookie;
  }

  return allEntries;
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
 * BFS over each group's memberOf attribute, starting from a set of seed DNs.
 * Used both as a fallback (non-AD mode) and as a safety net after the AD chain
 * queries, since LDAP_MATCHING_RULE_IN_CHAIN does not reliably cover nested
 * groups that live across domains/trusts in a multi-domain forest.
 */
async function bfsNestedGroups(client, seedDNs) {
  const visited = new Set(seedDNs);
  const queue   = [...seedDNs];
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
    } catch (err) {
      logger.warn(`[LDAP] BFS: impossibile leggere memberOf di "${gDN}": ${err.message}`);
    }
  }
  return [...visited];
}

/**
 * Extracts the domain root suffix (DC=...,DC=...) from a full DN.
 * Used to scope group-chain searches to the whole domain, since the
 * admin-configured base DN (meant for finding user accounts) may not cover
 * the OU(s) where application/security groups actually live.
 */
function domainRootFromDn(dn) {
  const m = String(dn || '').match(/(?:^|,)\s*(DC=.+)$/i);
  return m ? m[1] : null;
}

/**
 * Resolves all groups (including nested) the user belongs to.
 * Always attempts LDAP_MATCHING_RULE_IN_CHAIN (AD-specific extended match) —
 * on a non-AD server this simply yields zero extra matches (no regression),
 * so it is NOT gated behind the "ad_mode" setting: that toggle previously
 * skipped this entirely, silently breaking group resolution on deployments
 * where it was left unchecked even though the directory is genuinely AD.
 * A BFS pass always runs too, as a safety net for memberships the matching
 * rule queries miss (e.g. cross-domain trusts).
 */
async function getAllGroupsForUser(client, cfg, userDN, directGroups) {
  const combined = new Set(directGroups);
  // Search groups from the domain root, not the (possibly narrower) configured
  // user base DN — group OUs are frequently outside the users' base DN.
  const domainRoot = domainRootFromDn(userDN) || _baseDn(cfg);
  logger.info(`[LDAP] Risoluzione gruppi per "${userDN}": ${directGroups.length} gruppo/i diretto/i, domainRoot="${domainRoot}", ad_mode=${cfg.ad_mode !== false}`);

  // Strategy 1: global AD chain search for all groups the user belongs to
  try {
    const filter = `(member:1.2.840.113556.1.4.1941:=${escapeLdap(userDN)})`;
    const entries = await ldapSearch(client, domainRoot, {
      scope: 'sub',
      filter,
      attributes: ['dn'],
      sizeLimit: 500,
    });
    const dns = entries.map(e => e.dn || e.objectName).filter(Boolean);
    logger.info(`[LDAP] AD chain search: ${dns.length} gruppo/i trovato/i`);
    dns.forEach(dn => combined.add(dn));
  } catch (err) {
    logger.warn(`[LDAP] AD chain search failed: ${err.message}`);
  }

  // Strategy 2: direct per-mapping check — queries each configured group's own
  // DN with scope=base, so it works regardless of where the group lives in the
  // tree (it does NOT depend on the configured LDAP base DN covering that OU).
  const mappings = cfg.group_mappings || [];
  if (mappings.length) {
    const checks = mappings.map(async m => {
      try {
        const entries = await ldapSearch(client, m.group_dn, {
          scope: 'base',
          filter: `(member:1.2.840.113556.1.4.1941:=${escapeLdap(userDN)})`,
          attributes: ['dn'],
          sizeLimit: 1,
        });
        if (entries.length) return entries[0].dn || m.group_dn;
        // Diagnostic-only: no match via extended match — read the group's raw
        // (non-recursive) member list to tell apart "user really isn't a member"
        // from "service account can't read this group's member attribute".
        try {
          const raw = await ldapSearch(client, m.group_dn, {
            scope: 'base',
            filter: '(objectClass=*)',
            attributes: ['member'],
            sizeLimit: 1,
          });
          const rawMembers = [].concat(raw[0]?.member || []);
          const directHit = rawMembers.some(dn => dn.toLowerCase() === userDN.toLowerCase());
          logger.info(`[LDAP] "${m.group_dn}": ${rawMembers.length} membro/i diretto/i letto/i, utente presente direttamente=${directHit}`);
        } catch (rawErr) {
          logger.warn(`[LDAP] Lettura member "${m.group_dn}" fallita: ${rawErr.message}`);
        }
        return null;
      } catch (err) {
        logger.warn(`[LDAP] Verifica diretta mapping "${m.group_dn}" fallita: ${err.message}`);
        return null;
      }
    });
    const matched = (await Promise.all(checks)).filter(Boolean);
    logger.info(`[LDAP] Verifica diretta: ${matched.length}/${mappings.length} gruppo/i mappato/i corrispondente/i`);
    matched.forEach(dn => combined.add(dn));
  }

  // Strategy 3: BFS — always run as a safety net (not just as a fallback), so
  // nested memberships missed by the AD matching-rule queries are still found.
  const bfsResult = await bfsNestedGroups(client, [...combined]);
  bfsResult.forEach(dn => combined.add(dn));

  return [...combined];
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
      attributes: ['dn', 'sAMAccountName', 'cn', 'displayName', 'mail', 'memberOf', 'thumbnailPhoto'],
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

    const avatarPhotoDataUrl = normalizeThumbnailPhotoDataUrl(entry.thumbnailphoto);
    logger.info(`[LDAP] thumbnailPhoto for "${bareUsername}": raw type=${typeof entry.thumbnailphoto}, raw=${entry.thumbnailphoto == null ? 'null' : (Buffer.isBuffer(entry.thumbnailphoto) ? `Buffer(${entry.thumbnailphoto.length})` : String(entry.thumbnailphoto).substring(0, 40))}, dataUrl=${avatarPhotoDataUrl ? `OK len=${avatarPhotoDataUrl.length}` : 'null'}`);
    return {
      dn:                userDN,
      username:          entry.samaccountname || entry.cn || bareUsername,
      displayName:       entry.displayname    || entry.cn || bareUsername,
      email:             entry.mail || null,
      groups:            allGroups,
      avatarPhotoDataUrl,
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
 * Used for SSO/SAML flows where the upstream proxy/IdP has already authenticated
 * the user, to resolve group membership (including nested) via our own AD query.
 * Intentionally does NOT require cfg.enabled: that toggle only gates interactive
 * LDAP password login — background lookups must keep working even when it's off,
 * since SAML-only deployments still rely on this for nested group resolution.
 * Returns { dn, username, displayName, email, groups } or null.
 */
async function lookupUser(username) {
  if (!ldap) return null;
  const cfg = getLdapSettings();
  if (!cfg || (!cfg.host && !cfg.ldap_server)) return null;

  const svcClient = makeClient(cfg);
  try {
    await ldapBind(svcClient, _serviceBindPrincipal(cfg), _servicePassword(cfg));

    const userFilter = (cfg.user_filter || '(sAMAccountName={{username}})')
      .replace('{{username}}', escapeLdap(username.includes('@') ? username.split('@')[0] : username));
    const users = await ldapSearch(svcClient, _baseDn(cfg), {
      scope: 'sub',
      filter: userFilter,
      attributes: ['dn', 'sAMAccountName', 'cn', 'displayName', 'mail', 'memberOf', 'thumbnailPhoto'],
      sizeLimit: 1,
    });
    if (!users.length) return null;

    const entry  = users[0];
    const userDN = entry.dn || entry.objectName;
    const directGroups = [].concat(entry.memberOf || []);
    const allGroups    = await getAllGroupsForUser(svcClient, cfg, userDN, directGroups);
    const avatarPhotoDataUrl = normalizeThumbnailPhotoDataUrl(entry.thumbnailphoto);

    return {
      dn:          userDN,
      username:    entry.samaccountname || entry.cn || username,
      displayName: entry.displayname    || entry.cn || username,
      email:       entry.mail || null,
      groups:      allGroups,
      avatarPhotoDataUrl,
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
    const entries = await ldapSearchPaged(client, baseDn, {
      scope:      'sub',
      filter,
      attributes: ['displayName', 'cn', 'mobile', 'mail', 'sAMAccountName'],
    }, 500);

    // Deduplicate by sAMAccountName (a user may appear in multiple groups/OU)
    const seen = new Set();
    const contacts = [];
    for (const e of entries) {
      const sam = e.samaccountname || e.sAMAccountName || e.dn;
      if (seen.has(sam)) continue;
      seen.add(sam);
      const mobile = e.mobile;
      if (!mobile) continue;
      const mail = e.mail;
      contacts.push({
        display_name: e.displayname || e.displayName || e.cn || sam,
        phone:        normalizePhone(Array.isArray(mobile) ? mobile[0] : mobile),
        email:        Array.isArray(mail) ? mail[0] : (mail || null),
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
