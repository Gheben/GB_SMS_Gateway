const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/authMiddleware');
const ldapService = require('../services/ldapService');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');

const router = express.Router();

/** Strip spaces, dashes, parentheses, and dots for canonical phone storage. */
function normalizePhone(raw) {
  return String(raw || '').replace(/[\s\-().]/g, '');
}

/* â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function getPhonebookLdapCfg() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key='phonebook_ldap'").get();
  return row ? JSON.parse(row.value) : { enabled: false, base_dn: '', filter: '(&(objectClass=user)(mobile=*))' };
}

/** Sync LDAP contacts into the contacts table (replaces all source='ldap' rows). */
async function syncLdapToDb() {
  const contacts = await ldapService.searchPhonebook();
  const db = getDb();

  // Build the entire replace as a single SQL string executed via db.exec() so that:
  //  1. All writes are batched inside one transaction → single disk flush → fast even for
  //     thousands of contacts, keeping the event loop responsive during the poll window.
  //  2. Atomicity: if anything fails the DELETE is rolled back automatically.
  //
  // We cannot mix db.exec('BEGIN') with stmt.run() inside node:sqlite's DatabaseSync —
  // that combination can silently roll-back the DELETE.  By building one big SQL string
  // and calling db.exec() once we stay entirely within exec's implicit transaction support.

  const escStr = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

  const rows = contacts.map(c =>
    `(${escStr(uuidv4())},${escStr(c.display_name)},${escStr(c.phone)},${escStr(c.email)},'ldap')`
  );

  let sql = "BEGIN;\nDELETE FROM contacts WHERE source='ldap';\n";
  if (rows.length > 0) {
    sql += `INSERT INTO contacts (id, display_name, phone, email, source) VALUES\n${rows.join(',\n')};\n`;
  }
  sql += 'COMMIT;';

  try {
    db.exec(sql);
    logger.info(`[Phonebook] Synced ${contacts.length} LDAP contact(s) to local DB`);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back or never started */ }
    throw err;
  }

  return contacts;
}

/* â”€â”€â”€ Background sync job state (in-memory singleton) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const syncState = {
  status:      'idle', // 'idle' | 'running' | 'done' | 'error'
  synced:      0,
  error:       null,
  startedAt:   null,
  finishedAt:  null,
};

/**
 * Starts an async LDAP sync in the background.
 * Returns false if a sync is already running.
 */
function startSyncJob() {
  if (syncState.status === 'running') return false;
  syncState.status     = 'running';
  syncState.error      = null;
  syncState.synced     = 0;
  syncState.startedAt  = new Date().toISOString();
  syncState.finishedAt = null;

  syncLdapToDb()
    .then(contacts => {
      syncState.status     = 'done';
      syncState.synced     = contacts.length;
      syncState.finishedAt = new Date().toISOString();
      logger.info(`[Phonebook] Background sync done: ${contacts.length} contacts`);
    })
    .catch(err => {
      syncState.status     = 'error';
      syncState.error      = err.message;
      syncState.finishedAt = new Date().toISOString();
      logger.warn(`[Phonebook] Background sync failed: ${err.message}`);
    });

  return true;
}

/* â”€â”€â”€ Periodic LDAP sync scheduler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
// LDAP_SYNC_INTERVAL_HOURS env var controls the interval (default: 6 hours).
// A first sync runs 60 s after startup so the DB is populated even without a manual trigger.
(function scheduleLdapSync() {
  const intervalHours = parseFloat(process.env.LDAP_SYNC_INTERVAL_HOURS) || 6;
  const intervalMs    = intervalHours * 60 * 60 * 1000;

  function runIfEnabled() {
    const cfg = getPhonebookLdapCfg();
    if (!cfg.enabled) return;
    logger.info(`[Phonebook] Scheduled LDAP sync triggered (every ${intervalHours}h)`);
    startSyncJob();
  }

  // Warm-up: first sync 60 s after server start
  setTimeout(runIfEnabled, 60_000);

  // Recurring interval
  setInterval(runIfEnabled, intervalMs);
})();

/* â”€â”€â”€ GET /api/phonebook â€” all contacts (requires phonebook perm or admin) â”€â”€â”€ */
router.get('/', (req, res) => {
  const { role, permissions } = req.user;
  const isAdmin = role === 'superadmin' || role === 'admin';
  if (!isAdmin && !permissions?.phonebook) {
    return res.status(403).json({ error: 'Phonebook access not granted' });
  }

  const db = getDb();
  const pbCfg = getPhonebookLdapCfg();

  // If LDAP phonebook is enabled and DB has no LDAP contacts yet, kick off a background sync.
  // Response is immediate â€” client picks up synced contacts on the next request.
  if (pbCfg.enabled) {
    const ldapCount = db.prepare("SELECT COUNT(*) as cnt FROM contacts WHERE source='ldap'").get().cnt;
    if (ldapCount === 0) startSyncJob();
  }

  const contacts = db.prepare(
    "SELECT id, display_name, phone, email, notes, source FROM contacts ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json(contacts);
});

/* â”€â”€â”€ GET /api/phonebook/local â€” local contacts list (admin only) â”€â”€â”€ */
router.get('/local', requireAdmin, (req, res) => {
  const db = getDb();
  const contacts = db.prepare(
    "SELECT * FROM contacts WHERE source='local' ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json(contacts);
});

/* â”€â”€â”€ POST /api/phonebook/local â€” create local contact (admin only) â”€â”€â”€ */
router.post('/local', requireAdmin, (req, res) => {
  const { display_name, phone, email, notes } = req.body;
  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!phone?.trim())        return res.status(400).json({ error: 'phone is required' });

  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO contacts (id, display_name, phone, email, notes, source) VALUES (?, ?, ?, ?, ?, 'local')"
  ).run(id, display_name.trim(), normalizePhone(phone), email?.trim() || null, notes?.trim() || null);

  auditService.log(req.user?.id, req.user?.username || 'system', 'contact:create', 'contact', id, `Name: ${display_name.trim()}, Phone: ${normalizePhone(phone)}`, req.ip);
  res.status(201).json({ id, display_name: display_name.trim(), phone: normalizePhone(phone), email: email?.trim() || null, notes: notes?.trim() || null, source: 'local' });
});

/* â”€â”€â”€ PUT /api/phonebook/local/:id â€” update local contact (admin only) â”€â”€â”€ */
router.put('/local/:id', requireAdmin, (req, res) => {
  const { display_name, phone, email, notes } = req.body;
  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!phone?.trim())        return res.status(400).json({ error: 'phone is required' });

  const db = getDb();
  const info = db.prepare(
    "UPDATE contacts SET display_name=?, phone=?, email=?, notes=?, updated_at=datetime('now') WHERE id=? AND source='local'"
  ).run(display_name.trim(), normalizePhone(phone), email?.trim() || null, notes?.trim() || null, req.params.id);

  if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  auditService.log(req.user?.id, req.user?.username || 'system', 'contact:update', 'contact', req.params.id, `Name: ${display_name.trim()}, Phone: ${normalizePhone(phone)}`, req.ip);
  res.json({ id: req.params.id, display_name: display_name.trim(), phone: normalizePhone(phone), source: 'local' });
});

/* â”€â”€â”€ DELETE /api/phonebook/local/:id â€” delete local contact (admin only) â”€â”€â”€ */
router.delete('/local/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT display_name, phone FROM contacts WHERE id=? AND source='local'").get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });
  db.prepare("DELETE FROM contacts WHERE id=? AND source='local'").run(req.params.id);
  auditService.log(req.user?.id, req.user?.username || 'system', 'contact:delete', 'contact', req.params.id, `Name: ${existing.display_name}, Phone: ${existing.phone}`, req.ip);
  res.json({ ok: true });
});

/* â”€â”€â”€ POST /api/phonebook/ldap/sync â€” start background LDAP sync (admin only) â”€â”€â”€ */
router.post('/ldap/sync', requireAdmin, (req, res) => {
  if (syncState.status === 'running') {
    return res.json({ status: 'already_running', ...syncState });
  }
  startSyncJob();
  auditService.log(req.user?.id, req.user?.username || 'system', 'contact:ldap_sync', 'phonebook', null, 'Manual LDAP sync triggered', req.ip);
  res.json({ status: 'started', ...syncState });
});

/* â”€â”€â”€ GET /api/phonebook/ldap/status â€” current sync job state (admin only) â”€â”€â”€ */
router.get('/ldap/status', requireAdmin, (req, res) => {
  res.json(syncState);
});

/* â”€â”€â”€ GET /api/phonebook/ldap â€” returns DB contacts + current sync state (admin only) â”€â”€â”€ */
router.get('/ldap', requireAdmin, (req, res) => {
  const db = getDb();
  const contacts = db.prepare(
    "SELECT id, display_name, phone, email, source FROM contacts WHERE source='ldap' ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json({ synced: contacts.length, contacts, syncStatus: syncState });
});

/* â”€â”€â”€ GET /api/phonebook/settings â€” phonebook LDAP settings (admin only) â”€â”€â”€ */
router.get('/settings', requireAdmin, (req, res) => {
  res.json(getPhonebookLdapCfg());
});

/* â”€â”€â”€ PUT /api/phonebook/settings â€” save phonebook LDAP settings (admin only) â”€â”€â”€ */
router.put('/settings', requireAdmin, (req, res) => {
  const { enabled, base_dn, filter } = req.body;
  const cfg = {
    enabled: !!enabled,
    base_dn: base_dn?.trim() || '',
    filter:  filter?.trim()  || '(&(objectClass=user)(mobile=*))',
  };
  const db = getDb();
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('phonebook_ldap', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(JSON.stringify(cfg));
  // Clear stale LDAP contacts if disabled
  if (!cfg.enabled) {
    db.exec("DELETE FROM contacts WHERE source='ldap'");
  }
  auditService.log(req.user?.id, req.user?.username || 'system', 'phonebook:settings_update', 'phonebook', null, `enabled=${cfg.enabled}, base_dn=${cfg.base_dn || '(default)'}`, req.ip);
  res.json(cfg);
});

module.exports = router;
