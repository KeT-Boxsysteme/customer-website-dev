const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  // Azure SQL Serverless braucht beim Auto-Resume 30-60s -> grosszuegiges Timeout,
  // sonst schlaegt der erste Request nach einer Pause immer fehl.
  connectionTimeout: 45000,
  requestTimeout: 15000,
  options: {
    encrypt: true,
    trustServerCertificate: process.env.NODE_ENV !== 'production'
  },
  pool: {
    max: 10,
    min: 1,              // eine Verbindung warm halten -> kein Reconnect pro Seitenaufruf
    idleTimeoutMillis: 300000
  }
};

// Ein gemeinsames Connect-Promise statt Pool-Objekt cachen:
// - verhindert doppelte Pools bei parallelen Requests waehrend des Verbindungsaufbaus
// - wird bei Fehlern/Verbindungsabbruch zurueckgesetzt, damit sich die App selbst heilt
//   (vorher blieb ein toter Pool gecacht -> alle Seiten kaputt bis zum Neustart)
let poolPromise = null;

function connect() {
  const promise = new sql.ConnectionPool(config).connect()
    .then(pool => {
      pool.on('error', err => {
        console.error('[DB] Pool-Fehler, Verbindung wird beim naechsten Zugriff neu aufgebaut:', err.message);
        if (poolPromise === promise) poolPromise = null;
        pool.close().catch(() => {});
      });
      return pool;
    })
    .catch(err => {
      if (poolPromise === promise) poolPromise = null; // fehlgeschlagenen Versuch nicht cachen
      throw err;
    });
  return promise;
}

async function getPool() {
  if (!poolPromise) poolPromise = connect();
  let pool;
  try {
    pool = await poolPromise;
  } catch (err) {
    // Ein Retry direkt hinterher: faengt den Fall "DB war pausiert, ist jetzt wach" ab
    poolPromise = connect();
    pool = await poolPromise;
  }
  if (!pool.connected) {
    // Verbindung ist unterwegs gestorben -> transparent neu verbinden
    poolPromise = connect();
    pool = await poolPromise;
  }
  return pool;
}

async function closePool() {
  if (poolPromise) {
    const promise = poolPromise;
    poolPromise = null;
    try { (await promise).close(); } catch (_) { /* bereits zu */ }
  }
}

// Optional: haelt die Serverless-DB wach (verhindert Auto-Pause + 60s-Aufwachzeit).
// Aktivieren mit DB_KEEPALIVE_MINUTES=5 in .env / Render. Achtung: verhindert
// die Kostenersparnis des Auto-Pause -> bewusst opt-in.
const keepAliveMinutes = parseInt(process.env.DB_KEEPALIVE_MINUTES, 10);
if (keepAliveMinutes > 0) {
  const timer = setInterval(async () => {
    try {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ping');
    } catch (err) {
      console.error('[DB] Keep-alive fehlgeschlagen:', err.message);
    }
  }, keepAliveMinutes * 60 * 1000);
  timer.unref(); // blockiert den Prozess-Exit nicht (wichtig fuer Tests)
}

module.exports = { getPool, closePool, sql };
