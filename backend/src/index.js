const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');

const logger = require('./utils/logger');
const { getDb } = require('./db/database');
const { initWebSocket } = require('./services/wsService');
const deviceManager = require('./services/deviceManager');
const { encrypt, isEncrypted } = require('./utils/encryption');

const messagesRouter = require('./routes/messages');
const portsRouter    = require('./routes/ports');
const devicesRouter  = require('./routes/devices');
const rulesRouter    = require('./routes/rules');
const settingsRouter = require('./routes/settings');
const reportRouter   = require('./routes/report');
const authRouter     = require('./routes/auth');
const usersRouter    = require('./routes/users');
const auditRouter    = require('./routes/audit');
const groupsRouter   = require('./routes/localGroups');
const { requireAuth } = require('./middleware/authMiddleware');
const { seedSuperAdmin } = require('./services/authService');

// Ensure data and logs directories exist
['data', 'logs'].forEach((dir) => {
  const p = path.join(__dirname, '..', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Init DB schema
getDb();

// Seed superadmin (da .env)
seedSuperAdmin();

// Migrazione password in chiaro → cifrate (eseguita una volta sola)
(function migratePasswords() {
  const db = getDb();
  // Cifra password dispositivi in chiaro
  const devices = db.prepare('SELECT id, password FROM devices').all();
  for (const d of devices) {
    if (d.password && !isEncrypted(d.password)) {
      db.prepare('UPDATE devices SET password=? WHERE id=?').run(encrypt(d.password), d.id);
    }
  }
  // Cifra SMTP_PASS in chiaro
  const smtpRow = db.prepare("SELECT value FROM settings WHERE key='SMTP_PASS'").get();
  if (smtpRow?.value && !isEncrypted(smtpRow.value)) {
    db.prepare("UPDATE settings SET value=? WHERE key='SMTP_PASS'").run(encrypt(smtpRow.value));
  }
  logger.info('[Migration] Password encryption check completed');
})();

// Express app
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // necessario per SAML callback (form POST IdP)

// API routes — auth (pubblica)
app.use('/api/auth', authRouter);

// Tutte le route successive richiedono un token JWT valido
app.use('/api', requireAuth);

app.use('/api/messages', messagesRouter);
app.use('/api/ports',    portsRouter);
app.use('/api/devices',  devicesRouter);
app.use('/api/rules',    rulesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/report',   reportRouter);
app.use('/api/users',    usersRouter);
app.use('/api/audit',    auditRouter);
app.use('/api/groups',   groupsRouter);

// Health check
app.get('/api/health', (req, res) => {
  const statuses = deviceManager.statusAll();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    devices: statuses.map(d => ({ id: d.id, name: d.name, connected: d.connected })),
  });
});

// Serve frontend static files in production
const frontendBuild = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendBuild)) {
  app.use(express.static(frontendBuild));
  app.get('*', (req, res) => res.sendFile(path.join(frontendBuild, 'index.html')));
}

// HTTP server + WebSocket
const PORT = process.env.PORT || 4673;
// Increase maxHeaderSize to 64 KB to accommodate large JWTs (e.g. LDAP users with many groups)
const server = http.createServer({ maxHeaderSize: 65536 }, app);
initWebSocket(server);

// Start server then boot device manager
server.listen(PORT, '0.0.0.0', async () => {
  logger.info(`GB SMS Gateway backend running on port ${PORT} (0.0.0.0)`);
  await deviceManager.init();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  deviceManager.disconnectAll();
  server.close(() => process.exit(0));
});
