/**
 * Legt einen Test-Admin-User an (idempotent).
 * Ausführen mit: npm run seed
 *
 * Login-Daten:
 *   E-Mail:   admin@ket.dev
 *   Passwort: Admin1234!
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const sql    = require('mssql');
const bcrypt = require('bcryptjs');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user:     process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  options:  { encrypt: true, trustServerCertificate: false }
};

const TEST_EMAIL    = 'admin@ket.dev';
const TEST_PASSWORD = 'Admin1234!';

async function run() {
  const pool = await sql.connect(config);

  // Unternehmen anlegen oder vorhandenes verwenden
  let companyId;
  const existingCo = await pool.request()
    .input('name', sql.NVarChar(200), 'KeT Dev GmbH')
    .query('SELECT id FROM companies WHERE name = @name');

  if (existingCo.recordset.length > 0) {
    companyId = existingCo.recordset[0].id;
    console.log('Unternehmen existiert bereits (id=' + companyId + ')');
  } else {
    const res = await pool.request()
      .input('name',        sql.NVarChar(200), 'KeT Dev GmbH')
      .input('type',        sql.NVarChar(20),  'company')
      .input('city',        sql.NVarChar(100), 'Musterstadt')
      .input('street',      sql.NVarChar(150), 'Musterstraße')
      .input('housenumber', sql.NVarChar(20),  '1')
      .input('zip',         sql.NVarChar(20),  '12345')
      .query(`INSERT INTO companies (name, type, city, street, housenumber, zip)
              OUTPUT INSERTED.id
              VALUES (@name, @type, @city, @street, @housenumber, @zip)`);
    companyId = res.recordset[0].id;
    console.log('Unternehmen erstellt (id=' + companyId + ')');
  }

  // Admin-User anlegen oder überspringen
  const existingUser = await pool.request()
    .input('email', sql.NVarChar(255), TEST_EMAIL)
    .query('SELECT id FROM users WHERE email = @email');

  if (existingUser.recordset.length > 0) {
    console.log('Admin-User existiert bereits – nichts zu tun.');
  } else {
    const hash = await bcrypt.hash(TEST_PASSWORD, 12);
    await pool.request()
      .input('companyId',  sql.Int,          companyId)
      .input('firstname',  sql.NVarChar(100), 'Admin')
      .input('lastname',   sql.NVarChar(100), 'KeT')
      .input('email',      sql.NVarChar(255), TEST_EMAIL)
      .input('username',   sql.NVarChar(4),   'AKET')
      .input('department', sql.NVarChar(100), 'management')
      .input('role',       sql.NVarChar(20),  'admin')
      .input('hash',       sql.NVarChar(255), hash)
      .query(`INSERT INTO users
                (company_id, firstname, lastname, email, username, department, role, password_hash, is_active)
              VALUES
                (@companyId, @firstname, @lastname, @email, @username, @department, @role, @hash, 1)`);

    console.log('\nAdmin-User erstellt:');
    console.log('  E-Mail:   ', TEST_EMAIL);
    console.log('  Passwort: ', TEST_PASSWORD);
  }

  await pool.close();
}

run().catch(err => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
