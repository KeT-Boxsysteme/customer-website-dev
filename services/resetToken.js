// Passwort-Reset-Links: in der DB steht nur der SHA-256-Hash (wer die Tabelle liest, kann keinen Link bauen).
const crypto = require('crypto');

const RESET_VALID_MS = 60 * 60 * 1000;   // 1 Stunde, wie in der Mail angekuendigt

const newToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { RESET_VALID_MS, newToken, hashToken };
