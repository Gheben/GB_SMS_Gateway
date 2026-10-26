const { getDb, getSetting, setSettings } = require('../db/database');
const logger = require('../utils/logger');

// Outages shorter than this (e.g. a device reload) are not worth reporting
const MIN_OUTAGE_MS = 30_000;
// A gap between heartbeats larger than this means the gateway itself was down
const HEARTBEAT_MS = 30_000;
const GATEWAY_DOWN_THRESHOLD_MS = 90_000;
const RETENTION_DAYS = 90;

/**
 * Tracks the periods in which a device is not connected to the gateway.
 * The Yeastar TG API only pushes new SMS events (there is no command to read
 * messages received while offline), so these periods are the windows in which
 * inbound SMS may have been missed.
 */
class OutageService {
  open(deviceId, deviceName, reason = 'connection', startedAt = new Date().toISOString()) {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM device_outages WHERE device_id = ? AND ended_at IS NULL').get(deviceId);
    if (existing) return;
    db.prepare('INSERT INTO device_outages (device_id, device_name, started_at, reason) VALUES (?, ?, ?, ?)')
      .run(deviceId, deviceName, startedAt, reason);
  }

  /** Closes the open outage of a device. Very short ones are discarded. */
  close(deviceId) {
    const db = getDb();
    const row = db.prepare('SELECT id, started_at FROM device_outages WHERE device_id = ? AND ended_at IS NULL').get(deviceId);
    if (!row) return null;
    const now = new Date();
    if (now - new Date(row.started_at) < MIN_OUTAGE_MS) {
      db.prepare('DELETE FROM device_outages WHERE id = ?').run(row.id);
      return null;
    }
    db.prepare('UPDATE device_outages SET ended_at = ? WHERE id = ?').run(now.toISOString(), row.id);
    return { started_at: row.started_at, ended_at: now.toISOString() };
  }

  list(days = 7) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    return getDb().prepare(`
      SELECT id, device_id, device_name, started_at, ended_at, reason
      FROM device_outages
      WHERE ended_at IS NULL OR ended_at >= ?
      ORDER BY started_at DESC
      LIMIT 200
    `).all(since);
  }

  /**
   * If the gateway process was stopped (restart, crash, host down) the last heartbeat
   * is older than expected: record that window as an outage for every enabled device.
   */
  recordGatewayDowntime(devices) {
    const last = getSetting('GATEWAY_LAST_ALIVE', '');
    if (!last) return;
    const lastMs = new Date(last).getTime();
    if (isNaN(lastMs) || Date.now() - lastMs < GATEWAY_DOWN_THRESHOLD_MS) return;
    for (const d of devices) this.open(d.id, d.name, 'gateway', last);
    logger.warn(`[Outage] Gateway was not running since ${last}: inbound SMS received in this window may be missing`);
  }

  startHeartbeat() {
    const beat = () => {
      try { setSettings({ GATEWAY_LAST_ALIVE: new Date().toISOString() }); } catch (_) { /* db closing */ }
    };
    beat();
    setInterval(beat, HEARTBEAT_MS).unref();
    setInterval(() => {
      try {
        getDb().prepare(`DELETE FROM device_outages WHERE ended_at IS NOT NULL AND ended_at < datetime('now', '-${RETENTION_DAYS} days')`).run();
      } catch (_) { /* ignore */ }
    }, 24 * 3600 * 1000).unref();
  }
}

module.exports = new OutageService();
