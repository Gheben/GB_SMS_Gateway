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

const messagesRouter = require('./routes/messages');
const portsRouter    = require('./routes/ports');
const devicesRouter  = require('./routes/devices');
const rulesRouter    = require('./routes/rules');
const settingsRouter = require('./routes/settings');
const reportRouter   = require('./routes/report');
const authRouter     = require('./routes/auth');
const usersRouter    = require('./routes/users');
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

// Express app
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(morgan('combined'));
app.use(express.json());

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
const server = http.createServer(app);
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
