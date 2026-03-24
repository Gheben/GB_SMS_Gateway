/**
 * Encryption utility — AES-256-GCM
 * Le password non vengono mai salvate in chiaro nel DB.
 * Chiave derivata da ENCRYPTION_SECRET (env) via SHA-256.
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 16;   // bytes
const TAG_LEN   = 16;   // bytes
const PREFIX    = 'enc:'; // indica testo già cifrato

function _getKey() {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || 'default-insecure-key-change-me';
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

/**
 * Cifra un testo in chiaro.
 * Restituisce una stringa nel formato:  enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  if (String(plaintext).startsWith(PREFIX)) return plaintext; // già cifrato
  const key  = _getKey();
  const iv   = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decifra una stringa prodotta da encrypt().
 * Se la stringa non è nel formato atteso (es. legacy), la restituisce invariata.
 */
function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;
  const s = String(ciphertext);
  if (!s.startsWith(PREFIX)) return s; // testo in chiaro (legacy) — restituisce così com'è
  const parts = s.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return s; // formato non valido
  const [ivHex, tagHex, ctHex] = parts;
  try {
    const key  = _getKey();
    const iv   = Buffer.from(ivHex, 'hex');
    const tag  = Buffer.from(tagHex, 'hex');
    const ct   = Buffer.from(ctHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct) + decipher.final('utf8');
  } catch {
    return s; // fallback se la chiave è cambiata o dati corrotti
  }
}

/** Restituisce true se la stringa sembra già cifrata (per evitare doppia cifratura) */
function isEncrypted(s) {
  return s && String(s).startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
