const YeastarConnector = require('./yeastarConnector');
const { getDb } = require('../db/database');
const messageService = require('./messageService');
const routingEngine = require('./routingEngine');
const { broadcast } = require('./wsService');
const logger = require('../utils/logger');
const { decrypt } = require('../utils/encryption');

/**
 * DeviceManager
 * Loads all enabled devices from DB and keeps a live YeastarConnector per device.
 */
class DeviceManager {
  constructor() {
    /** @type {Map<string, YeastarConnector>} */
    this.connectors = new Map();
  }

  /** Boot: load all enabled devices from DB and connect */
  async init() {
    const db = getDb();
    const devices = db.prepare(`SELECT * FROM devices WHERE enabled = 1`).all();

    if (devices.length === 0) {
      logger.warn('No enabled devices found in DB. Add devices via API or UI.');
      return;
    }
    for (const device of devices) {
      this._startConnector(device);
    }
    this._startRetryScheduler();
  }

  /** Add or reload a single device (called after create/update via API) */
  reload(deviceId) {
    const db = getDb();
    const device = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(deviceId);
    if (!device) return;

    // Stop existing connector if present
    this.disconnect(deviceId);

    if (device.enabled) {
      this._startConnector(device);
    }
  }

  /** Gracefully disconnect a device */
  disconnect(deviceId) {
    const conn = this.connectors.get(deviceId);
    if (conn) {
      conn.disconnect();
      this.connectors.delete(deviceId);
      logger.info(`Device ${deviceId} disconnected and removed.`);
    }
  }

  /** Disconnect all */
  disconnectAll() {
    for (const [id] of this.connectors) {
      this.disconnect(id);
    }
  }

  /** Get connector by deviceId — used by send API */
  get(deviceId) {
    return this.connectors.get(deviceId) || null;
  }

  /** Returns status summary for all known devices */
  statusAll() {
    const db = getDb();
    const devices = db.prepare(`SELECT * FROM devices`).all();
    return devices.map((d) => ({
      ...d,
      password: undefined, // never expose
      connected: this.connectors.get(d.id)?.connected ?? false,
    }));
  }

  _startConnector(device) {
    const conn = new YeastarConnector({
      deviceId: device.id,
      host: device.host,
      port: device.port,
      username: device.username,
      secret: decrypt(device.password),
    });

    conn.on('connected', () => {
      logger.info(`[${device.name}] Connected to ${device.host}`);
      broadcast('device:connected', { deviceId: device.id, name: device.name });
      conn.requestPortStatus();
      // Query each port individually for detailed status
      conn.requestAllPortInfo();
    });

    conn.on('disconnected', () => {
      logger.warn(`[${device.name}] Disconnected from ${device.host}`);
      broadcast('device:disconnected', { deviceId: device.id, name: device.name });
    });

    conn.on('sms:received', async (sms) => {
      logger.info(`[${device.name}] Inbound SMS from ${sms.sender} on port ${sms.port}`);
      // Mark port READY (empirical confirmation it works)
      const db = getDb();
      db.prepare(`
        INSERT INTO ports (device_id, port_number, status, updated_at)
        VALUES (?, ?, 'READY', datetime('now'))
        ON CONFLICT(device_id, port_number) DO UPDATE SET
          status = 'READY',
          updated_at = datetime('now')
      `).run(device.id, sms.port);
      const msgId = messageService.saveInbound({ ...sms, deviceId: device.id });
      broadcast('sms:received', { ...sms, deviceId: device.id, localId: msgId, deviceName: device.name });
      // Run routing engine
      try {
        await routingEngine.process({ ...sms, deviceId: device.id, messageId: msgId });
      } catch (err) {
        logger.error(`Routing engine error: ${err.message}`);
      }
    });

    conn.on('sms:sent', (result) => {
      logger.info(`[${device.name}] SMS sent confirmation: id=${result.id} status=${result.status}`);
      messageService.updateOutboundStatus(result.id, result.status, result.smsc);
      // If send was confirmed, mark the port as READY (empirical confirmation it works)
      if (result.status === 'sent') {
        const db = getDb();
        const msg = db.prepare(`SELECT port FROM messages WHERE gsm_id = ? OR id = ? LIMIT 1`).get(result.id, result.id);
        if (msg?.port != null) {
          db.prepare(`
            INSERT INTO ports (device_id, port_number, status, updated_at)
            VALUES (?, ?, 'READY', datetime('now'))
            ON CONFLICT(device_id, port_number) DO UPDATE SET status = 'READY', updated_at = datetime('now')
          `).run(device.id, msg.port);
        }
      }
      broadcast('sms:sent', { ...result, deviceId: device.id });
    });

    conn.on('port:info', (data) => {
      const db = getDb();
      // operator e sim_number sono campi utente — non sovrascritti dal polling del dispositivo
      db.prepare(`
        INSERT INTO ports (device_id, port_number, status, signal, imei, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(device_id, port_number) DO UPDATE SET
          status = excluded.status,
          signal = excluded.signal,
          imei = COALESCE(excluded.imei, imei),
          updated_at = excluded.updated_at
      `).run(device.id, data.port, data.status, data.signal ?? null, data.imei);
      broadcast('port:info', { deviceId: device.id, ...data });
    });

    conn.on('ports:status', (rawData) => {
      broadcast('ports:status', { deviceId: device.id, raw: rawData });
    });

    conn.connect();
    this.connectors.set(device.id, conn);
    logger.info(`[${device.name}] Connector started → ${device.host}:${device.port}`);
  }

  _startRetryScheduler() {
    setInterval(() => this._retryPendingMessages(), 60_000);
    logger.info('Retry scheduler started (every 60s).');
  }

  _retryPendingMessages() {
    const stuck = messageService.getPendingStuck();
    if (stuck.length === 0) return;
    logger.info(`Retry scheduler: ${stuck.length} pending message(s) stuck > 5 min`);

    for (const msg of stuck) {
      if ((msg.retry_count ?? 0) >= 3) {
        logger.warn(`Message ${msg.id} exceeded max retries → marking failed`);
        messageService.markFailed(msg.id);
        broadcast('sms:sent', { id: msg.id, status: 'failed', deviceId: msg.device_id });
        continue;
      }

      const conn = this.connectors.get(msg.device_id);
      if (!conn || !conn.connected) {
        logger.warn(`Retry skipped: device ${msg.device_id} not connected (msg ${msg.id})`);
        continue;
      }

      messageService.incrementRetryCount(msg.id);
      const attempt = (msg.retry_count ?? 0) + 1;
      logger.info(`Retry ${attempt}/3 for msg ${msg.id} → ${msg.recipient} on port ${msg.port}`);

      try {
        const newGsmId = conn.sendSMS(msg.port, msg.recipient, msg.content);
        messageService.setGsmId(msg.id, newGsmId);
      } catch (err) {
        logger.error(`Retry send error for msg ${msg.id}: ${err.message}`);
      }
    }
  }
}

module.exports = new DeviceManager();
