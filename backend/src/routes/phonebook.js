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
    "INSERT OR REPLACE INTO contacts (id, display_name, phone, source) VALUES (?, ?, ?, 'ldap')"
  );
  for (const c of contacts) {
    stmt.run(uuidv4(), c.display_name, c.phone);
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

  // If LDAP phonebook is enabled, auto-sync in background when there are no LDAP contacts yet
  if (pbCfg.enabled) {
    const ldapCount = db.prepare("SELECT COUNT(*) as cnt FROM contacts WHERE source='ldap'").get().cnt;
    if (ldapCount === 0) {
      // Kick off background sync — response returns from DB after it completes
      syncLdapToDb()
        .then(() => {
          const all = db.prepare("SELECT id, display_name, phone, email, notes, source FROM contacts ORDER BY display_name COLLATE NOCASE").all();
          res.json(all);
        })
        .catch(err => {
          logger.warn(`[Phonebook] Background LDAP sync failed: ${err.message}`);
          const local = db.prepare("SELECT id, display_name, phone, email, notes, source FROM contacts WHERE source='local' ORDER BY display_name COLLATE NOCASE").all();
          res.json(local);
        });
      return;
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
  try {
    const contacts = await syncLdapToDb();
    res.json(contacts);
  } catch (err) {
    logger.warn(`[Phonebook] LDAP sync error: ${err.message}`);
    res.status(502).json({ error: err.message });
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
