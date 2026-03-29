const path = require('path');
// TZ must be set BEFORE any other require so all Date operations use the correct timezone.
// Priority: DB setting (configured via UI) > .env TZ > system default.
// The .env value acts as the *initial* default on first startup; once saved via the UI it is
// persisted in the DB and applied here, overriding .env on every subsequent restart.
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
const groupsRouter      = require('./routes/localGroups');
const phonebookRouter   = require('./routes/phonebook');
const { requireAuth } = require('./middleware/authMiddleware');
const { seedSuperAdmin } = require('./services/authService');
const openApiSpec = require('./openapi');

// Ensure data and logs directories exist
['data', 'logs'].forEach((dir) => {
  const p = path.join(__dirname, '..', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Init DB schema
getDb();

// Apply timezone from DB setting (set via UI) — takes effect for all subsequent Date operations.
// Note: TZ from .env (if any) was already applied at process start; the DB value overrides it.
{
  const { getSetting } = require('./db/database');
  const dbTz = getSetting('TZ');
  if (dbTz) {
    process.env.TZ = dbTz;
  }
}

// Log effective timezone so operators can verify at startup
{
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC (system default)';
  const localNow = new Date().toLocaleString('it-IT', { timeZoneName: 'short' });
  // Use a direct console.log here since logger may not be fully ready yet
  console.log(`[startup] Timezone: ${tz} — local time: ${localNow}`);
}

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

// Swagger UI — served from local node_modules (no CDN, no CSP issues)
const swaggerDistPath = path.join(__dirname, '../node_modules/swagger-ui-dist');

// Expose the OpenAPI spec as JSON — only for admin/superadmin or users with api permission
app.get('/api/docs.json', requireAuth, (req, res) => {
  const role = req.user.role;
  const perms = req.user.permissions || {};
  if (role !== 'admin' && role !== 'superadmin' && !perms.api) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(openApiSpec);
});

// Override CSP for /docs — Helmet's default blocks inline scripts required by swagger-ui
app.use('/docs', (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  );
  next();
});

// Swagger UI wrapper HTML — MUST be registered before express.static catch-all
// NOTE: express non-strict routing makes '/docs' match '/docs/' too, causing a redirect loop.
// Use an array of paths to serve HTML directly without any redirect.
app.get(['/docs', '/docs/'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SMS Gateway — API Docs</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css" />
  <style>
    /* ── Reset & page layout ── */
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; min-height: 100%; }
    body {
      background: #0f1117;
      color: #e2e8f0;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    }

    /* ── Custom header bar ── */
    #docs-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 32px;
      background: #1a1d27;
      border-bottom: 1px solid #2d3044;
      position: sticky;
      top: 0;
      z-index: 999;
    }
    #docs-header .logo {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #6366f1, #818cf8);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    #docs-header h1 {
      margin: 0; font-size: 17px; font-weight: 600; color: #f1f5f9;
      letter-spacing: -0.01em;
    }
    #docs-header .badge {
      margin-left: auto;
      background: #6366f1;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 20px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* ── Swagger UI wrapper ── */
    #swagger-ui { max-width: 1200px; margin: 0 auto; padding: 28px 24px 60px; }

    /* ── Hide the default topbar ── */
    .swagger-ui .topbar { display: none !important; }

    /* ── Scheme/server select bar ── */
    .swagger-ui .scheme-container {
      background: #1a1d27 !important;
      border: 1px solid #2d3044 !important;
      border-radius: 10px !important;
      padding: 14px 20px !important;
      box-shadow: none !important;
      margin-bottom: 20px !important;
    }

    /* ── Info block ── */
    .swagger-ui .info { margin-bottom: 24px; }
    .swagger-ui .info .title { color: #f1f5f9 !important; font-size: 26px !important; font-weight: 700 !important; }
    .swagger-ui .info p, .swagger-ui .info li,
    .swagger-ui .info .description p { color: #94a3b8 !important; }
    .swagger-ui .info a { color: #818cf8 !important; }
    .swagger-ui .info .base-url { color: #64748b !important; }

    /* ── Section headers (tags) ── */
    .swagger-ui .opblock-tag {
      background: #1a1d27 !important;
      border: 1px solid #2d3044 !important;
      border-radius: 10px !important;
      margin-bottom: 8px !important;
      padding: 12px 18px !important;
      color: #e2e8f0 !important;
      font-size: 15px !important;
      font-weight: 600 !important;
    }
    .swagger-ui .opblock-tag:hover { background: #1e2234 !important; }
    .swagger-ui .opblock-tag small { color: #94a3b8 !important; font-weight: 400 !important; }

    /* ── Operation blocks ── */
    .swagger-ui .opblock {
      border-radius: 8px !important;
      border: 1px solid #2d3044 !important;
      margin-bottom: 6px !important;
      box-shadow: none !important;
      background: #161924 !important;
    }
    .swagger-ui .opblock .opblock-summary {
      border-bottom: none !important;
      padding: 10px 14px !important;
    }
    .swagger-ui .opblock .opblock-summary-description { color: #94a3b8 !important; }
    .swagger-ui .opblock .opblock-summary-path { color: #e2e8f0 !important; }
    .swagger-ui .opblock.is-open { border-color: #4f52a0 !important; }
    .swagger-ui .opblock-body { background: #1a1d27 !important; border-radius: 0 0 8px 8px !important; }

    /* ── HTTP method badges ── */
    .swagger-ui .opblock-summary-method {
      border-radius: 6px !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      min-width: 72px !important;
      text-align: center !important;
    }
    .swagger-ui .opblock.opblock-get    .opblock-summary-method { background: #1e3a5f !important; color: #60a5fa !important; }
    .swagger-ui .opblock.opblock-post   .opblock-summary-method { background: #1a3a2a !important; color: #4ade80 !important; }
    .swagger-ui .opblock.opblock-put    .opblock-summary-method { background: #3a2e1a !important; color: #fb923c !important; }
    .swagger-ui .opblock.opblock-patch  .opblock-summary-method { background: #2e2a1a !important; color: #fbbf24 !important; }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #3a1a1a !important; color: #f87171 !important; }

    /* ── "Try it out" / Execute buttons ── */
    .swagger-ui .btn { border-radius: 6px !important; font-weight: 600 !important; }
    .swagger-ui .btn.try-out__btn,
    .swagger-ui .btn.execute       { background: #6366f1 !important; color: #fff !important; border: none !important; }
    .swagger-ui .btn.try-out__btn:hover,
    .swagger-ui .btn.execute:hover { background: #4f46e5 !important; }
    .swagger-ui .btn.cancel        { background: transparent !important; color: #f87171 !important; border-color: #f87171 !important; }

    /* ── Authorize button ── */
    .swagger-ui .auth-wrapper .authorize { border-color: #6366f1 !important; color: #818cf8 !important; }
    .swagger-ui .auth-wrapper .authorize svg { fill: #818cf8 !important; }

    /* ── Parameters / response tables ── */
    .swagger-ui table thead tr th { background: #1e2234 !important; color: #94a3b8 !important; border-color: #2d3044 !important; }
    .swagger-ui table tbody tr td { background: #161924 !important; color: #cbd5e1 !important; border-color: #2d3044 !important; }
    .swagger-ui .parameter__name { color: #e2e8f0 !important; }
    .swagger-ui .parameter__type { color: #818cf8 !important; }
    .swagger-ui .parameter__in   { color: #64748b !important; }

    /* ── Response codes ── */
    .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { color: #e2e8f0 !important; }
    .swagger-ui .response-col_status { color: #4ade80 !important; font-weight: 700 !important; }
    .swagger-ui .response-col_description { color: #94a3b8 !important; }

    /* ── Code/JSON blocks ── */
    .swagger-ui .microlight, .swagger-ui textarea,
    .swagger-ui .highlight-code { background: #0d1117 !important; color: #c9d1d9 !important; border-radius: 6px !important; }

    /* ── Input fields ── */
    .swagger-ui input[type=text], .swagger-ui input[type=password],
    .swagger-ui select, .swagger-ui textarea {
      background: #0f1117 !important;
      color: #e2e8f0 !important;
      border: 1px solid #2d3044 !important;
      border-radius: 6px !important;
    }

    /* ── Model/schema section ── */
    .swagger-ui section.models { background: #1a1d27 !important; border: 1px solid #2d3044 !important; border-radius: 10px !important; }
    .swagger-ui section.models h4 { color: #e2e8f0 !important; }
    .swagger-ui .model-box { background: #161924 !important; border-radius: 6px !important; }
    .swagger-ui .model-title { color: #818cf8 !important; }
    .swagger-ui .prop-type  { color: #60a5fa !important; }
    .swagger-ui .prop-format{ color: #64748b !important; }

    /* ── Auth banner ── */
    #auth-banner {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 10px 32px;
      background: #1a2e1a;
      border-bottom: 1px solid #2d5a2d;
      font-size: 13px;
      color: #86efac;
    }
    #auth-banner.visible { display: flex; }
    #auth-banner .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #4ade80; flex-shrink: 0;
    }
    #auth-banner strong { color: #bbf7d0; }
    #auth-banner .copy-btn {
      margin-left: auto;
      background: transparent;
      border: 1px solid #2d5a2d;
      color: #86efac;
      border-radius: 6px;
      padding: 4px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s;
    }
    #auth-banner .copy-btn:hover { background: #2d5a2d; }

    #no-auth-banner {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 10px 32px;
      background: #1e1a10;
      border-bottom: 1px solid #4a3800;
      font-size: 13px;
      color: #fbbf24;
    }
    #no-auth-banner.visible { display: flex; }
    #no-auth-banner .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #f59e0b; flex-shrink: 0;
    }

    /* ── Authorize button highlight when not authed ── */
    body.not-authed .swagger-ui .auth-wrapper .authorize {
      border-color: #f59e0b !important;
      color: #fbbf24 !important;
      animation: pulse-border 2s infinite;
    }
    body.not-authed .swagger-ui .auth-wrapper .authorize svg { fill: #fbbf24 !important; }
    @keyframes pulse-border {
      0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.4); }
      50%       { box-shadow: 0 0 0 4px rgba(245,158,11,0); }
    }
  </style>
</head>
<body>
  <div id="docs-header">
    <div class="logo">📡</div>
    <h1>SMS Gateway &mdash; API Reference</h1>
    <span class="badge">v1</span>
  </div>

  <!-- Shown when already logged in -->
  <div id="auth-banner">
    <div class="dot"></div>
    <span>Logged in as <strong id="auth-user"></strong> &mdash; token auto-injected into all requests.</span>
    <button class="copy-btn" onclick="copyToken()">Copy token</button>
  </div>

  <!-- Shown when not logged in -->
  <div id="no-auth-banner">
    <div class="dot"></div>
    <span>
      Not authenticated. Click <strong>Authorize 🔓</strong> and paste your JWT token, or
      <a href="/" style="color:#fbbf24;text-decoration:underline">log in to the app</a> first
      and return here — the token will be injected automatically.
      &nbsp;&nbsp;<strong>How to get a token:</strong>
      POST <code style="background:#2a200a;padding:1px 6px;border-radius:4px">/api/auth/login</code>
      with <code style="background:#2a200a;padding:1px 6px;border-radius:4px">{"username":"…","password":"…"}</code>
      and copy the <code style="background:#2a200a;padding:1px 6px;border-radius:4px">token</code> field from the response.
    </span>
  </div>

  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
    // Authorization guard — runs synchronously before Swagger UI initializes
    (function guardDocs() {
      var token = localStorage.getItem('jwt_token') || sessionStorage.getItem('jwt_token') || '';
      if (!token) { window.location.replace('/'); return; }
      var payload = null;
      try {
        var b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        payload = JSON.parse(atob(b64));
      } catch(e) { window.location.replace('/'); return; }
      var role  = payload.role || '';
      var perms = payload.permissions || {};
      var allowed = role === 'admin' || role === 'superadmin' || perms.api === true;
      if (!allowed) {
        document.body.innerHTML = [
          '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f1117;font-family:system-ui,sans-serif;">',
          '  <div style="text-align:center;color:#f1f5f9;max-width:420px;padding:40px;">',
          '    <div style="font-size:64px;margin-bottom:16px;">&#x1F512;</div>',
          '    <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f87171;">Access Denied</h1>',
          '    <p style="color:#94a3b8;margin:0 0 28px;line-height:1.6;">You do not have permission to access the API documentation. Contact your administrator if you need access.</p>',
          '    <a href="/" style="display:inline-block;padding:10px 28px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Back to App</a>',
          '  </div>',
          '</div>'
        ].join('');
      }
    })();

    // Read JWT from localStorage (same key used by the React app)
    function getStoredToken() {
      return localStorage.getItem('jwt_token') || sessionStorage.getItem('jwt_token') || '';
    }

    function getStoredUser() {
      try {
        const u = JSON.parse(localStorage.getItem('jwt_user') || sessionStorage.getItem('jwt_user') || 'null');
        return u?.username || u?.name || '';
      } catch { return ''; }
    }

    function copyToken() {
      const t = getStoredToken();
      if (!t) return;
      const btn = document.querySelector('.copy-btn');
      const done = () => { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy token', 1500); };
      const fail = () => { btn.textContent = 'Error!';  setTimeout(() => btn.textContent = 'Copy token', 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done, fail));
      } else {
        fallbackCopy(t, done, fail);
      }
    }
    function fallbackCopy(text, done, fail) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy') ? done() : fail(); } catch(e) { fail(); }
      document.body.removeChild(ta);
    }

    window.onload = function () {
      const token = getStoredToken();
      const user  = getStoredUser();

      if (token) {
        document.getElementById('auth-banner').classList.add('visible');
        document.getElementById('auth-user').textContent = user || 'user';
      } else {
        document.getElementById('no-auth-banner').classList.add('visible');
        document.body.classList.add('not-authed');
      }

      const ui = SwaggerUIBundle({
        url: '/api/docs.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        tryItOutEnabled: false,
        // Auto-inject the token if the user is already logged in
        requestInterceptor: (req) => {
          const t = getStoredToken();
          if (t && !req.headers['Authorization']) {
            req.headers['Authorization'] = 'Bearer ' + t;
          }
          return req;
        },
        onComplete: () => {
          // Pre-fill the Authorize dialog with the stored token so the lock icon reflects auth state
          const t = getStoredToken();
          if (t) {
            ui.preauthorizeApiKey('BearerAuth', t);
          }
        },
      });
    };
  </script>
</body>
</html>`);
});
// Serve swagger-ui-dist assets (CSS, JS, etc.) from local node_modules
app.use('/docs', express.static(swaggerDistPath));

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
app.use('/api/audit',     auditRouter);
app.use('/api/groups',    groupsRouter);
app.use('/api/phonebook', phonebookRouter);

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
