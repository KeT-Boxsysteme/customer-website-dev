// Passwort-Reset-Links in der DB (Fund 01.10.: vorher im Arbeitsspeicher — jeder Deploy/Neustart machte
// offene Links ungueltig). Gespeichert wird nur der Hash (services/resetToken.js).
const { getPool, sql } = require('../config/database');

async function create(userId, tokenHash, expiresAt) {
  const pool = await getPool();
  await pool.request()
    .input('userId', sql.Int, userId)
    .input('hash', sql.Char(64), tokenHash)
    .input('expires', sql.DateTime2, expiresAt)
    .query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (@hash, @userId, @expires)');
}

// Nur nachsehen (Formular anzeigen) — verbraucht den Link nicht
async function findValidUserId(tokenHash, now) {
  const pool = await getPool();
  const r = await pool.request()
    .input('hash', sql.Char(64), tokenHash)
    .input('now', sql.DateTime2, now)
    .query('SELECT user_id FROM password_resets WHERE token_hash = @hash AND used_at IS NULL AND expires_at > @now');
  return r.recordset[0] ? r.recordset[0].user_id : null;
}

// Einloesen: genau einmal (ein UPDATE mit Bedingung), danach alle anderen offenen Links des Benutzers ungueltig
async function consume(tokenHash, now) {
  const pool = await getPool();
  const r = await pool.request()
    .input('hash', sql.Char(64), tokenHash)
    .input('now', sql.DateTime2, now)
    .query(`UPDATE password_resets SET used_at = @now
            OUTPUT INSERTED.user_id
            WHERE token_hash = @hash AND used_at IS NULL AND expires_at > @now`);
  const userId = r.recordset[0] ? r.recordset[0].user_id : null;
  if (userId) {
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('now', sql.DateTime2, now)
      .query('UPDATE password_resets SET used_at = @now WHERE user_id = @userId AND used_at IS NULL');
  }
  return userId;
}

module.exports = { create, findValidUserId, consume };
