/**
 * Erstellt alle Datenbanktabellen und Indizes (idempotent).
 * Ausführen mit: npm run setup
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const sql  = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: true, trustServerCertificate: false }
};

async function run() {
  console.log('Verbinde mit', config.server, '...');
  const pool = await sql.connect(config);
  console.log('Verbunden.\n');

  const schemaPath = path.join(__dirname, '../database/schema.sql');
  const schemaSql  = fs.readFileSync(schemaPath, 'utf8');

  // Inline-Kommentare entfernen, dann nach Semikolon trennen
  const statements = schemaSql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    await pool.request().query(stmt);
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 80);
    console.log('  OK:', preview);
  }

  console.log('\nDatenbank-Setup abgeschlossen.');
  await pool.close();
}

run().catch(err => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
