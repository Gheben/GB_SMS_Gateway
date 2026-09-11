const { WebSocketServer } = require('ws');
const logger = require('../utils/logger');

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    logger.info(`WebSocket client connected from ${req.socket.remoteAddress}`);
    ws.send(JSON.stringify({ type: 'welcome', message: 'GB SMS Gateway connected' }));

    ws.on('error', (err) => logger.error(`WebSocket error: ${err.message}`));
    ws.on('close', () => logger.info('WebSocket client disconnected'));
  });

  logger.info('WebSocket server initialized on /ws');
}

function broadcast(type, payload) {
  if (!wss) return;
  const data = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(data);
    }
  }
}

module.exports = { initWebSocket, broadcast };
