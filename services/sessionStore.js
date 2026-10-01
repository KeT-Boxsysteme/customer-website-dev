// Login-Sitzungen in der Datenbank (Betreiber 01.10.). Gemessen: jeder Server-Neustart (Deploy,
// Render-Aufwachen) meldete alle ab, weil Sitzungen nur im Arbeitsspeicher lagen → der Fuehler-Verbinder
// trennte, das Monitoring landete auf dem Login.
// Eigener kleiner Speicher statt Paket (connect-mssql-v2 baut einen zweiten Pool ohne Selbstheilung und
// kann bei DB-Fehlern per unbehandeltem 'error' den Server beenden). Laeuft auf dem gemeinsamen Pool
// (config/database.js). Schreibt nur, wenn sich etwas aendert; Aufraeumen hoechstens 1x/Stunde bei einem
// Schreibvorgang, kein Zeitgeber (DB darf ruhen, E-19). Tabelle: dbo.sessions (database/schema.sql).
const session = require('express-session');
const { getPool, sql } = require('../config/database');

const CLEANUP_EVERY_MS = 60 * 60 * 1000;
const FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;

class DbSessionStore extends session.Store {
  constructor({ now = () => new Date() } = {}) {
    super();
    this.now = now;
    this.lastCleanup = 0;
    this.knownExpiry = new Map();   // sid -> zuletzt gespeichertes Ablaufdatum (ms), spart Schreibzugriffe
  }

  expiresOf(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    return e ? new Date(e) : new Date(this.now().getTime() + FALLBACK_TTL_MS);
  }

  get(sid, cb) {
    (async () => {
      const pool = await getPool();
      const r = await pool.request()
        .input('sid', sql.NVarChar(255), sid)
        .input('now', sql.DateTime2, this.now())
        .query('SELECT session FROM sessions WHERE sid = @sid AND expires > @now');
      const row = r.recordset[0];
      if (!row) { this.knownExpiry.delete(sid); return null; }
      const sess = JSON.parse(row.session);
      this.knownExpiry.set(sid, this.expiresOf(sess).getTime());
      return sess;
    })().then(s => cb(null, s), err => cb(err));
  }

  set(sid, sess, cb) {
    (async () => {
      const expires = this.expiresOf(sess);
      const pool = await getPool();
      await pool.request()
        .input('sid', sql.NVarChar(255), sid)
        .input('session', sql.NVarChar(sql.MAX), JSON.stringify(sess))
        .input('expires', sql.DateTime2, expires)
        .query(`UPDATE sessions SET session = @session, expires = @expires WHERE sid = @sid;
                IF @@ROWCOUNT = 0 INSERT INTO sessions (sid, session, expires) VALUES (@sid, @session, @expires);`);
      this.knownExpiry.set(sid, expires.getTime());
      await this.cleanupIfDue(pool);
    })().then(() => cb && cb(null), err => cb && cb(err));
  }

  touch(sid, sess, cb) {
    (async () => {
      const expires = this.expiresOf(sess);
      // ohne spaeteres Ablaufdatum nichts schreiben (Tablet fragt alle 5 s; ohne rolling bleibt es gleich)
      if (this.knownExpiry.get(sid) >= expires.getTime()) return;
      const pool = await getPool();
      await pool.request()
        .input('sid', sql.NVarChar(255), sid)
        .input('expires', sql.DateTime2, expires)
        .query('UPDATE sessions SET expires = @expires WHERE sid = @sid');
      this.knownExpiry.set(sid, expires.getTime());
    })().then(() => cb && cb(null), err => cb && cb(err));
  }

  destroy(sid, cb) {
    (async () => {
      const pool = await getPool();
      await pool.request()
        .input('sid', sql.NVarChar(255), sid)
        .query('DELETE FROM sessions WHERE sid = @sid');
      this.knownExpiry.delete(sid);
    })().then(() => cb && cb(null), err => cb && cb(err));
  }

  async cleanupIfDue(pool) {
    const now = this.now();
    if (now.getTime() - this.lastCleanup < CLEANUP_EVERY_MS) return;
    this.lastCleanup = now.getTime();
    await pool.request().input('now', sql.DateTime2, now).query('DELETE FROM sessions WHERE expires <= @now');
  }
}

// Tests behalten den Speicher im Arbeitsspeicher (DB ist dort gemockt); ueberall sonst die DB.
function sessionStoreFor(nodeEnv) {
  return nodeEnv === 'test' ? undefined : new DbSessionStore();
}

module.exports = { DbSessionStore, sessionStoreFor };
