/**
 * Umstellung auf Freischaltung + Nutz-Nummer (KET\AUFTRAG 7.8): bestehende Einrichtungen (nur Testdaten)
 * werden aktiv und bekommen eine Nutz-Nummer — OHNE Mail (notified_code = access_code).
 *
 *   node scripts/activate-existing.js --db=<DB_DATABASE> --bis=<ISO-Zeit>          Probelauf (schreibt nichts)
 *   node scripts/activate-existing.js --db=<DB_DATABASE> --bis=<ISO-Zeit> --apply  schreibt
 *
 * --db  Pflicht, muss DB_DATABASE aus .env entsprechen (Schutz gegen das falsche Ziel).
 * --bis Pflicht: nur Einrichtungen, die VOR diesem Zeitpunkt angelegt wurden. Spaetere Registrierungen
 *       warten zu Recht auf Freischaltung durch KeT und duerfen hier nie freigeschaltet werden.
 * Gibt nur Zahlen aus, keine Namen, Ids oder Nummern. Idempotent: ein zweiter Lauf meldet 0.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const crypto = require('crypto');

function parseArgs(argv) {
  const get = name => (argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null;
  return { db: get('db'), bis: get('bis'), apply: argv.includes('--apply') };
}

const newCode = () => String(crypto.randomInt(100000, 1000000));   // 7.7: 100000–999999

async function run({ pool, sql, args, env, log }) {
  if (!args.db || args.db !== env.DB_DATABASE) {
    throw new Error(`--db muss dem Ziel aus .env entsprechen (DB_DATABASE=${env.DB_DATABASE})`);
  }
  const bis = args.bis ? new Date(args.bis) : null;
  if (!bis || isNaN(bis.getTime())) throw new Error('--bis=<ISO-Zeit> ist Pflicht');

  const count = async () => (await pool.request().input('bis', sql.DateTime2, bis).query(
    `SELECT COUNT(*) AS n FROM companies WHERE access_code IS NULL AND created_at < @bis`)).recordset[0].n;

  const todo = await count();
  log(`Ziel: ${env.DB_SERVER} / ${env.DB_DATABASE} | Stichzeit: ${bis.toISOString()}`);
  log(`Einrichtungen ohne Nutz-Nummer vor der Stichzeit: ${todo}`);
  if (!args.apply) { log('Probelauf — nichts geschrieben. Mit --apply schreiben.'); return { todo, done: 0 }; }

  let done = 0;
  for (let i = 0; i < todo; i++) {
    // eine Einrichtung je Schritt, ein UPDATE je Einrichtung; Nummernkonflikt (2601/2627) -> neue Nummer
    let written = false;
    for (let attempt = 0; attempt < 5 && !written; attempt++) {
      const code = newCode();
      try {
        const r = await pool.request().input('bis', sql.DateTime2, bis).input('code', sql.Char(6), code).query(
          `UPDATE TOP (1) companies
              SET status = 'active', access_code = @code, notified_code = @code,
                  approved_at = SYSUTCDATETIME(), approved_by = 'Umstellung Website (Bestand, 7.8)'
            WHERE access_code IS NULL AND created_at < @bis`);
        written = true;
        done += r.rowsAffected[0];
      } catch (err) {
        if (err.number !== 2601 && err.number !== 2627) throw err;
      }
    }
    if (!written) throw new Error('keine freie Nummer nach 5 Versuchen — abgebrochen');
  }
  log(`Geschrieben: ${done} | danach ohne Nummer: ${await count()}`);
  return { todo, done };
}

if (require.main === module) {
  const { getPool, closePool, sql } = require('../config/database');
  (async () => {
    const pool = await getPool();
    await run({ pool, sql, args: parseArgs(process.argv.slice(2)), env: process.env, log: console.log });
    await closePool();
  })().catch(err => { console.error('Fehler:', err.message); process.exit(1); });
}

module.exports = { run, parseArgs };
