const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/authMiddleware');
const ldapService = require('../services/ldapService');
const logger = require('../utils/logger');

const router = express.Router();

/* ─── Helpers ─────────────────────────────────────────────────── */

function getPhonebookLdapCfg() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key='phonebook_ldap'").get();
  return row ? JSON.parse(row.value) : { enabled: false, base_dn: '', filter: '(&(objectClass=user)(mobile=*))' };
}

/** Sync LDAP contacts into the contacts table (replaces all source='ldap' rows). */
async function syncLdapToDb() {
  const contacts = await ldapService.searchPhonebook();
  const db = getDb();
  db.exec("DELETE FROM contacts WHERE source='ldap'");
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO contacts (id, display_name, phone, email, source) VALUES (?, ?, ?, ?, 'ldap')"
  );
  for (const c of contacts) {
    stmt.run(uuidv4(), c.display_name, c.phone, c.email || null);
  }
  logger.info(`[Phonebook] Synced ${contacts.length} LDAP contact(s) to local DB`);
  return contacts;
}

/* ─── Background sync job state (in-memory singleton) ─────────── */

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

/* ─── Periodic LDAP sync scheduler ───────────────────────────── */
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

/* ─── GET /api/phonebook — all contacts (requires phonebook perm or admin) ─── */
router.get('/', (req, res) => {
  const { role, permissions } = req.user;
  const isAdmin = role === 'superadmin' || role === 'admin';
  if (!isAdmin && !permissions?.phonebook) {
    return res.status(403).json({ error: 'Phonebook access not granted' });
  }

  const db = getDb();
  const pbCfg = getPhonebookLdapCfg();

  // If LDAP phonebook is enabled and DB has no LDAP contacts yet, kick off a background sync.
  // Response is immediate — client picks up synced contacts on the next request.
  if (pbCfg.enabled) {
    const ldapCount = db.prepare("SELECT COUNT(*) as cnt FROM contacts WHERE source='ldap'").get().cnt;
    if (ldapCount === 0) startSyncJob();
  }

  const contacts = db.prepare(
    "SELECT id, display_name, phone, email, notes, source FROM contacts ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json(contacts);
});

/* ─── GET /api/phonebook/local — local contacts list (admin only) ─── */
router.get('/local', requireAdmin, (req, res) => {
  const db = getDb();
  const contacts = db.prepare(
    "SELECT * FROM contacts WHERE source='local' ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json(contacts);
});

/* ─── POST /api/phonebook/local — create local contact (admin only) ─── */
router.post('/local', requireAdmin, (req, res) => {
  const { display_name, phone, email, notes } = req.body;
  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!phone?.trim())        return res.status(400).json({ error: 'phone is required' });

  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO contacts (id, display_name, phone, email, notes, source) VALUES (?, ?, ?, ?, ?, 'local')"
  ).run(id, display_name.trim(), phone.trim(), email?.trim() || null, notes?.trim() || null);

  res.status(201).json({ id, display_name: display_name.trim(), phone: phone.trim(), email: email?.trim() || null, notes: notes?.trim() || null, source: 'local' });
});

/* ─── PUT /api/phonebook/local/:id — update local contact (admin only) ─── */
router.put('/local/:id', requireAdmin, (req, res) => {
  const { display_name, phone, email, notes } = req.body;
  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!phone?.trim())        return res.status(400).json({ error: 'phone is required' });

  const db = getDb();
  const info = db.prepare(
    "UPDATE contacts SET display_name=?, phone=?, email=?, notes=?, updated_at=datetime('now') WHERE id=? AND source='local'"
  ).run(display_name.trim(), phone.trim(), email?.trim() || null, notes?.trim() || null, req.params.id);

  if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  res.json({ id: req.params.id, display_name: display_name.trim(), phone: phone.trim(), source: 'local' });
});

/* ─── DELETE /api/phonebook/local/:id — delete local contact (admin only) ─── */
router.delete('/local/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const info = db.prepare("DELETE FROM contacts WHERE id=? AND source='local'").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true });
});

/* ─── POST /api/phonebook/ldap/sync — start background LDAP sync (admin only) ─── */
router.post('/ldap/sync', requireAdmin, (req, res) => {
  if (syncState.status === 'running') {
    return res.json({ status: 'already_running', ...syncState });
  }
  startSyncJob();
  res.json({ status: 'started', ...syncState });
});

/* ─── GET /api/phonebook/ldap/status — current sync job state (admin only) ─── */
router.get('/ldap/status', requireAdmin, (req, res) => {
  res.json(syncState);
});

/* ─── GET /api/phonebook/ldap — returns DB contacts + current sync state (admin only) ─── */
router.get('/ldap', requireAdmin, (req, res) => {
  const db = getDb();
  const contacts = db.prepare(
    "SELECT id, display_name, phone, email, source FROM contacts WHERE source='ldap' ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json({ synced: contacts.length, contacts, syncStatus: syncState });
});

/* ─── GET /api/phonebook/settings — phonebook LDAP settings (admin only) ─── */
router.get('/settings', requireAdmin, (req, res) => {
  res.json(getPhonebookLdapCfg());
});

/* ─── PUT /api/phonebook/settings — save phonebook LDAP settings (admin only) ─── */
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
  res.json(cfg);
});

module.exports = router;


/* ─── Helpers ─────────────────────────────────────────────────── */

function getPhonebookLdapCfg() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key='phonebook_ldap'").get();
  return row ? JSON.parse(row.value) : { enabled: false, base_dn: '', filter: '(&(objectClass=user)(mobile=*))' };
}

/** Sync LDAP contacts into the contacts table (replaces all source='ldap' rows). */
async function syncLdapToDb() {
  const contacts = await ldapService.searchPhonebook();
  const db = getDb();
  db.exec("DELETE FROM contacts WHERE source='ldap'");
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO contacts (id, display_name, phone, email, source) VALUES (?, ?, ?, ?, 'ldap')"
  );
  for (const c of contacts) {
    stmt.run(uuidv4(), c.display_name, c.phone, c.email || null);
  }
  logger.info(`[Phonebook] Synced ${contacts.length} LDAP contact(s) to local DB`);
  return contacts;
}

/* ─── GET /api/phonebook — all contacts (requires phonebook perm or admin) ─── */
router.get('/', (req, res) => {
  const { role, permissions } = req.user;
  const isAdmin = role === 'superadmin' || role === 'admin';
  if (!isAdmin && !permissions?.phonebook) {
    return res.status(403).json({ error: 'Phonebook access not granted' });
  }

  const db = getDb();
  const pbCfg = getPhonebookLdapCfg();

  // If LDAP phonebook is enabled, kick off a background sync when there are no LDAP contacts yet.
  // The response is sent IMMEDIATELY with whatever is in the DB — the sync runs in the background
  // and the client will get the updated contacts on the next load.
  if (pbCfg.enabled) {
    const ldapCount = db.prepare("SELECT COUNT(*) as cnt FROM contacts WHERE source='ldap'").get().cnt;
    if (ldapCount === 0) {
      // Fire-and-forget: do NOT await, send response right away
      syncLdapToDb().catch(err =>
        logger.warn(`[Phonebook] Background LDAP auto-sync failed: ${err.message}`)
      );
    }
  }

  const contacts = db.prepare(
    "SELECT id, display_name, phone, email, notes, source FROM contacts ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json(contacts);
});

/* ─── GET /api/phonebook/local — local contacts list (admin only) ─── */
router.get('/local', requireAdmin, (req, res) => {
  const db = getDb();
  const contacts = db.prepare(
    "SELECT * FROM contacts WHERE source='local' ORDER BY display_name COLLATE NOCASE"
  ).all();
  res.json(contacts);
});

/* ─── POST /api/phonebook/local — create local contact (admin only) ─── */
router.post('/local', requireAdmin, (req, res) => {
  const { display_name, phone, email, notes } = req.body;
  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!phone?.trim())        return res.status(400).json({ error: 'phone is required' });

  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO contacts (id, display_name, phone, email, notes, source) VALUES (?, ?, ?, ?, ?, 'local')"
  ).run(id, display_name.trim(), phone.trim(), email?.trim() || null, notes?.trim() || null);

  res.status(201).json({ id, display_name: display_name.trim(), phone: phone.trim(), email: email?.trim() || null, notes: notes?.trim() || null, source: 'local' });
});

/* ─── PUT /api/phonebook/local/:id — update local contact (admin only) ─── */
router.put('/local/:id', requireAdmin, (req, res) => {
  const { display_name, phone, email, notes } = req.body;
  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!phone?.trim())        return res.status(400).json({ error: 'phone is required' });

  const db = getDb();
  const info = db.prepare(
    "UPDATE contacts SET display_name=?, phone=?, email=?, notes=?, updated_at=datetime('now') WHERE id=? AND source='local'"
  ).run(display_name.trim(), phone.trim(), email?.trim() || null, notes?.trim() || null, req.params.id);

  if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  res.json({ id: req.params.id, display_name: display_name.trim(), phone: phone.trim(), source: 'local' });
});

/* ─── DELETE /api/phonebook/local/:id — delete local contact (admin only) ─── */
router.delete('/local/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const info = db.prepare("DELETE FROM contacts WHERE id=? AND source='local'").run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true });
});

/* ─── GET /api/phonebook/ldap — force-sync LDAP contacts (admin only) ─── */
router.get('/ldap', requireAdmin, async (req, res) => {
  // Hard timeout: if the LDAP server hangs, return 504 after 90 seconds
  const SYNC_TIMEOUT_MS = 90_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    logger.warn('[Phonebook] LDAP sync timed out after 90s');
    if (!res.headersSent) res.status(504).json({ error: 'LDAP sync timed out (90s). Check AD connectivity.' });
  }, SYNC_TIMEOUT_MS);

  try {
    const contacts = await syncLdapToDb();
    clearTimeout(timer);
    if (!timedOut) res.json({ synced: contacts.length, contacts });
  } catch (err) {
    clearTimeout(timer);
    logger.warn(`[Phonebook] LDAP sync error: ${err.message}`);
    if (!timedOut) res.status(502).json({ error: err.message });
  }
});

/* ─── GET /api/phonebook/settings — phonebook LDAP settings (admin only) ─── */
router.get('/settings', requireAdmin, (req, res) => {
  res.json(getPhonebookLdapCfg());
});

/* ─── PUT /api/phonebook/settings — save phonebook LDAP settings (admin only) ─── */
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
  res.json(cfg);
});

module.exports = router;
