const net = require('net');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Heuristic: returns true if `s` looks like a hex-encoded UCS-2 string even
 * when no DCS field was provided by the firmware.
 *
 * Criteria:
 *  - All hex digits, length divisible by 4 (≥4 chars = at least 1 UCS-2 pair)
 *  - More than half of the sampled 2-byte pairs have a null (0x00) high byte,
 *    which is characteristic of BMP characters (Latin, Cyrillic, Greek, CJK…)
 */
function _looksLikeUcs2Hex(s) {
  if (s.length < 4 || s.length % 4 !== 0) return false;
  if (!/^[0-9A-Fa-f]+$/.test(s)) return false;
  const sample = Math.min(Math.floor(s.length / 4), 12); // check up to 12 chars
  let nullHighBytes = 0;
  for (let i = 0; i < sample * 4; i += 4) {
    if (s[i] === '0' && s[i + 1] === '0') nullHighBytes++;
  }
  return nullHighBytes / sample > 0.5;
}

/**
 * Decode the Content field from a Yeastar AMI ReceivedSMS event.
 *
 * GSM DCS alphabet bits (bits 3-2 of the DCS byte):
 *   0 (0x00) → GSM-7 default  — Yeastar URL-encodes as UTF-8 (%XX)
 *   1 (0x04) → 8-bit data     — Yeastar hex-encodes raw bytes; decoded as ISO-8859-1
 *   2 (0x08) → UCS-2          — Yeastar hex-encodes UCS-2 Big-Endian pairs
 *                                Covers full BMP (è, à, ü, €, ™ …) and emoji
 *                                encoded as UTF-16 surrogate pairs (😀 = D83D DE00).
 *
 * Additionally, if the DCS field is absent/empty but Content matches the UCS-2 hex
 * heuristic (all-hex, even length, many null high bytes), UCS-2 decoding is tried
 * automatically to stay robust across different firmware versions.
 *
 * BOM handling:
 *   FEFF prefix → UCS-2 BE BOM (stripped; byte pairs already big-endian)
 *   FFFE prefix → UCS-2 LE BOM (stripped; no byte swap needed)
 *
 * @param {string} raw  - raw Content value from the AMI event
 * @param {string} dcs  - Dcs field value (decimal or "0x…" hex string, may be empty)
 * @returns {string}    - decoded Unicode text (UTF-8 / JavaScript string)
 */
function _decodeSmsContent(raw, dcs) {
  // Accept both decimal ('8') and hex ('0x08') DCS representations from firmware
  const dcsNum = /^0x/i.test(dcs) ? parseInt(dcs, 16) : parseInt(dcs, 10);
  // Bits 3-2 of the DCS byte indicate the character set alphabet:
  //   >> 2: 0 = GSM-7,  1 = 8-bit,  2 = UCS-2,  3 = reserved
  const dcsAlphabet = isNaN(dcsNum) ? -1 : (dcsNum & 0x0C) >> 2;

  // ── UCS-2 (alphabet = 2, or heuristic when DCS is absent) ─────────────────
  // Covers accented characters (è à ü ñ …), Arabic/Greek/Cyrillic scripts,
  // CJK ideographs, and emoji encoded as UTF-16 surrogate pairs.
  if (dcsAlphabet === 2 || (dcsAlphabet === -1 && _looksLikeUcs2Hex(raw))) {
    if (dcsAlphabet === -1) {
      logger.info(`[SMS decode] No DCS but Content matches UCS-2 hex heuristic — trying UCS-2`);
    }
    try {
      let hexStr = raw;
      let littleEndian = false;

      // Strip BOM and detect byte order
      if (/^FEFF/i.test(hexStr)) {
        hexStr = hexStr.slice(4); // BE BOM — pairs already big-endian, swap below
      } else if (/^FFFE/i.test(hexStr)) {
        hexStr = hexStr.slice(4); // LE BOM — pairs already little-endian, no swap
        littleEndian = true;
      }

      const buf = Buffer.from(hexStr, 'hex');
      if (littleEndian) {
        // Already UTF-16 LE — decode directly
        return buf.toString('utf16le');
      }
      // UCS-2 BE → UTF-16 LE: swap every pair of bytes
      const le = Buffer.allocUnsafe(buf.length);
      for (let i = 0; i + 1 < buf.length; i += 2) {
        le[i]     = buf[i + 1];
        le[i + 1] = buf[i];
      }
      return le.toString('utf16le');
    } catch (e) {
      logger.warn(`[SMS decode] UCS-2 hex decode failed (dcs=${dcs}): ${e.message} — raw: ${raw.slice(0, 60)}`);
    }
  }

  // ── 8-bit data (alphabet = 1) ──────────────────────────────────────────────
  // Used by some carriers for binary payloads (WAP push, MMS notifications…).
  // Yeastar hex-encodes the raw bytes; ISO-8859-1 is the most common interpretation.
  if (dcsAlphabet === 1) {
    try {
      return Buffer.from(raw, 'hex').toString('latin1');
    } catch (e) {
      logger.warn(`[SMS decode] 8-bit hex decode failed (dcs=${dcs}): ${e.message} — raw: ${raw.slice(0, 60)}`);
    }
  }

  // ── GSM-7 default / URL-encoded UTF-8 ─────────────────────────────────────
  try {
    return decodeURIComponent(raw.replace(/\+/g, '%20'));
  } catch (_e) {
    // Fallback: some firmware versions percent-encode raw Latin-1 bytes instead of UTF-8
    return raw.replace(/\+/g, ' ').replace(/%([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
  }
}

/**
 * YeastarConnector
 * Manages a persistent TCP connection to the Yeastar TG SMS API (port 5038).
 * Emits:
 *   'connected'       — TCP connection established and logged in
 *   'disconnected'    — connection lost
 *   'sms:received'   — inbound SMS  { id, port, sender, recvtime, index, total, smsc, content }
 *   'sms:sent'        — send confirmation { id, smsc, status }
 *   'ports:status'    — array of port info lines
 *   'port:info'       — single port detail { port, status, operator, signal, imei, smsc, rawStatus }
 */
class YeastarConnector extends EventEmitter {
  constructor(config) {
    super();
    this.deviceId = config.deviceId;
    this.host = config.host;
    this.port = config.port || 5038;
    this.username = config.username;
    this.secret = config.secret;
    this.socket = null;
    this.buffer = '';
    this.connected = false;
    this._reconnectTimer = null;
    this._reconnectDelay = 5000;
    this._smsBuffer = {};
  }

  connect() {
    logger.info(`Connecting to Yeastar TG at ${this.host}:${this.port}...`);
    this.socket = new net.Socket();
    this.socket.setKeepAlive(true, 10000);

    this.socket.on('connect', () => {
      logger.info('TCP connected. Logging in...');
      this._send(`Action: Login\r\nUsername: ${this.username}\r\nSecret: ${this.secret}\r\n\r\n`);
    });

    this.socket.on('data', (data) => {
      const raw = data.toString();
      logger.info(`[${this.host}] RAW ← ${raw.replace(/\r\n/g, '\\r\\n').replace(/\n/g, '\\n').slice(0, 400)}`);
      this.buffer += raw;
      this._processBuffer();
    });

    this.socket.on('error', (err) => {
      logger.error(`Socket error: ${err.message}`);
    });

    this.socket.on('close', () => {
      this.connected = false;
      logger.warn('Connection closed. Reconnecting in 5s...');
      this.emit('disconnected');
      this._scheduleReconnect();
    });

    this.socket.connect(this.port, this.host);
  }

  disconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.socket) this.socket.destroy();
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, this._reconnectDelay);
  }

  _send(data) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data);
    }
  }

  _processBuffer() {
    // Events/responses are separated by \r\n\r\n or --END ... --
    const delimiter = '\r\n\r\n';
    let idx;
    while ((idx = this.buffer.indexOf(delimiter)) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + delimiter.length);
      this._parseBlock(block);
    }
  }

  _parseBlock(block) {
    const lines = block.split(/\r\n|\n/);
    const fields = {};
    for (const line of lines) {
      const sep = line.indexOf(':');
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      fields[key] = value;
    }

    // Login response
    if (fields['Response'] === 'Success' && !this.connected) {
      this.connected = true;
      logger.info('Logged in to Yeastar TG SMS API successfully.');
      this.emit('connected');
      return;
    }

    // Inbound SMS event
    if (fields['Event'] === 'ReceivedSMS') {
      this._handleInboundSMS(fields);
      return;
    }

    // Outbound SMS send confirmation
    if (fields['Event'] === 'UpdateSMSSend') {
      logger.info(`UpdateSMSSend received: ID=${fields['ID']} Status=${fields['Status']} Smsc=${fields['Smsc']}`);
      this.emit('sms:sent', {
        id: fields['ID'],
        smsc: fields['Smsc'],
        status: parseInt(fields['Status'], 10) === 1 ? 'sent' : 'failed',
      });
      return;
    }

    // Port detail response (follows gsm show $span)
    if (fields['Response'] === 'Follows') {
      const actionId = fields['ActionID'] || '';
      if (actionId.startsWith('portinfo-')) {
        const port = parseInt(actionId.replace('portinfo-', ''), 10);
        this._parsePortInfo(port, fields, block);
        return;
      }
      // If D-channel is present this is an individual 'gsm show N' detail block
      if (fields['D-channel']) {
        const span = parseInt(fields['D-channel'], 10);
        const port = span - 1;
        logger.info(`[${this.host}] gsm show ${span} full response (port ${port}):\n${block}`);
        this._parsePortInfoFromBlock(port, fields);
        return;
      }
      // Generic follows (gsm show spans) — parse 'GSM span N' fields for port status
      this._parseSpansStatus(fields);
      this.emit('ports:status', block);
      return;
    }
  }

  _parsePortInfoFromBlock(port, fields) {
    // Direct fields from 'gsm show N' response (no ActionID, D-channel identifies span)
    const signalRaw = fields['Signal Quality (0,31)'] || '';
    const signalMatch = signalRaw.match(/(\d+)/);
    const state = fields['State'] || null;
    const portData = {
      port,
      status: state,
      operator: fields['Network Name'] || null,
      signal: signalMatch ? parseInt(signalMatch[1], 10) : null,
      imei: fields['Model IMEI'] || null,
      smsc: fields['SIM SMS Center Number'] || null,
      rawStatus: fields['Status'] || null,
    };
    logger.info(`Port ${port} detail: state=${state} operator=${portData.operator} signal=${portData.signal} imei=${portData.imei}`);
    this.emit('port:info', portData);
  }

  _parseSpansStatus(fields) {
    // Response to 'gsm show spans': each GSM port appears as 'GSM span N': '<status string>'
    // Status string contains 'Up' when the port has a SIM and is operational.
    for (const [key, value] of Object.entries(fields)) {
      const m = key.match(/^GSM span (\d+)$/i);
      if (!m) continue;
      const span = parseInt(m[1], 10);
      const port = span - 1; // span 2 = port 1, span 17 = port 16 (T16)
      const isUp = /\bUp\b/.test(value);
      const status = isUp ? 'READY' : (value.includes('Undetected SIM') ? 'NO_SIM' : 'DOWN');
      logger.info(`Span ${span} → port ${port}: status=${status} (${value})`);
      this.emit('port:info', { port, status, operator: null, signal: null, imei: null, smsc: null, rawStatus: value });
    }
  }

  _parsePortInfo(port, fields, block) {
    // The Yeastar AMI "Follows" response embeds all port data as "Output: key : value" lines.
    // Top-level fields only contain Response/ActionID — actual data must be parsed from Output lines.
    logger.info(`Port ${port} raw block:\n${block}`);
    const out = {};
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('Output:')) continue;
      const content = line.slice('Output:'.length).trim();
      const sep = content.indexOf(':');
      if (sep === -1) continue;
      const key = content.slice(0, sep).trim();
      const val = content.slice(sep + 1).trim();
      if (key) out[key] = val;
    }
    const signalRaw = out['Signal Quality (0,31)'] || '';
    const signalMatch = signalRaw.match(/(\d+)/);
    const state = out['State'] || null;
    const rawStatus = out['Status'] || null;
    const portData = {
      port,
      status: state,
      operator: out['Network Name'] || null,
      signal: signalMatch ? parseInt(signalMatch[1], 10) : null,
      imei: out['IMEI'] || out['Model IMEI'] || null,
      smsc: out['SIM SMS Center Number'] || null,
      rawStatus,
    };
    logger.info(`Port ${port} info: state=${state} operator=${portData.operator} signal=${portData.signal} imei=${portData.imei}`);
    this.emit('port:info', portData);
  }

  _handleInboundSMS(fields) {
    const id = fields['ID'] || uuidv4().replace(/-/g, '').slice(0, 16);
    const index = parseInt(fields['Index'], 10) || 1;
    const total = parseInt(fields['Total'], 10) || 1;

    if (!this._smsBuffer[id]) {
      this._smsBuffer[id] = {
        id,
        port: parseInt(fields['GsmSpan'], 10) - 1,
        sender: fields['Sender'],
        recvtime: fields['Recvtime'],
        smsc: fields['Smsc'],
        total,
        parts: {},
      };
    }

    const raw = fields['Content'] || '';
    const dcs = fields['Dcs'] || '';
    logger.info(`[${this.host}] SMS part id=${id} index=${index}/${total} dcs=${dcs} raw_content=${raw.slice(0, 80)}`);
    const decoded = _decodeSmsContent(raw, dcs);
    this._smsBuffer[id].parts[index] = decoded;

    // Check if all parts received
    const assembled = this._smsBuffer[id];
    if (Object.keys(assembled.parts).length === assembled.total) {
      let content = '';
      for (let i = 1; i <= assembled.total; i++) {
        content += assembled.parts[i] || '';
      }
      delete this._smsBuffer[id];
      this.emit('sms:received', { ...assembled, content });
    }
  }

  /**
   * Send an SMS via the Yeastar API.
   * @param {number} port  - GSM port (1-based, as configured in TG)
   * @param {string} dest  - destination phone number
   * @param {string} message - SMS text
   * @returns {string} - tracking id
   */
  sendSMS(port, dest, message) {
    if (!this.connected) throw new Error('Not connected to Yeastar TG');
    const id = uuidv4().replace(/-/g, '').slice(0, 16);
    const encoded = encodeURIComponent(message);
    // Yeastar AMI uses span numbers = trunk_number + 1 (e.g. T16 → span 17)
    this._send(`Action: smscommand\r\ncommand: gsm send sms ${port + 1} ${dest} "${encoded}" ${id}\r\n\r\n`);
    logger.info(`SMS queued: port=${port} span=${port + 1} dest=${dest} id=${id}`);
    return id;
  }

  /**
   * Request status of all GSM ports.
   */
  requestPortStatus() {
    if (!this.connected) return;
    this._send(`Action: smscommand\r\ncommand: gsm show spans\r\n\r\n`);
  }

  /**
   * Request detailed info for a specific port.
   * NOTE: 'gsm show N' is NOT supported on TG firmware; use requestPortStatus() instead.
   */
  requestPortInfo(port) {
    if (!this.connected) return;
    logger.warn(`gsm show ${port + 1} not supported on this firmware — use gsm show spans`);
  }

  /**
   * Query all port status via 'gsm show spans'.
   */
  requestAllPortInfo() {
    this.requestPortStatus();
  }
}

module.exports = YeastarConnector;
