const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const logger = require('../utils/logger');
const ldapService = require('./ldapService');

const JWT_SECRET  = process.env.JWT_SECRET  || 'changeme-insecure-default';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// Mappa dei permessi disponibili: chiave → label
const PERMISSION_KEYS = [
  'dashboard',
  'inbox',
  'sent',
  'send',
  'report',
  'devices',
  'ports',
  'rules',
  'settings',
  'users',   // gestione utenti (solo admin/superadmin)
  'api',     // accesso programmatico via API
];

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    displayName: user.display_name || user.displayName || user.username,
    role: user.role,
    permissions: user.permissions,
    allowed_ports: user.allowed_ports || [],
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Crea o aggiorna il superadmin dalle variabili d'ambiente */
function seedSuperAdmin() {
  const username = process.env.SUPERADMIN_USERNAME || 'sysadmin';
  const password = process.env.SUPERADMIN_PASSWORD || 'Password!';
  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('superadmin');
  const allPerms = Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
  const hash = hashPassword(password);

  if (existing) {
    db.prepare(`
      UPDATE users SET username=?, password_hash=?, permissions=?, updated_at=datetime('now')
      WHERE role='superadmin'
    `).run(username, hash, JSON.stringify(allPerms));
    logger.info(`[Auth] Superadmin aggiornato: ${username}`);
  } else {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, permissions)
      VALUES (?, ?, ?, 'superadmin', ?)
    `).run(uuidv4(), username, hash, JSON.stringify(allPerms));
    logger.info(`[Auth] Superadmin creato: ${username}`);
  }
}

async function login(username, password) {
  const db = getDb();

  // 1. Prova utente locale (source='local')
  const localUser = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND source = 'local'").get(username);
  if (localUser) {
    if (!verifyPassword(password, localUser.password_hash)) return null;
    const permissions = JSON.parse(localUser.permissions || '{}');
    return { token: signToken({ ...localUser, permissions }), user: safeUser({ ...localUser, permissions }) };
  }

  // 2. Prova autenticazione LDAP
  const ldapResult = await ldapService.authenticate(username, password);
  if (!ldapResult) return null;

  const permResult = ldapService.resolvePermissions(ldapResult.groups);
  if (!permResult) {
    logger.warn(`[Auth] LDAP user "${username}" authenticated but not in any mapped group`);
    return null;
  }

  const { role, permissions } = permResult;

  // 3. Upsert utente LDAP nel DB locale (per la lista utenti)
  let ldapUser = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND source = 'ldap'").get(ldapResult.username);
  if (!ldapUser) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, permissions, source, ldap_dn, display_name)
      VALUES (?, ?, '', ?, ?, 'ldap', ?, ?)
    `).run(id, ldapResult.username, role, JSON.stringify(permissions), ldapResult.dn || null, ldapResult.displayName || null);
    ldapUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } else {
    db.prepare(`
      UPDATE users SET role=?, permissions=?, ldap_dn=?, display_name=?, updated_at=datetime('now') WHERE id=?
    `).run(role, JSON.stringify(permissions), ldapResult.dn || null, ldapResult.displayName || null, ldapUser.id);
    ldapUser = db.prepare('SELECT * FROM users WHERE id = ?').get(ldapUser.id);
  }

  return {
    token: signToken({ ...ldapUser, permissions }),
    user:  safeUser({ ...ldapUser, permissions, groups: ldapResult.groups }),
  };
}

function safeUser(u) {
  const permissions = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions;
  const allowed_ports = typeof u.allowed_ports === 'string' ? JSON.parse(u.allowed_ports || '[]') : (u.allowed_ports || []);
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.displayName || u.username,
    role: u.role,
    permissions,
    source: u.source || 'local',
    groups: u.groups || [],
    allowed_ports,
  };
}

function getAllUsers() {
  const db = getDb();
  return db.prepare('SELECT id, username, display_name, role, permissions, allowed_ports, source, created_at FROM users ORDER BY created_at').all()
    .map(u => ({
      ...u,
      permissions: JSON.parse(u.permissions || '{}'),
      allowed_ports: JSON.parse(u.allowed_ports || '[]'),
      source: u.source || 'local',
    }));
}

function createUser(username, password, role, permissions, allowed_ports) {
  const db = getDb();
  const id = uuidv4();
  const hash = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, permissions, allowed_ports)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, username, hash, role, JSON.stringify(permissions || {}), JSON.stringify(allowed_ports || []));
  return id;
}

function updateUser(id, { password, role, permissions, allowed_ports }) {
  const db = getDb();
  const user = db.prepare('SELECT id, role, source FROM users WHERE id = ?').get(id);
  if (!user) throw new Error('User not found');
  if (user.role === 'superadmin') throw new Error('Cannot edit superadmin');
  if (user.source === 'ldap') throw new Error('Cannot edit LDAP user — permissions managed via LDAP groups');

  if (password) {
    db.prepare(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`)
      .run(hashPassword(password), id);
  }
  if (role !== undefined) {
    db.prepare(`UPDATE users SET role=?, updated_at=datetime('now') WHERE id=?`).run(role, id);
  }
  if (permissions !== undefined) {
    db.prepare(`UPDATE users SET permissions=?, updated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(permissions), id);
  }
  if (allowed_ports !== undefined) {
    db.prepare(`UPDATE users SET allowed_ports=?, updated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(allowed_ports), id);
  }
}

function deleteUser(id) {
  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (!user) throw new Error('User not found');
  if (user.role === 'superadmin') throw new Error('Cannot delete superadmin');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = { seedSuperAdmin, login, getAllUsers, createUser, updateUser, deleteUser, PERMISSION_KEYS, safeUser, verifyToken, signJwt: signToken };
