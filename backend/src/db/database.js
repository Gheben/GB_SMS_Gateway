const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/smsgateway.db');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`PRAGMA journal_mode = WAL`);
    db.exec(`PRAGMA foreign_keys = ON`);
    initSchema();
    logger.info(`Database connected: ${DB_PATH}`);
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Dispositivi Yeastar (uno per ogni GSM gateway)
    CREATE TABLE IF NOT EXISTS devices (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      host        TEXT NOT NULL,
      port        INTEGER NOT NULL DEFAULT 5038,
      username    TEXT NOT NULL DEFAULT 'apiuser',
      password    TEXT NOT NULL DEFAULT 'apipass',
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Messaggi SMS (inbound e outbound)
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      device_id   TEXT REFERENCES devices(id),
      direction   TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      port        INTEGER,
      sender      TEXT,
      recipient   TEXT,
      content     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      gsm_id      TEXT,
      smsc        TEXT,
      received_at TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Porte SIM per dispositivo
    CREATE TABLE IF NOT EXISTS ports (
      device_id   TEXT NOT NULL REFERENCES devices(id),
      port_number INTEGER NOT NULL,
      label       TEXT,
      sim_number  TEXT,
      operator    TEXT,
      signal      INTEGER,
      status      TEXT,
      imei        TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (device_id, port_number)
    );

    -- Regole di routing/inoltro SMS
    CREATE TABLE IF NOT EXISTS routing_rules (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      enabled            INTEGER NOT NULL DEFAULT 1,
      priority           INTEGER NOT NULL DEFAULT 0,
      condition_operator TEXT NOT NULL DEFAULT 'AND',
      action             TEXT NOT NULL DEFAULT 'email',
      stop_on_match      INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Condizioni multiple per regola (combinate con AND o OR)
    CREATE TABLE IF NOT EXISTS rule_conditions (
      id          TEXT PRIMARY KEY,
      rule_id     TEXT NOT NULL REFERENCES routing_rules(id) ON DELETE CASCADE,
      match_type  TEXT NOT NULL DEFAULT 'sender',
      match_value TEXT,
      device_id   TEXT REFERENCES devices(id),
      sort_order  INTEGER NOT NULL DEFAULT 0
    );

    -- Destinatari email per ogni regola (una regola può avere N email)
    CREATE TABLE IF NOT EXISTS rule_targets (
      id       TEXT PRIMARY KEY,
      rule_id  TEXT NOT NULL REFERENCES routing_rules(id) ON DELETE CASCADE,
      email    TEXT NOT NULL
    );

    -- Log degli inoltri email eseguiti per ogni SMS
    CREATE TABLE IF NOT EXISTS dispatches (
      id         TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      rule_id    TEXT REFERENCES routing_rules(id),
      email      TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      error      TEXT,
      sent_at    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_device    ON messages(device_id);
    CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
    CREATE INDEX IF NOT EXISTS idx_messages_created   ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_status    ON messages(status);
    CREATE INDEX IF NOT EXISTS idx_dispatches_message ON dispatches(message_id);
    CREATE INDEX IF NOT EXISTS idx_rules_priority     ON routing_rules(priority DESC);

    -- Impostazioni applicazione (chiave-valore)
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT ''
    );
  `);

  // Tabella utenti per login e controllo accessi
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('superadmin','admin','user')),
      permissions TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations: add columns that did not exist in earlier schema versions
  try { db.exec(`ALTER TABLE messages ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`); } catch (_) { /* already exists */ }
  try { db.exec(`ALTER TABLE ports ADD COLUMN carrier TEXT`); } catch (_) { /* already exists */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN source TEXT NOT NULL DEFAULT 'local'`); } catch (_) { /* already exists */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN ldap_dn TEXT`); } catch (_) { /* already exists */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`); } catch (_) { /* already exists */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN allowed_ports TEXT NOT NULL DEFAULT '[]'`); } catch (_) { /* already exists */ }
  try { db.exec(`ALTER TABLE routing_rules ADD COLUMN allowed_groups TEXT NOT NULL DEFAULT '[]'`); } catch (_) { /* already exists */ }

  // Local groups tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      role        TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      permissions TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_group_members (
      group_id TEXT NOT NULL REFERENCES local_groups(id) ON DELETE CASCADE,
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    );
  `);

  // Audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            TEXT PRIMARY KEY,
      user_id       TEXT,
      username      TEXT NOT NULL,
      action        TEXT NOT NULL,
      resource_type TEXT,
      resource_id   TEXT,
      detail        TEXT,
      ip            TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations for new columns
  try { db.exec(`ALTER TABLE routing_rules ADD COLUMN allowed_local_groups TEXT NOT NULL DEFAULT '[]'`); } catch (_) { /* already exists */ }
}

/** Legge una singola impostazione dal DB, con fallback a process.env o default */
function getSetting(key, fallback) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  if (fallback !== undefined) return fallback;
  return process.env[key] || '';
}

/** Salva una o più impostazioni nel DB (upsert) */
function setSettings(obj) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) stmt.run(key, String(value));
  }
}

module.exports = { getDb, getSetting, setSettings };
